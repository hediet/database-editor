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
3. **Export** data as nested JSON (children embedded under parents)
4. **Generate** JSON Schema for IntelliSense while editing
5. **Import** changes back by diffing hierarchical JSON against flat database

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

## CLI Commands

```bash
# Extract database schema
database-editor extract -c "postgresql://..." -o database-schema.json

# Extract relationships (foreign keys)
database-editor relationships -c "postgresql://..." -o relationships.json

# Generate Mermaid ER diagram
database-editor mermaid -i relationships.json -o diagram.mmd

# Export all data as nested JSON
database-editor tojson --all -c "postgresql://..." -o table-data.json

# Generate JSON Schema (for VS Code IntelliSense)
database-editor schema -c "postgresql://..." -o table-data.schema.json

# Import changes back (compares JSON against DB, generates SQL)
database-editor import -i table-data.json -c "postgresql://..." --dry-run
```

## Relationship Classification

Foreign keys are classified based on heuristics:

| Heuristic | Classification |
|-----------|----------------|
| `ON DELETE CASCADE` | **composedBy** (parent owns child) |
| Column name contains "parent", "owner" | **composedBy** |
| Self-referencing FK | **reference** |
| Everything else | **reference** |

**composedBy** relationships get nested in JSON. **reference** relationships keep the foreign key column.

## Known Limitations / Areas for Rewrite

### 1. Hierarchical vs Flat Data Complexity

The core challenge: databases are flat (normalized), but we want hierarchical JSON.

**Current issues:**

- **Multi-parent compositions**: A child table can be "composed by" multiple parents. Example: `LocalizedChapter` is composed by both `Chapter` and `ProjectLanguage`. The current code adds it as a child to both parents, leading to duplication.

- **Flattening on import**: When importing JSON, the code flattens the hierarchy back to rows. Reconstructing foreign key values from parent context is fragile.

- **Property name inference**: Converting `LocalizedChapter` → `localizedChapters` has edge cases and is duplicated across files.

### 2. Incomplete Implementations

- `findRelationshipForChild()` in [exportToJson.ts](src/exportToJson.ts) always returns `undefined`
- `buildChildData()` in [generateJsonSchema.ts](src/generateJsonSchema.ts) has placeholder logic
- Recursive export in [importTableData.ts](src/importTableData.ts) doesn't properly handle grandchildren

### 3. Missing Features

- No ordering/sorting of exported rows
- No handling of circular references
- Limited WHERE clause support
- No transaction batching for large imports
- Error messages could be more helpful

### 4. Code Quality

- Duplicate `getTablePropertyName()` implementations across files
- No tests
- `any` types in several places
- Async `_init` patterns instead of factory methods

## Architecture Overview

```
┌─────────────────────┐
│  extractDbSchema    │  → schema (tables, columns, enums)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ extractRelationships│  → relationships (FK → composition or reference)
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐  ┌────────────────┐
│ mermaid │  │generateJsonSchema│  → JSON Schema
└─────────┘  └───────┬────────┘
                     │
                     ▼
             ┌───────────────┐
             │ exportToJson  │  → Nested JSON data
             └───────┬───────┘
                     │
                     ▼
             ┌───────────────┐
             │importTableData│  → Flatten, diff, generate SQL
             └───────────────┘
```

## Development

```bash
npm install
npm run build    # Compile TypeScript
npm run dev      # Run with tsx (no build needed)
```

## License

ISC
