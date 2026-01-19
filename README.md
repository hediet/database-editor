# Database Editor

A CLI tool for PostgreSQL that converts relational database schemas into editable hierarchical JSON and back.

## Vision

Work with your database data as **nested, hierarchical JSON** rather than flat relational tables. Edit the JSON in VS Code (with full schema validation), then sync changes back to the database.

## What It Does

```
PostgreSQL ←→ Hierarchical JSON ←→ Edit in VS Code
```

1. **Extract** database schema and foreign key relationships
2. **Classify** relationships as "composition" (parent owns child) vs "reference" (lookup)
3. **Build** an ownership tree to determine nesting structure
4. **Export** data as nested JSON (children embedded under parents)
5. **Generate** JSON Schema for IntelliSense while editing
6. **Sync** changes back by diffing JSON against the database

## Example

Instead of flat tables like:

```sql
-- Organization table
| id | name    |
|----|---------|
| 1  | Acme    |

-- Project table
| id | name   | organizationId |
|----|--------|----------------|
| 10 | Alpha  | 1              |
```

You edit nested JSON:

```json
{
  "$schema": "./.db-editor/data.schema.json",
  "organizations": [
    {
      "id": "1",
      "name": "Acme",
      "projects": [
        { "id": "10", "name": "Alpha" }
      ]
    }
  ]
}
```

## Installation

```bash
npm install
npm run build
```

## Demo

See [src/demo.test.ts](src/demo.test.ts) for a complete CI-verified workflow example that demonstrates:
- Creating a todo-list schema with users, lists, items, and tags
- Dumping nested JSON with the ownership tree
- Editing data via object manipulation
- Previewing the generated SQL statements

## CLI Commands

### dump

Export database tables to a JSON file (nested format by default):

```bash
# Dump all tables as nested JSON
db-editor dump -c "postgresql://..." -o data.json

# Dump with row limits
db-editor dump -c "postgresql://..." -o data.json --limit 100

# Dump with nested limits (max children per parent)
db-editor dump -c "postgresql://..." -o data.json --nested-limit 20

# Dump as flat JSON (table-per-key)
db-editor dump -c "postgresql://..." -o data.json --flat
```

The dump command creates three files:
- `data.json` — Main file you edit
- `.db-editor/data.base.json` — Base snapshot for diffing
- `.db-editor/data.schema.json` — JSON Schema for autocomplete

### preview

Show changes that would be applied without executing them:

```bash
# Preview changes
db-editor preview -c "postgresql://..." -f data.json

# Preview with SQL output
db-editor preview -c "postgresql://..." -f data.json --sql
```

### sync

Apply changes from file to database (interactive by default):

```bash
# Interactive sync (shows diff, asks for confirmation)
db-editor sync -c "postgresql://..." -f data.json

# Non-interactive sync
db-editor sync -c "postgresql://..." -f data.json --yes
```

### reset

Reset database to match file exactly:

```bash
# Interactive reset
db-editor reset -c "postgresql://..." -f data.json

# Non-interactive reset
db-editor reset -c "postgresql://..." -f data.json --yes
```

### mermaid

Export database schema as a Mermaid ER diagram:

```bash
# Output to stdout
db-editor mermaid -c "postgresql://..."

# Output to file
db-editor mermaid -c "postgresql://..." -o diagram.mmd

# Hide column details
db-editor mermaid -c "postgresql://..." --no-columns
```

## Relationship Classification

Foreign keys are classified based on `ON DELETE` behavior:

| ON DELETE Action | Classification |
|------------------|----------------|
| `CASCADE` | **composition** (parent owns child) |
| `SET NULL` | reference |
| `RESTRICT` | reference |
| `NO ACTION` | reference |
| Self-referencing | reference (always) |

**Composition** relationships get nested in JSON (FK columns removed). **Reference** relationships keep the foreign key column inline.

## Ownership Tree

For tables with multiple incoming compositions (multi-parent), exactly one is designated as **dominant**. The dominant relationship determines where the child appears nested in the JSON tree.

Dominance is selected by:
1. Shortest path from a root table
2. Single-column FK preferred over composite
3. Alphabetical (deterministic fallback)

## File Formats

### Nested Format (default)

```json
{
  "$schema": "./.db-editor/data.schema.json",
  "organizations": [
    {
      "id": "org-1",
      "name": "Acme",
      "projects": [
        {
          "id": "proj-1",
          "name": "Alpha"
        }
      ]
    }
  ]
}
```

### Flat Format

```json
{
  "Organization": [
    { "id": "org-1", "name": "Acme" }
  ],
  "Project": [
    { "id": "proj-1", "name": "Alpha", "organizationId": "org-1" }
  ]
}
```

### Special Markers

**Partial marker** — Indicates truncated lists (from `--limit`):
```json
{ "$partial": true, "skipped": 1000 }
```

**Reference marker** — Collapsed child (FK only, not expanded):
```json
{ "$ref": true, "id": "proj-1" }
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                           │
│  (commander, argument parsing, output formatting)           │
└─────────────────────────────────┬───────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│                     DatabaseEditor                          │
│  (orchestrates dump, preview, sync, reset operations)       │
└─────────────────────────────────┬───────────────────────────┘
                                  │
   ┌──────────────┬───────────────┼───────────────┬───────────┐
   ▼              ▼               ▼               ▼           ▼
┌──────────┐ ┌──────────┐ ┌────────────┐ ┌───────────┐ ┌──────────┐
│Schema    │ │Ownership │ │ Nested     │ │   Diff    │ │   SQL    │
│Extractor │ │Tree      │ │ Serializer │ │ Algorithm │ │Generator │
└──────────┘ └──────────┘ └────────────┘ └───────────┘ └──────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│                      SyncEngine                             │
│  (fetch, diff, apply changes in transaction)                │
└─────────────────────────────────────────────────────────────┘
```

### Module Overview

| Module | Description |
|--------|-------------|
| [schemaExtractor.ts](src/schemaExtractor.ts) | Extracts tables, columns, FKs from PostgreSQL |
| [ownershipTree.ts](src/ownershipTree.ts) | Builds ownership tree, classifies relationships |
| [nested.ts](src/nested.ts) | Converts between flat and nested representations |
| [diff.ts](src/diff.ts) | Diffs two flat datasets (insert/update/delete) |
| [sqlGenerator.ts](src/sqlGenerator.ts) | Generates SQL from change sets |
| [syncEngine.ts](src/syncEngine.ts) | Orchestrates sync with transaction support |
| [jsonSchemaGenerator.ts](src/jsonSchemaGenerator.ts) | Generates JSON Schema for autocomplete |
| [mermaidGenerator.ts](src/mermaidGenerator.ts) | Generates Mermaid ER diagrams |
| [databaseEditor.ts](src/databaseEditor.ts) | High-level API (dump, preview, sync, reset) |

## Development

```bash
npm install
npm run build     # Compile TypeScript
npm test          # Run tests (watch mode)
npm run test:run  # Run tests once
```

### Testing

All tests use [PGLite](https://github.com/electric-sql/pglite) — PostgreSQL running in-process via WebAssembly. No Docker or external database needed.

```bash
npm run test:run
# 95 tests passing across 11 test files
```

## License

ISC
