import type { FlatDataset, FlatRow } from "./model";

/**
 * Metadata fields that can appear at the top level of a flat JSON file.
 */
export interface FlatFileMetadata {
	$schema?: string;
	$base?: string;
}

/**
 * The full format of a flat JSON file (metadata + table data).
 */
export interface FlatFileFormat extends FlatFileMetadata {
	[tableName: string]: FlatRow[] | string | undefined;
}

/**
 * Serialize a FlatDataset to a JSON string.
 */
export function serializeFlatDataset(
	dataset: FlatDataset,
	metadata?: FlatFileMetadata
): string {
	const obj: FlatFileFormat = {};

	// Add metadata first (appears at top of file)
	if (metadata?.$schema) {
		obj.$schema = metadata.$schema;
	}
	if (metadata?.$base) {
		obj.$base = metadata.$base;
	}

	// Add table data
	for (const [tableName, rows] of dataset.tables) {
		obj[tableName] = [...rows];
	}

	return JSON.stringify(obj, null, 2);
}

/**
 * Parse a JSON string into a FlatDataset and metadata.
 */
export function parseFlatDataset(json: string): {
	dataset: FlatDataset;
	metadata: FlatFileMetadata;
} {
	const obj = JSON.parse(json) as FlatFileFormat;

	const metadata: FlatFileMetadata = {};
	const tables = new Map<string, FlatRow[]>();

	for (const [key, value] of Object.entries(obj)) {
		if (key === "$schema" && typeof value === "string") {
			metadata.$schema = value;
		} else if (key === "$base" && typeof value === "string") {
			metadata.$base = value;
		} else if (Array.isArray(value)) {
			tables.set(key, value);
		}
	}

	return {
		dataset: { tables },
		metadata,
	};
}
