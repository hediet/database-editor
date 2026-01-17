import type { FlatDataset, FlatRow, PartialMarker } from "./model";
import { isPartialMarker } from "./model";

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
	[tableName: string]: (FlatRow | PartialMarker)[] | string | undefined;
}

export interface SerializeOptions {
	/** Tables that were truncated, with count of skipped rows */
	readonly truncated?: ReadonlyMap<string, number>;
}

/**
 * Serialize a FlatDataset to a JSON string.
 */
export function serializeFlatDataset(
	dataset: FlatDataset,
	metadata?: FlatFileMetadata,
	options?: SerializeOptions
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
		const skippedCount = options?.truncated?.get(tableName);
		if (skippedCount !== undefined && skippedCount > 0) {
			// Add partial marker at end
			const marker: PartialMarker = { $partial: true, skipped: skippedCount };
			obj[tableName] = [...rows, marker];
		} else {
			obj[tableName] = [...rows];
		}
	}

	return JSON.stringify(obj, null, 2);
}

/**
 * Parse a JSON string into a FlatDataset and metadata.
 * PartialMarkers are filtered out - they indicate truncated data.
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
			// Filter out any PartialMarker entries
			const rows = value.filter((row): row is FlatRow => !isPartialMarker(row));
			tables.set(key, rows);
		}
	}

	return {
		dataset: { tables },
		metadata,
	};
}
