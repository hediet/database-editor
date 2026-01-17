# Database Editor Rewrite Plan

## Core Insight

The fundamental problem: **relational data is a graph, but JSON is a tree**.

To convert a graph to a tree, we need to pick a **dominant parent** for each table. The dominant parent "owns" the child in the tree representation. Other relationships become references (foreign key values kept inline).

## Key Concepts

### Dominance

For each table with multiple incoming composition relationships, exactly one must be designated as **dominant**. The dominant relationship determines where the child appears nested in the JSON tree.

```
Example: LocalizedChapter
  - composedBy Chapter (via chapterId)        ← DOMINANT
  - composedBy ProjectLanguage (via projectId, languageId)
  
Result: LocalizedChapter nests under Chapter, keeps projectLanguageId as reference
```

**Dominance selection heuristics:**
1. User-specified (override file)
2. Shortest path from a root table
3. Most specific FK (single column preferred over composite)
4. Alphabetical (deterministic fallback)

### Relationship Classification

```
Foreign Key → Classification
─────────────────────────────
ON DELETE CASCADE         → composedBy (candidate)
ON DELETE SET NULL        → reference
ON DELETE RESTRICT        → reference (strong ref)
ON DELETE NO ACTION       → reference
Self-referencing          → reference (always)
```

### The Ownership Tree

From the schema, we derive an **ownership tree**:

```
Root Tables (no dominant parent)
├── Organization
│   ├── Project (composedBy Organization)
│   │   ├── Chapter (composedBy Project)
│   │   │   └── LocalizedChapter (composedBy Chapter) ← dominance chosen
│   │   └── ProjectLanguage (composedBy Project)
│   └── UserOrganizationMembership (composedBy Organization)
├── User
│   ├── PasskeyCredential (composedBy User)
│   ├── UserSession (composedBy User)
│   └── UserOrganizationMembership (composedBy User) ← multi-parent!
├── Guest
│   └── Conversation (composedBy Guest)
│       └── ConversationItem (composedBy Conversation)
└── Language (root, referenced by others)
```

**Multi-parent tables** (like `UserOrganizationMembership`) must pick one dominant parent. The other parent keeps a reference.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                           │
│  (commander, argument parsing, output formatting)           │
└─────────────────────────────────┬───────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│                      Business Logic                         │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │SchemaLoader │  │ Serializer  │  │   SyncEngine        │ │
│  │             │  │             │  │                     │ │
│  │ - extract   │  │ - toFlat    │  │ - diff (flat)       │ │
│  │ - classify  │  │ - toNested  │  │ - generateChanges   │ │
│  │ - dominance │  │ - fromFlat  │  │ - apply / dryRun    │ │
│  └─────────────┘  │ - fromNested│  │ - threeWayMerge     │ │
│                   └─────────────┘  └─────────────────────┘ │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Data Model                           ││
│  │  Schema, Table, Column, Relationship, OwnershipTree     ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│                    Database Adapter                         │
│  (pg client, query execution, transaction management)       │
└─────────────────────────────────────────────────────────────┘
```

### Module Boundaries

```typescript
// === Data Model (pure, no I/O) ===

interface Schema {
  readonly tables: ReadonlyMap<string, Table>;
  readonly enums: ReadonlyMap<string, EnumType>;
  readonly relationships: readonly Relationship[];
  readonly ownershipTree: OwnershipTree;
}

interface Table {
  readonly name: string;
  readonly columns: readonly Column[];
  readonly primaryKey: readonly string[];
}

interface Column {
  readonly name: string;
  readonly type: string;
  readonly isNullable: boolean;
  readonly hasDefault: boolean;       // Has DEFAULT expression
  readonly defaultExpression?: string; // e.g. "gen_random_uuid()", "CURRENT_TIMESTAMP"
  readonly isGenerated: boolean;      // GENERATED ALWAYS AS (...)
  readonly isSerial: boolean;         // SERIAL/BIGSERIAL (identity column)
}

interface Relationship {
  readonly id: string;
  readonly fromTable: string;
  readonly fromColumns: readonly string[];
  readonly toTable: string;
  readonly toColumns: readonly string[];
  readonly kind: 'composition' | 'reference';
  readonly onDelete: DeleteAction;
  readonly isDominant: boolean;  // Only one composition per child can be dominant
}

interface OwnershipTree {
  readonly roots: readonly string[];  // Tables with no dominant parent
  getChildren(tableName: string): readonly OwnershipEdge[];
  getDominantParent(tableName: string): OwnershipEdge | undefined;
  getReferences(tableName: string): readonly Relationship[];
}

// === Flat Data Representation ===

interface FlatDataset {
  readonly tables: ReadonlyMap<string, readonly FlatRow[]>;
}

interface FlatRow {
  readonly [column: string]: unknown;
}

// === Nested Data Representation ===

interface NestedDataset {
  readonly $schema?: string;  // Path to JSON Schema
  readonly $base?: string;    // Path to base snapshot for merge
  readonly roots: ReadonlyMap<string, readonly NestedRow[]>;
}

interface NestedRow {
  readonly [column: string]: unknown;  // scalar values
  readonly [childTable: string]: readonly (NestedRow | RefMarker | PartialMarker)[];  // nested children (can be refs)
}

interface PartialMarker {
  readonly $partial: true;
  readonly skipped: number;
}

// === References (collapsed compositions) ===

interface RefMarker {
  readonly $ref: true;
  readonly [pkColumn: string]: unknown;  // Primary key values
}

// Example: { $ref: true, id: "todo-123" }
// Can be "unfolded" to full nested object by VS Code extension

// === Conflicts (from three-way merge) ===

interface ConflictMarker<T> {
  readonly $conflict: true;
  readonly base: T;    // Original value
  readonly ours: T;    // Value in edited file
  readonly theirs: T;  // Current value in database
}

// Example: { $conflict: true, base: "Alice", ours: "Alice Smith", theirs: "Alice J." }

// === JSON Schema Generation ===

type SchemaMode = 'strict' | 'insert';

interface JsonSchemaOptions {
  mode: SchemaMode;           // 'insert' makes auto-generated fields optional
  flat: boolean;              // flat vs nested structure
}
```

---

## Algorithms

### 1. Schema Extraction & Classification

```
Input: PostgreSQL connection
Output: Schema with classified relationships and ownership tree

Algorithm:
1. Query information_schema for tables, columns, constraints
2. Query pg_constraint for foreign keys with ON DELETE/UPDATE actions
3. For each FK:
   a. Classify as composition (CASCADE) or reference (other)
   b. If composition, mark as candidate for dominance
4. Build dominance graph:
   a. For each table, collect all incoming compositions
   b. If multiple, select dominant using heuristics
   c. Non-dominant compositions become references
5. Validate: ownership tree must be acyclic (no cycles through dominant edges)
6. Return Schema with OwnershipTree
```

### 2. Flat ↔ Nested Serialization

**Flat is canonical.** Nested is a *presentation* derived from flat + ownership tree.

The base file is always flat. The user-facing file can be nested (for editing comfort), but the sync algorithm converts it back to flat before diffing.

```
toNested(flat: FlatDataset, tree: OwnershipTree, options: PresentationOptions): NestedDataset

PresentationOptions:
  - expandDepth: number        // How deep to expand (0 = all refs, Infinity = all expanded)
  - collapseTable: Set<string> // Tables to always show as $ref
  - limit: number              // Max items per root list
  - nestedLimit: number        // Max items per nested list

Algorithm:
1. Start with root tables (no dominant parent)
2. For each root table:
   a. Get all rows from flat dataset
   b. For each row, recursively attach children:
      - Find dominant children via ownership tree
      - Filter child rows by FK match
      - Remove FK columns from child (they're implicit from nesting)
      - Recurse for grandchildren
3. Return nested structure

fromNested(nested: NestedDataset, tree: OwnershipTree): FlatDataset

Algorithm:
1. For each root table in nested:
   a. Extract scalar columns → flat row
   b. For each nested child array:
      - Reconstruct FK columns from parent context
      - Recurse for grandchildren
2. Return flat dataset (all tables populated)
```

### 3. Sync Engine (operates on FLAT data only)

The sync engine never sees nested data. It works purely with `FlatDataset`.

```
diff(base: FlatDataset, modified: FlatDataset): ChangeSet

Algorithm:
1. For each table:
   a. Build index by primary key for both datasets
   b. Compare:
      - In modified but not base → INSERT
      - In base but not modified → DELETE
      - In both but different → UPDATE (compare column values)
2. Return ChangeSet with all changes

generateSQL(changes: ChangeSet): SQLStatement[]

Algorithm:
1. Topologically sort tables by FK dependencies
2. For DELETEs: children before parents (reverse topo order)
3. For INSERTs: parents before children (topo order)
4. For UPDATEs: order doesn't matter (within transaction)
5. Generate parameterized SQL statements
```

### 4. Three-Way Merge

For concurrent editing scenarios:

```
threeWayMerge(base: FlatDataset, ours: FlatDataset, theirs: FlatDataset): MergeResult

Algorithm:
1. For each table, for each row (by PK):
   a. Compute: ours_changed = (ours != base), theirs_changed = (theirs != base)
   b. Cases:
      - Neither changed → keep base
      - Only ours changed → take ours
      - Only theirs changed → take theirs
      - Both changed, same result → take either (no conflict)
      - Both changed, different result → CONFLICT
2. Return MergeResult with merged dataset + list of conflicts
```

---

## CLI Commands

### Schema Commands

```bash
# Extract schema and relationships
db-editor schema extract -c <conn> -o schema.json

# Override dominance (interactive or via file)
db-editor schema configure -i schema.json -o schema.json
# Writes user overrides for dominance decisions

# Visualize as Mermaid
db-editor schema mermaid -i schema.json -o diagram.mmd
```

### Dump Commands

```bash
# Full dump (all root tables, nested)
# Creates: data.json, .db-editor/data.base.json, .db-editor/data.schema.json
db-editor dump full -c <conn> -s schema.json -o data.json

# Full dump with row limits
db-editor dump full -c <conn> -s schema.json -o data.json --limit 50

# Full dump with different limits for root vs nested
db-editor dump full -c <conn> -s schema.json -o data.json --limit 100 --nested-limit 20

# Full dump (flat, all tables)
db-editor dump full --flat -c <conn> -s schema.json -o data.json

# Skip base file generation (no three-way merge support)
db-editor dump full -c <conn> -s schema.json -o data.json --no-base

# Partial dump (specific root + descendants)
db-editor dump partial -c <conn> -s schema.json -o data.json \
  --root organizations \
  --where "id = 'org-123'"

# Partial dump (specific table, flat only)
db-editor dump table -c <conn> -o users.json --table User
```

### Sync Commands

```bash
# Preview changes (dry run) - always operates on flat internally
db-editor sync preview -c <conn> -s schema.json -i data.json
# Output: list of INSERT/UPDATE/DELETE with affected rows
# Note: Uses $base from data.json header for three-way merge if available

# Apply changes (interactive by default)
db-editor sync apply -c <conn> -s schema.json -i data.json
# Shows diff, prompts for confirmation (y/N), executes in transaction, updates base file

# Apply without confirmation (for scripts)
db-editor sync apply -c <conn> -s schema.json -i data.json --yes

# Apply without three-way merge (treat input as desired state)
db-editor sync apply -c <conn> -s schema.json -i data.json --no-merge

# Reset: apply file state, ignoring base (two-way diff against DB)
db-editor reset -c <conn> -s schema.json -i data.json
# Only touches rows mentioned in file

# Reset --hard: ensure DB exactly matches file (destructive!)
db-editor reset --hard -c <conn> -s schema.json -i data.json
# Deletes rows not in file. Invariant: dump after reset --hard equals input (modulo presentation)

# Explicit three-way merge (for concurrent edits or custom base)
db-editor sync merge \
  --base base.json \
  --ours ours.json \
  --theirs theirs.json \
  -o merged.json
# Reports conflicts to stderr, writes merged to output
```

**Sync with `$base` (three-way merge):**

When `$base` is present in the data file header, sync uses three-way merge:

```
Base (original dump) ──┬── Ours (edited file) ──┬── Merged
                       │                        │
                       └── Theirs (current DB) ─┘
```

This enables:
- **Additive changes**: New rows you add are inserted
- **Concurrent safety**: Changes made by others since dump are preserved
- **Conflict detection**: Same row changed in both → reported as conflict

**Without `$base` (two-way diff):**

Without a base file (or with `--no-merge`), sync treats your file as the **desired state**:
- Rows in your file but not DB → INSERT
- Rows in DB but not your file → DELETE (⚠️ destructive!)
- Rows differ → UPDATE

### JSON Schema Commands

```bash
# Generate JSON Schema for nested format
db-editor jsonschema -s schema.json -o data.schema.json

# Generate JSON Schema for flat format
db-editor jsonschema --flat -s schema.json -o data-flat.schema.json

# Generate JSON Schema for INSERT mode (auto-generated fields optional)
db-editor jsonschema -s schema.json -o data.schema.json --mode insert
```

---

## Dump Behavior & File Structure

### Default Dump Output

When running a dump, **three files** are created:

```
my-dump.json                    ← Main file (you edit this)
.db-editor/
  my-dump.base.json             ← Base snapshot (for three-way merge)
  my-dump.schema.json           ← JSON Schema (for autocomplete)
```

The main dump file references both:

```json
{
  "$schema": "./.db-editor/my-dump.schema.json",
  "$base": "./.db-editor/my-dump.base.json",
  "organizations": [...]
}
```

**Important: Base file is always FLAT.**

The base file stores canonical flat rows. The user-facing file can be nested (presentation). This separation means:
- Sync algorithm only deals with flat data (simpler)
- User can customize presentation without affecting diff logic
- Three-way merge compares flat representations

**Workflow:**
1. `db-editor dump` → creates all three files (base is flat, main can be nested)
2. Edit `my-dump.json` in VS Code (autocomplete works via `$schema`)
3. `db-editor sync apply -i my-dump.json` → converts to flat, diffs against flat base
4. After sync, base file is updated to reflect new DB state

### JSON Schema Modes

Two schema modes for different use cases:

| Mode | Auto-generated fields | Use case |
|------|----------------------|----------|
| `strict` (default for validation) | Required | Validating existing data |
| `insert` (default for dumps) | Optional | Adding new rows |

**Auto-generated fields** (marked optional in `insert` mode):
- Primary keys with `DEFAULT` (sequences, UUID generation)
- `SERIAL` / `BIGSERIAL` columns  
- Columns with `DEFAULT CURRENT_TIMESTAMP` or similar
- Columns with any `DEFAULT` expression

```json
// insert mode schema
{
  "Organization": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },           // optional - auto-generated
      "createdAt": { "type": "string" },    // optional - has DEFAULT
      "name": { "type": "string" }          // required - no default
    },
    "required": ["name"]  // id and createdAt omitted
  }
}
```

### List Limits & Partial Dumps

For large tables, use `--limit` to cap list sizes:

```bash
db-editor dump full -c <conn> -s schema.json -o data.json --limit 50
```

When a list exceeds the limit, remaining rows are represented as a marker:

```json
{
  "organizations": [
    { "id": "org-1", "name": "Acme" },
    { "id": "org-2", "name": "Beta Corp" },
    // ... 48 more rows ...
    { "$partial": true, "skipped": 1000 }
  ]
}
```

**Partial marker schema:**
```typescript
interface PartialMarker {
  $partial: true;
  skipped: number;      // Count of omitted rows
}
```

**Behavior on sync:**
- Partial markers are **ignored** during diff (neither insert nor delete)
- To sync a partial dump, you must either:
  - Remove the marker (no changes to skipped rows)
  - Fetch full data for that table

**Nested limits:**

Limits apply at each nesting level:

```bash
db-editor dump full --limit 50 --nested-limit 20
```

- Root tables: max 50 rows each
- Nested children: max 20 rows per parent

```json
{
  "organizations": [
    {
      "id": "org-1",
      "projects": [
        { "id": "proj-1", "name": "Alpha" },
        // ... 18 more ...
        { "$partial": true, "skipped": 100 }
      ]
    }
  ]
}
```

### References (Collapsed Compositions)

Any nested composition can be represented as a **reference** instead of fully expanded:

```json
{
  "users": [
    {
      "id": "user-1",
      "todoLists": [
        { "$ref": true, "id": "list-1" },
        { "$ref": true, "id": "list-2" }
      ]
    }
  ]
}
```

vs fully expanded:

```json
{
  "users": [
    {
      "id": "user-1",
      "todoLists": [
        { "id": "list-1", "name": "Work", "entries": [...] },
        { "id": "list-2", "name": "Personal", "entries": [...] }
      ]
    }
  ]
}
```

**Use cases:**
- Large nested data: collapse to refs, expand on demand
- VS Code extension: "unfold" a `$ref` to fetch and inline the full data
- Mixed: some children expanded, others collapsed

**On sync:** Refs are converted to flat rows (just the FK relationship). The referenced row must exist elsewhere in the dump or database.

---

## File Formats

### schema.json

```json
{
  "$schema": "...",
  "tables": {
    "Organization": {
      "columns": [...],
      "primaryKey": ["id"]
    }
  },
  "relationships": [
    {
      "id": "rel_1",
      "from": { "table": "Project", "columns": ["organizationId"] },
      "to": { "table": "Organization", "columns": ["id"] },
      "kind": "composition",
      "onDelete": "CASCADE",
      "dominant": true
    }
  ],
  "dominanceOverrides": {
    "LocalizedChapter": "Chapter"  // User override: nest under Chapter, not ProjectLanguage
  }
}
```

### .db-editor/data.base.json (FLAT - canonical)

```json
{
  "Organization": [
    { "id": "org-1", "name": "Acme" }
  ],
  "Project": [
    { "id": "proj-1", "name": "Alpha", "organizationId": "org-1" }
  ],
  "User": [...]
}
```

### data.json (nested - presentation, user edits this)

```json
{
  "$schema": "./.db-editor/data.schema.json",
  "$base": "./.db-editor/data.base.json",
  "organizations": [
    {
      "id": "org-1",
      "name": "Acme",
      "projects": [
        {
          "id": "proj-1",
          "name": "Alpha",
          "chapters": [...]
        }
      ]
    }
  ],
  "users": [...],
  "languages": [...]
}
```

### data-flat.json

```json
{
  "$schema": "./data-flat.schema.json",
  "Organization": [
    { "id": "org-1", "name": "Acme" }
  ],
  "Project": [
    { "id": "proj-1", "name": "Alpha", "organizationId": "org-1" }
  ]
}
```

---

## Testing Strategy

### Use PGLite for All Tests

[PGLite](https://github.com/electric-sql/pglite) runs PostgreSQL in-process (WebAssembly). No Docker, no external DB.

```typescript
import { PGlite } from '@electric-sql/pglite';

describe('SchemaExtractor', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();  // Fresh in-memory DB
    await db.exec(`
      CREATE TABLE Organization (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE Project (
        id TEXT PRIMARY KEY,
        name TEXT,
        organizationId TEXT REFERENCES Organization(id) ON DELETE CASCADE
      );
    `);
  });

  test('classifies CASCADE as composition', async () => {
    const schema = await extractSchema(db);
    const rel = schema.relationships.find(r => r.fromTable === 'Project');
    expect(rel?.kind).toBe('composition');
  });
});
```

### Test Categories

1. **Schema extraction tests**
   - FK classification (CASCADE → composition, RESTRICT → reference)
   - Dominance selection with multiple parents
   - Cycle detection in ownership tree

2. **Serialization tests**
   - Flat → Nested → Flat roundtrip
   - FK column removal/reconstruction
   - Multi-level nesting

3. **Sync engine tests**
   - Insert detection
   - Update detection (column-level diff)
   - Delete detection
   - Dependency ordering (FK constraints)

4. **Three-way merge tests**
   - Non-conflicting concurrent changes
   - Conflict detection
   - Row-level vs column-level conflicts

5. **Integration tests**
   - Full workflow: extract → dump → edit → sync
   - Partial dumps with filters
   - Large dataset performance

6. **Partial marker tests**
   - Marker inserted when limit exceeded
   - Markers ignored during sync diff
   - Nested limits work correctly

7. **JSON Schema generation tests**
   - `insert` mode marks auto-generated fields optional
   - `strict` mode requires all non-nullable fields
   - Serial/sequence columns detected correctly
   - DEFAULT expressions parsed

8. **Reference ($ref) tests**
   - Refs converted to flat correctly (just FK values)
   - Mixed refs and expanded in same array
   - Refs to non-existent rows detected as error

9. **Conflict marker tests**
   - Conflicts detected in three-way merge
   - Conflict markers serialized correctly
   - Sync refuses to proceed with unresolved conflicts

10. **Reset command tests**
    - `reset` only modifies mentioned rows
    - `reset --hard` invariant: `dump(DB after reset --hard) == input (flat)`
    - `reset --hard` deletes rows not in input

---

## Migration Path from Current Code

### ✅ Phase 1: Core Data Model (DONE)
- [x] Define immutable data model types (Schema, Table, Relationship, etc.)
- [x] FlatDataset and FlatRow types

### ✅ Phase 2: Schema Extraction (DONE)
- [x] Extract tables, columns, primary keys
- [x] Extract foreign key relationships  
- [x] Detect columns with defaults
- [x] PGLite tests (6 tests passing)

### ✅ Phase 3: Diff Algorithm (DONE)
- [x] Diff two FlatDatasets
- [x] Detect inserts, updates, deletes
- [x] Handle composite primary keys
- [x] Handle null values
- [x] Tests (8 tests passing)

### ✅ Phase 4: SQL Generation (DONE)
- [x] Generate INSERT, UPDATE, DELETE statements
- [x] Order changes by FK dependency
- [x] Tests (9 tests passing)

### ✅ Phase 5: Sync Engine (DONE)
- [x] Fetch current data from DB
- [x] Preview changes (dry-run)
- [x] Apply changes in transaction
- [x] Rollback on error
- [x] Integration tests with PGLite (8 tests passing)

**Total: 31 tests passing**

### Phase 6: JSON Schema & Limits (TODO)
- [ ] Detect auto-generated columns (DEFAULT, SERIAL, GENERATED)
- [ ] Implement `insert` mode (auto-generated fields optional)
- [ ] Implement `--limit` and `--nested-limit` for dumps
- [ ] Implement `PartialMarker` handling (insert on dump, ignore on sync)
- [ ] Auto-generate `.db-editor/` folder with base + schema

### Phase 7: CLI (TODO)
- [ ] Implement new command structure (dump, sync, reset)
- [ ] Add `--flat` flag support throughout
- [ ] Interactive mode with confirmation

### Phase 8: Nested Presentation (TODO - Design Only)
- [ ] Implement `toNested()` with PresentationOptions (expandDepth, limits)
- [ ] Support `$ref` markers (collapsed compositions)
- [ ] Support `$partial` markers (truncated lists)
- [ ] (fromNested not needed yet - base is always flat)

---

## Design Decisions

### Conflict Representation

Conflicts in three-way merge are represented inline in JSON:

```json
{
  "id": "user-1",
  "name": {
    "$conflict": true,
    "base": "Alice",
    "ours": "Alice Smith",
    "theirs": "Alice Johnson"
  },
  "email": "alice@example.com"
}
```

The user must resolve conflicts before sync can proceed.

### Partial Sync Scope

Three-way merge + partial markers handle this naturally:
- Rows in base but not in file → no change (not in scope)
- Rows with `$partial` marker → ignored (explicitly out of scope)
- Only rows present in both base and file are candidates for delete

### Generated / Auto-Populated Columns

- **On dump**: Generated values are included (you see what's in DB)
- **On insert**: If omitted in JSON, database generates them
- **On update**: If present, value is used; if omitted, no change to that column
- **JSON Schema**: `insert` mode marks these as optional

### Binary Data (BYTEA)

Represented as base64 strings in JSON. No special handling needed.

### Base File Management

- Base file is **always flat** (canonical representation)
- Sync **always updates base file** after successful apply
- Sync is **interactive by default**: shows diff, requires confirmation

---

## Open Questions

1. **Partial marker location**: Should partial marker be last element, or could it be at any position (for "window" queries)?

2. **Ref expansion in VS Code**: How should the extension fetch and inline `$ref` data? Live DB connection or cached?

3. **Reset command semantics**: Still unclear how `reset` vs `reset --hard` should work in practice. Needs exploration with tests.

---

## Principles

1. **Flat is data, nested is presentation** — base file is always flat; user file can be nested for comfort
2. **Sync operates on flat** — nested → flat → diff → SQL (simplifies algorithm)
3. **Dominance is explicit** — users can override, defaults are deterministic
4. **Sync is interactive** — shows diff, requires confirmation, then updates base file
5. **Tests use PGLite** — fast, isolated, no infrastructure
6. **CLI is thin** — all logic in testable business layer
7. **Dumps are self-contained** — `$schema` and `$base` refs enable autocomplete and merge out of the box
8. **Auto-generated = optional on insert** — JSON Schema treats DEFAULT columns as optional for new rows
9. **Partial is explicit** — `$partial` markers clearly indicate truncated data
10. **Refs are collapsible** — compositions can be `$ref` (collapsed) or expanded; VS Code can unfold
