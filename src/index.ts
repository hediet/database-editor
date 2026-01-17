// Core data model
export type {
  Schema,
  Table,
  Column,
  Relationship,
  FlatDataset,
  FlatRow,
  Change,
  InsertChange,
  UpdateChange,
  DeleteChange,
  ChangeSet,
} from './model';

export {
  createSchema,
  createFlatDataset,
  flatDatasetToObject,
} from './model';

// Schema extraction
export type { DbClient } from './schemaExtractor';
export { extractSchema } from './schemaExtractor';

// Diff algorithm
export { diff } from './diff';

// SQL generation
export type { SqlStatement } from './sqlGenerator';
export { generateSql, orderChangesByDependency } from './sqlGenerator';

// Sync engine
export { SyncEngine } from './syncEngine';
