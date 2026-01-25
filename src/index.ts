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
} from './model.ts';

export {
  createSchema,
  createFlatDataset,
  flatDatasetToObject,
  isPartialMarker,
} from './model.ts';

// Schema extraction
export type { DbClient } from './schemaExtractor.ts';
export { extractSchema } from './schemaExtractor.ts';

// Diff algorithm
export { diff } from './diff.ts';

// SQL generation
export type { SqlStatement } from './sqlGenerator.ts';
export { generateSql, orderChangesByDependency, escapeIdentifier } from './sqlGenerator.ts';

// Sync engine
export { SyncEngine } from './syncEngine.ts';

// Ownership tree
export type {
  RelationshipKind,
  ClassifiedRelationship,
  OwnershipEdge,
  OwnershipTree,
} from './ownershipTree.ts';
export { buildOwnershipTree } from './ownershipTree.ts';

// Nested format
export type { NestedRow, RefMarker, ToNestedOptions, NestedResult } from './nested.ts';
export { toNested, fromNested, isRefMarker } from './nested.ts';

// JSON Schema generation
export type {
  JsonSchema,
  SchemaMode,
  JsonSchemaOptions,
  NestedJsonSchemaOptions,
} from './jsonSchemaGenerator.ts';
export { generateJsonSchema, generateNestedJsonSchema } from './jsonSchemaGenerator.ts';

// Mermaid diagram generation
export type { MermaidOptions } from './mermaidGenerator.ts';
export { generateMermaid } from './mermaidGenerator.ts';

