import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import type { Schema, ChangeSet } from "./model";
import type { DbClient } from "./schemaExtractor";
import { extractSchema } from "./schemaExtractor";
import { SyncEngine } from "./syncEngine";
import {
    serializeFlatDataset,
    parseFlatDataset,
    type FlatFileMetadata,
} from "./fileFormat";
import { generateJsonSchema } from "./jsonSchemaGenerator";
import { buildOwnershipTree } from "./ownershipTree";
import { toNested } from "./nested";

export interface DumpOptions {
	/** Output file path */
	output: string;
	/** Connection string to store in dump file */
	connectionString?: string;
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
		private readonly _engine: SyncEngine
	) {}

	/**
	 * Create a DatabaseEditor connected to a PostgreSQL database.
	 */
	static async connect(connectionString: string): Promise<DatabaseEditor> {
		const client = new Client({ connectionString });
		await client.connect();

		const schema = await extractSchema(client);
		const engine = new SyncEngine(client, schema);

		return new DatabaseEditor(client, schema, engine);
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
			const jsonSchema = generateJsonSchema(this._schema);
			fs.writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, "\t"));

			// Set up metadata references
			metadata = {
				$schema: `./.db-editor/${baseName}.schema.json`,
				$connection: options.connectionString,
				$base: `./.db-editor/${baseName}.base.json`,
			};
		}

		if (options.flat) {
			// Write flat format (with partial markers if truncated)
			const json = serializeFlatDataset(data, metadata, { truncated });
			fs.writeFileSync(outputPath, json);
		} else {
			// Write nested format (default)
			const tree = buildOwnershipTree(this._schema);
			const nested = toNested(data, this._schema, tree, {
				limit: options.limit,
				nestedLimit: options.nestedLimit,
			});

			// Build nested output object with metadata
			const output: Record<string, unknown> = {};
			if (metadata.$schema) output.$schema = metadata.$schema;
			if (metadata.$connection) output.$connection = metadata.$connection;
			if (metadata.$base) output.$base = metadata.$base;

			// Add nested data
			for (const [key, rows] of Object.entries(nested.data)) {
				output[key] = rows;
			}

			fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
		}
	}

	/**
	 * Preview changes that would be made to sync file to database.
	 * This is a dry-run that doesn't modify anything.
	 */
	async preview(inputPath: string): Promise<ChangeSet> {
		const json = fs.readFileSync(inputPath, "utf-8");
		const { dataset } = parseFlatDataset(json);

		return this._engine.preview(dataset);
	}

	/**
	 * Apply changes to make database match the file (reset --hard semantics).
	 * Uses two-way diff: file is desired state, DB rows not in file are deleted.
	 */
	async reset(inputPath: string): Promise<ChangeSet> {
		const json = fs.readFileSync(inputPath, "utf-8");
		const { dataset, metadata } = parseFlatDataset(json);

		const changes = await this._engine.apply(dataset);

		// Update base file after successful sync
		if (metadata.$base) {
			const basePath = path.resolve(path.dirname(inputPath), metadata.$base);
			const { dataset: currentData } = await this._engine.fetchCurrentData();
			const baseJson = serializeFlatDataset(currentData);
			fs.writeFileSync(basePath, baseJson);
		}

		return changes;
	}

	/**
	 * Close the database connection.
	 */
	async close(): Promise<void> {
		if ("end" in this._client && typeof this._client.end === "function") {
			await (this._client as Client).end();
		}
	}
}
