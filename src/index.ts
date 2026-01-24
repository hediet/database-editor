// Core data model
export type {
  Schema,
  Table,
  Column,
  Relationship,
  FlatDataset,
  FlatRow,
  PartialMarker,
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
  isPartialMarker,
} from './model';

// Schema extraction
export type { DbClient } from './schemaExtractor';
export { extractSchema } from './schemaExtractor';

// Diff algorithm
export { diff } from './diff';

// SQL generation
export type { SqlStatement } from './sqlGenerator';
export { generateSql, orderChangesByDependency, escapeIdentifier } from './sqlGenerator';

// Sync engine
export { SyncEngine } from './syncEngine';

// Ownership tree
export type {
  RelationshipKind,
  ClassifiedRelationship,
  OwnershipEdge,
  OwnershipTree,
} from './ownershipTree';
export { buildOwnershipTree } from './ownershipTree';

// Nested format
export type { NestedRow, RefMarker, ToNestedOptions, NestedResult } from './nested';
export { toNested, fromNested, isRefMarker } from './nested';

// JSON Schema generation
export type {
  JsonSchema,
  SchemaMode,
  JsonSchemaOptions,
  NestedJsonSchemaOptions,
} from './jsonSchemaGenerator';
export { generateJsonSchema, generateNestedJsonSchema } from './jsonSchemaGenerator';

// Mermaid diagram generation
export type { MermaidOptions } from './mermaidGenerator';
export { generateMermaid } from './mermaidGenerator';

