import type { Schema, FlatDataset, FlatRow, ChangeSet, Change } from './model.ts';

/**
 * Compute the diff between current database state and desired state.
 * Returns a ChangeSet with all INSERT, UPDATE, DELETE operations needed.
 */
export function diff(schema: Schema, current: FlatDataset, desired: FlatDataset): ChangeSet {
  const changes: Change[] = [];

  // Get all table names from both datasets
  const allTables = new Set([
    ...current.tables.keys(),
    ...desired.tables.keys(),
  ]);

  for (const tableName of allTables) {
    const table = schema.tables.get(tableName);
    if (!table) {
      // Table not in schema, skip (could warn)
      continue;
    }

    const currentRows = current.tables.get(tableName) ?? [];
    const desiredRows = desired.tables.get(tableName) ?? [];

    const tableChanges = diffTable(tableName, table.primaryKey, currentRows, desiredRows);
    changes.push(...tableChanges);
  }

  return { changes };
}

function diffTable(
  tableName: string,
  primaryKey: readonly string[],
  currentRows: readonly FlatRow[],
  desiredRows: readonly FlatRow[]
): Change[] {
  const changes: Change[] = [];

  // Index rows by primary key
  const currentByPk = indexByPrimaryKey(currentRows, primaryKey);
  const desiredByPk = indexByPrimaryKey(desiredRows, primaryKey);

  // Find updates and deletes
  for (const [pkKey, currentRow] of currentByPk) {
    const desiredRow = desiredByPk.get(pkKey);

    if (desiredRow === undefined) {
      // Row deleted
      changes.push({
        type: 'delete',
        table: tableName,
        primaryKey: extractPrimaryKey(currentRow, primaryKey),
        oldRow: currentRow,
      });
    } else {
      // Check for updates
      const changedColumns = findChangedColumns(currentRow, desiredRow, primaryKey);
      if (changedColumns.length > 0) {
        const oldValues: Record<string, unknown> = {};
        const newValues: Record<string, unknown> = {};

        for (const col of changedColumns) {
          oldValues[col] = currentRow[col];
          newValues[col] = desiredRow[col];
        }

        changes.push({
          type: 'update',
          table: tableName,
          primaryKey: extractPrimaryKey(currentRow, primaryKey),
          oldValues,
          newValues,
        });
      }
    }
  }

  // Find inserts
  for (const [pkKey, desiredRow] of desiredByPk) {
    if (!currentByPk.has(pkKey)) {
      changes.push({
        type: 'insert',
        table: tableName,
        row: desiredRow,
      });
    }
  }

  return changes;
}

function indexByPrimaryKey(
  rows: readonly FlatRow[],
  primaryKey: readonly string[]
): Map<string, FlatRow> {
  const index = new Map<string, FlatRow>();

  for (const row of rows) {
    const key = primaryKey.map(col => JSON.stringify(row[col])).join('|');
    index.set(key, row);
  }

  return index;
}

function extractPrimaryKey(row: FlatRow, primaryKey: readonly string[]): FlatRow {
  const pk: Record<string, unknown> = {};
  for (const col of primaryKey) {
    pk[col] = row[col];
  }
  return pk;
}

function findChangedColumns(
  current: FlatRow,
  desired: FlatRow,
  primaryKey: readonly string[]
): string[] {
  const changed: string[] = [];
  const pkSet = new Set(primaryKey);

  // Check all columns in both rows
  const allColumns = new Set([...Object.keys(current), ...Object.keys(desired)]);

  for (const col of allColumns) {
    if (pkSet.has(col)) continue; // Skip PK columns

    const currentVal = current[col];
    const desiredVal = desired[col];

    if (!valuesEqual(currentVal, desiredVal)) {
      changed.push(col);
    }
  }

  return changed;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  // Handle null/undefined
  if (a === null && b === null) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;

  // Handle dates - normalize to ISO strings for comparison
  const aDate = toDateIfPossible(a);
  const bDate = toDateIfPossible(b);
  if (aDate !== null && bDate !== null) {
    return aDate.getTime() === bDate.getTime();
  }

  // Handle objects/arrays (deep equality via JSON)
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return a === b;
}

function toDateIfPossible(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    // Check if it's an ISO date string
    const date = new Date(value);
    if (!isNaN(date.getTime()) && value.match(/^\d{4}-\d{2}-\d{2}T/)) {
      return date;
    }
  }
  return null;
}
