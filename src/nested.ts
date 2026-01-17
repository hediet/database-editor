import type { FlatDataset, FlatRow, PartialMarker, Schema } from "./model";
import { isPartialMarker } from "./model";
import type { OwnershipTree, OwnershipEdge } from "./ownershipTree";

// === Nested Data Types ===

/**
 * A row in nested format. Contains scalar columns plus nested children arrays.
 */
export type NestedRow = Readonly<Record<string, unknown>>;

/**
 * Reference marker - a collapsed composition showing only the primary key.
 */
export interface RefMarker {
	readonly $ref: true;
	readonly [pkColumn: string]: unknown;
}

export function isRefMarker(value: unknown): value is RefMarker {
	return (
		typeof value === "object" &&
		value !== null &&
		"$ref" in value &&
		(value as RefMarker).$ref === true
	);
}

// === Conversion Options ===

export interface ToNestedOptions {
	/** Maximum rows per root table (undefined = no limit) */
	readonly limit?: number;
	/** Maximum nested children per parent (undefined = no limit) */
	readonly nestedLimit?: number;
}

export interface NestedResult {
	/** The nested data keyed by root table name (camelCase) */
	readonly data: Record<string, (NestedRow | PartialMarker)[]>;
	/** Total counts for tables that were truncated */
	readonly truncated: Map<string, number>;
}

// === toNested ===

/**
 * Convert a flat dataset to nested format based on the ownership tree.
 * 
 * For each row, children from dominant compositions are nested inline,
 * and FK columns pointing to the parent are removed (implicit from nesting).
 */
export function toNested(
	flat: FlatDataset,
	schema: Schema,
	tree: OwnershipTree,
	options: ToNestedOptions = {}
): NestedResult {
	const data: Record<string, (NestedRow | PartialMarker)[]> = {};
	const truncated = new Map<string, number>();

	// Index all rows by table and primary key for efficient lookup
	const rowIndex = buildRowIndex(flat, schema);

	// Process each root table
	for (const rootTable of tree.roots) {
		const rows = flat.tables.get(rootTable) ?? [];
		const nestedRows: (NestedRow | PartialMarker)[] = [];

		// Apply limit if specified
		const limit = options.limit;
		const limitedRows = limit !== undefined ? rows.slice(0, limit) : rows;
		
		for (const row of limitedRows) {
			nestedRows.push(nestRow(row, rootTable, schema, tree, rowIndex, options));
		}

		// Add partial marker if truncated
		if (limit !== undefined && rows.length > limit) {
			truncated.set(rootTable, rows.length - limit);
			nestedRows.push({ $partial: true, skipped: rows.length - limit });
		}

		data[toCamelCase(rootTable)] = nestedRows;
	}

	return { data, truncated };
}

function nestRow(
	row: FlatRow,
	tableName: string,
	schema: Schema,
	tree: OwnershipTree,
	rowIndex: RowIndex,
	options: ToNestedOptions
): NestedRow {
	const result: Record<string, unknown> = { ...row };

	// Get children that nest under this table
	const children = tree.getChildren(tableName);

	for (const edge of children) {
		const childTable = edge.childTable;
		const childRows = findChildRows(row, edge, schema, rowIndex);

		// Apply nested limit
		const limit = options.nestedLimit;
		const limitedRows = limit !== undefined ? childRows.slice(0, limit) : childRows;

		// Recursively nest children (removing FK columns)
		const nestedChildren: (NestedRow | PartialMarker)[] = limitedRows.map((childRow) => {
			// Remove FK columns that point to parent (they're implicit from nesting)
			const withoutFk = removeFkColumns(childRow, edge.foreignKeyColumns);
			return nestRow(withoutFk, childTable, schema, tree, rowIndex, options);
		});

		// Add partial marker if truncated
		if (limit !== undefined && childRows.length > limit) {
			nestedChildren.push({ $partial: true, skipped: childRows.length - limit });
		}

		result[toCamelCase(childTable)] = nestedChildren;
	}

	return result;
}

function removeFkColumns(row: FlatRow, fkColumns: readonly string[]): FlatRow {
	const result: Record<string, unknown> = {};
	const fkSet = new Set(fkColumns);
	for (const [key, value] of Object.entries(row)) {
		if (!fkSet.has(key)) {
			result[key] = value;
		}
	}
	return result;
}

// === fromNested ===

/**
 * Convert nested data back to flat format.
 * 
 * Reconstructs FK columns from parent context and flattens all nested children.
 */
export function fromNested(
	nested: Record<string, (NestedRow | PartialMarker | RefMarker)[]>,
	schema: Schema,
	tree: OwnershipTree
): FlatDataset {
	const tables = new Map<string, FlatRow[]>();

	// Initialize all tables
	for (const tableName of schema.tables.keys()) {
		tables.set(tableName, []);
	}

	// Process each root table
	for (const rootTable of tree.roots) {
		const camelName = toCamelCase(rootTable);
		const rows = nested[camelName] ?? [];

		for (const row of rows) {
			if (isPartialMarker(row)) continue; // Skip partial markers
			if (isRefMarker(row)) continue; // Refs at root level are unusual, skip
			
			flattenRow(row, rootTable, undefined, schema, tree, tables);
		}
	}

	return { tables };
}

function flattenRow(
	nested: NestedRow,
	tableName: string,
	parentContext: { edge: OwnershipEdge; parentRow: FlatRow } | undefined,
	schema: Schema,
	tree: OwnershipTree,
	tables: Map<string, FlatRow[]>
): void {
	const table = schema.tables.get(tableName);
	if (!table) return;

	// Extract scalar columns (non-array values)
	const flatRow: Record<string, unknown> = {};
	const columnNames = new Set(table.columns.map((c) => c.name));

	for (const [key, value] of Object.entries(nested)) {
		// Check if this is a scalar column (exists in table schema)
		if (columnNames.has(key)) {
			flatRow[key] = value;
		}
	}

	// Reconstruct FK columns from parent context
	if (parentContext) {
		const { edge, parentRow } = parentContext;
		const parentTable = schema.tables.get(edge.parentTable);
		if (parentTable) {
			// Map FK columns from parent's PK
			for (let i = 0; i < edge.foreignKeyColumns.length; i++) {
				const fkCol = edge.foreignKeyColumns[i];
				const pkCol = edge.relationship.toColumns[i];
				flatRow[fkCol] = parentRow[pkCol];
			}
		}
	}

	// Add to flat tables
	tables.get(tableName)?.push(flatRow);

	// Process nested children
	const children = tree.getChildren(tableName);
	for (const edge of children) {
		const childKey = toCamelCase(edge.childTable);
		const childArray = nested[childKey];

		if (Array.isArray(childArray)) {
			for (const childRow of childArray) {
				if (isPartialMarker(childRow)) continue;
				if (isRefMarker(childRow)) {
					// For refs, create a minimal row with just PK + FK
					handleRefMarker(childRow, edge, flatRow, schema, tables);
					continue;
				}
				flattenRow(
					childRow as NestedRow,
					edge.childTable,
					{ edge, parentRow: flatRow },
					schema,
					tree,
					tables
				);
			}
		}
	}
}

function handleRefMarker(
	ref: RefMarker,
	edge: OwnershipEdge,
	parentRow: FlatRow,
	schema: Schema,
	tables: Map<string, FlatRow[]>
): void {
	const childTable = schema.tables.get(edge.childTable);
	if (!childTable) return;

	// Build row from ref's PK values + FK to parent
	const flatRow: Record<string, unknown> = {};

	// Copy PK values from ref marker
	for (const pkCol of childTable.primaryKey) {
		if (pkCol in ref && pkCol !== "$ref") {
			flatRow[pkCol] = ref[pkCol];
		}
	}

	// Add FK columns from parent context
	for (let i = 0; i < edge.foreignKeyColumns.length; i++) {
		const fkCol = edge.foreignKeyColumns[i];
		const pkCol = edge.relationship.toColumns[i];
		flatRow[fkCol] = parentRow[pkCol];
	}

	tables.get(edge.childTable)?.push(flatRow);
}

// === Helpers ===

type RowIndex = Map<string, Map<string, FlatRow[]>>;

function buildRowIndex(flat: FlatDataset, schema: Schema): RowIndex {
	const index: RowIndex = new Map();

	for (const [tableName, rows] of flat.tables) {
		const table = schema.tables.get(tableName);
		if (!table) continue;

		// Index by primary key
		const pkIndex = new Map<string, FlatRow[]>();
		for (const row of rows) {
			const pkKey = table.primaryKey.map((col) => JSON.stringify(row[col])).join("|");
			const existing = pkIndex.get(pkKey) ?? [];
			existing.push(row);
			pkIndex.set(pkKey, existing);
		}
		index.set(tableName, pkIndex);
	}

	return index;
}

function findChildRows(
	parentRow: FlatRow,
	edge: OwnershipEdge,
	schema: Schema,
	rowIndex: RowIndex
): FlatRow[] {
	const childTableRows = rowIndex.get(edge.childTable);
	if (!childTableRows) return [];

	// Build FK key from parent's PK values
	const parentTable = schema.tables.get(edge.parentTable);
	if (!parentTable) return [];

	// Find all child rows where FK matches parent's PK
	const result: FlatRow[] = [];
	const allRows = [...(childTableRows.values())].flat();

	for (const childRow of allRows) {
		let matches = true;
		for (let i = 0; i < edge.foreignKeyColumns.length; i++) {
			const fkCol = edge.foreignKeyColumns[i];
			const pkCol = edge.relationship.toColumns[i];
			if (childRow[fkCol] !== parentRow[pkCol]) {
				matches = false;
				break;
			}
		}
		if (matches) {
			result.push(childRow);
		}
	}

	return result;
}

function toCamelCase(tableName: string): string {
	// Simple: lowercase first letter
	// Could be more sophisticated for PascalCase → camelCase
	if (tableName.length === 0) return tableName;
	return tableName[0].toLowerCase() + tableName.slice(1);
}

export function fromCamelCase(camelName: string): string {
	// Reverse: uppercase first letter
	if (camelName.length === 0) return camelName;
	return camelName[0].toUpperCase() + camelName.slice(1);
}
