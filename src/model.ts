/**
 * Core data model types for database-editor.
 * 
 * Design principle: Immutable, readonly types. No methods that mutate.
 */

// === Schema Types ===

export interface Schema {
  readonly tables: ReadonlyMap<string, Table>;
  readonly relationships: readonly Relationship[];
}

export interface Table {
  readonly name: string;
  readonly columns: readonly Column[];
  readonly primaryKey: readonly string[];
}

export interface Column {
  readonly name: string;
  readonly type: string;
  readonly isNullable: boolean;
  readonly hasDefault: boolean;
  readonly isGenerated: boolean;
}

export interface Relationship {
  readonly id: string;
  readonly fromTable: string;
  readonly fromColumns: readonly string[];
  readonly toTable: string;
  readonly toColumns: readonly string[];
  readonly onDelete: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
  readonly onUpdate: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
}

// === Flat Data Types ===

export interface FlatDataset {
  readonly tables: ReadonlyMap<string, readonly FlatRow[]>;
}

export type FlatRow = Readonly<Record<string, unknown>>;

// === Change Types ===

export type Change = InsertChange | UpdateChange | DeleteChange;

export interface InsertChange {
  readonly type: 'insert';
  readonly table: string;
  readonly row: FlatRow;
}

export interface UpdateChange {
  readonly type: 'update';
  readonly table: string;
  readonly primaryKey: FlatRow;
  readonly oldValues: FlatRow;
  readonly newValues: FlatRow;
}

export interface DeleteChange {
  readonly type: 'delete';
  readonly table: string;
  readonly primaryKey: FlatRow;
  readonly oldRow: FlatRow;
}

export interface ChangeSet {
  readonly changes: readonly Change[];
}

// === Helpers ===

export function createSchema(tables: Table[], relationships: Relationship[]): Schema {
  return {
    tables: new Map(tables.map(t => [t.name, t])),
    relationships,
  };
}

export function createFlatDataset(data: Record<string, FlatRow[]>): FlatDataset {
  return {
    tables: new Map(Object.entries(data)),
  };
}

export function flatDatasetToObject(dataset: FlatDataset): Record<string, FlatRow[]> {
  const result: Record<string, FlatRow[]> = {};
  for (const [table, rows] of dataset.tables) {
    result[table] = [...rows];
  }
  return result;
}
