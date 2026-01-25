import { Client } from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as fs from "fs";
import * as path from "path";
import type { Schema, ChangeSet, FlatDataset, PartialMarker } from "./model.ts";
import type { DbClient } from "./schemaExtractor.ts";
import { extractSchema } from "./schemaExtractor.ts";
import { SyncEngine } from "./syncEngine.ts";
import {
	serializeFlatDataset,
	parseFlatDataset,
	type FlatFileMetadata,
} from "./fileFormat.ts";
import { generateJsonSchema, generateNestedJsonSchema } from "./jsonSchemaGenerator.ts";
import { buildOwnershipTree, type OwnershipTree } from "./ownershipTree.ts";
import { toNested, fromNested, type NestedRow, type RefMarker } from "./nested.ts";

export interface DumpOptions {
	/** Output file path */
	output: string;
	/** Whether to create base file for three-way merge */
	createBase?: boolean;
	/** Maximum rows to fetch per table */
	limit?: number;
	/** Use flat format instead of nested (default: false) */
	flat?: boolean;
	/** Maximum nested children per parent */
	nestedLimit?: number;
}

export interface SyncResult {
	changes: ChangeSet;
	applied: boolean;
}

/**
 * High-level database editor operations.
 * Coordinates schema extraction, sync engine, and file I/O.
 */
export class DatabaseEditor {
	private constructor(
		private readonly _client: DbClient,
		private readonly _schema: Schema,
		private readonly _engine: SyncEngine,
		private readonly _isPGLite: boolean = false
	) { }

	/**
	 * Create a DatabaseEditor connected to a database.
	 * 
	 * Connection string formats:
	 * - `pglite:` or `pglite::memory:` - In-memory PGLite database
	 * - `pglite:/path/to/dir` - PGLite database persisted to filesystem
	 * - `postgresql://...` or other - PostgreSQL connection string
	 */
	static async connect(connectionString: string): Promise<DatabaseEditor> {
		if (connectionString.startsWith("pglite:")) {
			const pglitePath = connectionString.slice("pglite:".length);
			const db = new PGlite(pglitePath || undefined);
			const schema = await extractSchema(db);
			const engine = new SyncEngine(db, schema);
			return new DatabaseEditor(db, schema, engine, true);
		}

		const client = new Client({ connectionString });
		await client.connect();

		const schema = await extractSchema(client);
		const engine = new SyncEngine(client, schema);

		return new DatabaseEditor(client, schema, engine, false);
	}

	/**
	 * Create a DatabaseEditor from an existing client (useful for testing with PGLite).
	 */
	static async fromClient(client: DbClient): Promise<DatabaseEditor> {
		const schema = await extractSchema(client);
		const engine = new SyncEngine(client, schema);
		return new DatabaseEditor(client, schema, engine);
	}

	get schema(): Schema {
		return this._schema;
	}

	get engine(): SyncEngine {
		return this._engine;
	}

	/**
	 * Parse a JSON file into a FlatDataset.
	 * Handles both nested and flat formats by detecting format and converting as needed.
	 */
	private _parseFile(inputPath: string): {
		dataset: FlatDataset;
		metadata: FlatFileMetadata;
		isPartial: boolean;
	} {
		const json = fs.readFileSync(inputPath, "utf-8");
		const obj = JSON.parse(json);

		// Extract metadata
		const metadata: FlatFileMetadata = {};
		if (typeof obj.$schema === "string") metadata.$schema = obj.$schema;
		if (typeof obj.$connection === "string") metadata.$connection = obj.$connection;
		if (typeof obj.$base === "string") metadata.$base = obj.$base;

		// Try to detect if this is nested format by checking if keys are camelCase
		// and if there are nested arrays inside rows
		const tree = buildOwnershipTree(this._schema);
		const isNested = this._isNestedFormat(obj, tree);

		if (isNested) {
			// Parse as nested format
			const nestedData: Record<string, (NestedRow | PartialMarker | RefMarker)[]> = {};
			let isPartial = false;

			for (const [key, value] of Object.entries(obj)) {
				if (key.startsWith("$")) continue; // Skip metadata
				if (Array.isArray(value)) {
					// Check for partial markers
					for (const row of value) {
						if (typeof row === "object" && row !== null && "$partial" in row) {
							isPartial = true;
						}
					}
					nestedData[key] = value as (NestedRow | PartialMarker | RefMarker)[];
				}
			}

			const dataset = fromNested(nestedData, this._schema, tree);
			return { dataset, metadata, isPartial };
		} else {
			// Parse as flat format
			return parseFlatDataset(json);
		}
	}

	/**
	 * Detect if the JSON object is in nested format.
	 * Nested format has camelCase root keys matching root tables.
	 */
	private _isNestedFormat(obj: Record<string, unknown>, tree: OwnershipTree): boolean {
		// Check if any root table (in camelCase) appears as a key
		for (const rootTable of tree.roots) {
			const camelKey = rootTable[0].toLowerCase() + rootTable.slice(1);
			if (camelKey in obj) {
				return true;
			}
		}
		// Check if any PascalCase table name appears (indicates flat format)
		for (const tableName of this._schema.tables.keys()) {
			if (tableName in obj && tableName[0] === tableName[0].toUpperCase()) {
				return false;
			}
		}
		return false;
	}

	/**
	 * Load and parse the base file referenced in metadata.
	 */
	private _loadBaseFile(inputPath: string, metadata: FlatFileMetadata): FlatDataset | null {
		if (!metadata.$base) {
			return null;
		}
		const basePath = path.resolve(path.dirname(inputPath), metadata.$base);
		if (!fs.existsSync(basePath)) {
			return null;
		}
		const baseJson = fs.readFileSync(basePath, "utf-8");
		const { dataset } = parseFlatDataset(baseJson);
		return dataset;
	}

	/**
	 * Dump current database state to a JSON file.
	 * By default uses nested format; use flat: true for flat format.
	 */
	async dump(options: DumpOptions): Promise<void> {
		const { dataset: data, truncated } = await this._engine.fetchCurrentData({ limit: options.limit });

		// Prepare output directory
		const outputPath = path.resolve(options.output);
		const outputDir = path.dirname(outputPath);
		const baseName = path.basename(outputPath, ".json");

		// Create .db-editor directory for metadata files
		const dbEditorDir = path.join(outputDir, ".db-editor");

		// Build ownership tree (needed for both nested format and nested schema)
		const tree = buildOwnershipTree(this._schema);

		let metadata: FlatFileMetadata = {};

		if (options.createBase !== false) {
			// Create .db-editor directory
			if (!fs.existsSync(dbEditorDir)) {
				fs.mkdirSync(dbEditorDir, { recursive: true });
			}

			// Write base file (flat, for three-way merge) - always without partial markers
			const basePath = path.join(dbEditorDir, `${baseName}.base.json`);
			const baseJson = serializeFlatDataset(data);
			fs.writeFileSync(basePath, baseJson);

			// Write JSON schema file (for autocomplete/validation)
			const schemaPath = path.join(dbEditorDir, `${baseName}.schema.json`);
			const jsonSchema = options.flat
				? generateJsonSchema(this._schema)
				: generateNestedJsonSchema(this._schema, { ownershipTree: tree });
			fs.writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, "\t"));

			// Set up metadata references
			metadata = {
				$schema: `./.db-editor/${baseName}.schema.json`,
				$base: `./.db-editor/${baseName}.base.json`,
			};
		}

		if (options.flat) {
			// Write flat format (with partial markers if truncated)
			const json = serializeFlatDataset(data, metadata, { truncated });
			fs.writeFileSync(outputPath, json);
		} else {
			// Write nested format (default)
			const nested = toNested(data, this._schema, tree, {
				limit: options.limit,
				nestedLimit: options.nestedLimit,
			});

			// Build nested output object with metadata
			const output: Record<string, unknown> = {};
			if (metadata.$schema) output.$schema = metadata.$schema;
			if (metadata.$base) output.$base = metadata.$base;

			// Add nested data
			for (const [key, rows] of Object.entries(nested.data)) {
				output[key] = rows;
			}

			fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
		}
	}

	/**
	 * Preview changes that would be made by sync (three-way merge).
	 * Compares base file vs edited file to determine user's intended changes.
	 * Falls back to two-way diff (reset semantics) if no base file exists.
	 * @throws Error if the file contains partial/truncated data
	 */
	async preview(inputPath: string): Promise<ChangeSet> {
		const { dataset, metadata, isPartial } = this._parseFile(inputPath);

		if (isPartial) {
			throw new Error(
				"Cannot sync partial data. The file was exported with --limit and contains truncated tables. " +
				"Re-export without --limit to sync all data."
			);
		}

		const base = this._loadBaseFile(inputPath, metadata);
		if (base) {
			// Three-way: diff base vs edited
			return this._engine.diffAgainstBase(base, dataset);
		} else {
			// Fallback to two-way: diff DB vs file
			return this._engine.diffAgainstDb(dataset);
		}
	}

	/**
	 * Preview changes for reset (two-way diff: DB vs file).
	 * Shows what changes would make the DB exactly match the file.
	 * @throws Error if the file contains partial/truncated data
	 */
	async previewReset(inputPath: string): Promise<ChangeSet> {
		const { dataset, isPartial } = this._parseFile(inputPath);

		if (isPartial) {
			throw new Error(
				"Cannot reset with partial data. The file was exported with --limit and contains truncated tables. " +
				"Re-export without --limit to sync all data."
			);
		}

		// Two-way: diff current DB vs file
		return this._engine.diffAgainstDb(dataset);
	}

	/**
	 * Sync changes from file to database using three-way merge.
	 * Only applies changes the user made (comparing base vs edited).
	 * This preserves DB changes made by others since the dump.
	 * @throws Error if the file contains partial/truncated data or no base file
	 */
	async sync(inputPath: string): Promise<ChangeSet> {
		const { dataset, metadata, isPartial } = this._parseFile(inputPath);

		if (isPartial) {
			throw new Error(
				"Cannot sync partial data. The file was exported with --limit and contains truncated tables. " +
				"Re-export without --limit to sync all data."
			);
		}

		const base = this._loadBaseFile(inputPath, metadata);
		if (!base) {
			throw new Error(
				"Cannot sync without a base file. The file must have a $base reference to enable three-way merge. " +
				"Use 'reset' command for two-way sync (make DB match file exactly), or re-export with base file."
			);
		}

		// Three-way merge: diff base vs edited, apply to DB
		const changes = this._engine.diffAgainstBase(base, dataset);
		await this._engine.applyChanges(changes);

		// Update base file to match current edited state
		this._updateBaseFile(inputPath, metadata, dataset);

		return changes;
	}

	/**
	 * Reset database to match file exactly (two-way diff).
	 * WARNING: Rows in DB but not in file will be deleted!
	 * @throws Error if the file contains partial/truncated data
	 */
	async reset(inputPath: string): Promise<ChangeSet> {
		const { dataset, metadata, isPartial } = this._parseFile(inputPath);

		if (isPartial) {
			throw new Error(
				"Cannot reset with partial data. The file was exported with --limit and contains truncated tables. " +
				"Re-export without --limit to sync all data."
			);
		}

		const changes = await this._engine.apply(dataset);

		// Update base file after successful reset
		if (metadata.$base) {
			this._updateBaseFile(inputPath, metadata, dataset);
		}

		return changes;
	}

	/**
	 * Update the base file to reflect the new state after sync/reset.
	 */
	private _updateBaseFile(inputPath: string, metadata: FlatFileMetadata, dataset: FlatDataset): void {
		if (!metadata.$base) return;
		const basePath = path.resolve(path.dirname(inputPath), metadata.$base);
		const baseJson = serializeFlatDataset(dataset);
		fs.writeFileSync(basePath, baseJson);
	}

	/**
	 * Close the database connection.
	 */
	async close(): Promise<void> {
		if (this._isPGLite) {
			await (this._client as PGlite).close();
		} else if ("end" in this._client && typeof this._client.end === "function") {
			await (this._client as Client).end();
		}
	}
}
