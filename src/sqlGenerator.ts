import type { Schema, ChangeSet, FlatRow } from './model';

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

/**
 * Escape a PostgreSQL identifier (table or column name).
 * Doubles any embedded double-quotes to prevent SQL injection.
 */
export function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Generate SQL statements from a ChangeSet.
 */
export function generateSql(changes: ChangeSet): SqlStatement[] {
  return changes.changes.map(change => {
    switch (change.type) {
      case 'insert':
        return generateInsert(change.table, change.row);
      case 'update':
        return generateUpdate(change.table, change.primaryKey, change.newValues);
      case 'delete':
        return generateDelete(change.table, change.primaryKey);
    }
  });
}

function generateInsert(table: string, row: FlatRow): SqlStatement {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const params = columns.map(col => row[col]);

  const sql = `INSERT INTO ${escapeIdentifier(table)} (${columns.map(c => escapeIdentifier(c)).join(', ')}) VALUES (${placeholders.join(', ')});`;

  return { sql, params };
}

function generateUpdate(table: string, primaryKey: FlatRow, newValues: FlatRow): SqlStatement {
  const setCols = Object.keys(newValues);
  const pkCols = Object.keys(primaryKey);

  const params: unknown[] = [];

  // SET clause
  const setClause = setCols.map((col, i) => {
    params.push(newValues[col]);
    return `${escapeIdentifier(col)} = $${i + 1}`;
  }).join(', ');

  // WHERE clause
  const whereClause = pkCols.map((col, i) => {
    params.push(primaryKey[col]);
    return `${escapeIdentifier(col)} = $${setCols.length + i + 1}`;
  }).join(' AND ');

  const sql = `UPDATE ${escapeIdentifier(table)} SET ${setClause} WHERE ${whereClause};`;

  return { sql, params };
}

function generateDelete(table: string, primaryKey: FlatRow): SqlStatement {
  const pkCols = Object.keys(primaryKey);
  const params = pkCols.map(col => primaryKey[col]);

  const whereClause = pkCols.map((col, i) => `${escapeIdentifier(col)} = $${i + 1}`).join(' AND ');
  const sql = `DELETE FROM ${escapeIdentifier(table)} WHERE ${whereClause};`;

  return { sql, params };
}

/**
 * Order changes by dependency (FK relationships).
 * - Deletes: children before parents (reverse topological order)
 * - Inserts: parents before children (topological order)
 * - Updates: after deletes, before inserts
 */
export function orderChangesByDependency(schema: Schema, changes: ChangeSet): ChangeSet {
  // Build dependency graph: table -> tables it depends on (FK targets)
  const dependsOn = new Map<string, Set<string>>();

  for (const table of schema.tables.keys()) {
    dependsOn.set(table, new Set());
  }

  for (const rel of schema.relationships) {
    const deps = dependsOn.get(rel.fromTable);
    if (deps) {
      deps.add(rel.toTable);
    }
  }

  // Topological sort (Kahn's algorithm)
  const sorted = topologicalSort(schema.tables.keys(), dependsOn);

  // Create order map: table -> position in topological order
  const orderMap = new Map<string, number>();
  sorted.forEach((table, index) => {
    orderMap.set(table, index);
  });

  // Separate by type
  const deletes = changes.changes.filter(c => c.type === 'delete');
  const updates = changes.changes.filter(c => c.type === 'update');
  const inserts = changes.changes.filter(c => c.type === 'insert');

  // Sort each group
  // Deletes: children first (reverse topological order)
  deletes.sort((a, b) => (orderMap.get(b.table) ?? 0) - (orderMap.get(a.table) ?? 0));

  // Inserts: parents first (topological order)
  inserts.sort((a, b) => (orderMap.get(a.table) ?? 0) - (orderMap.get(b.table) ?? 0));

  // Updates: no particular order required (within transaction)

  return {
    changes: [...deletes, ...updates, ...inserts],
  };
}

function topologicalSort(
  tables: Iterable<string>,
  dependsOn: Map<string, Set<string>>
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>(); // For cycle detection

  function visit(table: string) {
    if (visited.has(table)) return;
    if (visiting.has(table)) {
      // Cycle detected - not an error for our purposes, just skip
      return;
    }

    visiting.add(table);

    const deps = dependsOn.get(table) ?? new Set();
    for (const dep of deps) {
      visit(dep);
    }

    visiting.delete(table);
    visited.add(table);
    result.push(table);
  }

  for (const table of tables) {
    visit(table);
  }

  return result;
}
