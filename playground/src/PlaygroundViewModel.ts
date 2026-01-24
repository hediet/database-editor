import {
    derived,
    debouncedObservable,
    observableValue,
    ObservablePromise,
    DisposableStore,
    autorun,
    derivedObservableWithCache,
} from "@vscode/observables";
import { createServiceKey } from "@vscode/observables-react";
import { PGlite } from "@electric-sql/pglite";
import {
    extractSchema,
    buildOwnershipTree,
    toNested,
    fromNested,
    generateNestedJsonSchema,
    generateMermaid,
    diff,
    generateSql,
    orderChangesByDependency,
    Schema,
    FlatDataset,
    NestedResult,
    OwnershipTree,
    JsonSchema,
} from "database-editor";
import { AsyncLzmaCompressor } from "./utils/asyncLzmaCompressor";
import { getLocationValue, setLocation } from "./utils/HistoryController";

export interface DatabaseState {
    readonly db: PGlite;
    readonly schema: Schema;
    readonly tree: OwnershipTree;
    readonly data: FlatDataset;
    readonly nested: NestedResult;
    readonly jsonSchema: JsonSchema;
    readonly mermaid: string;
}

export const PlaygroundViewModelKey = createServiceKey<PlaygroundViewModel>("PlaygroundViewModel");

const DEFAULT_SQL = `-- Example: Blog schema with nested relationships
CREATE TABLE Users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE Posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  author_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Comments (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  post_id INTEGER NOT NULL REFERENCES Posts(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES Users(id) ON DELETE SET NULL
);

CREATE TABLE Tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE PostTags (
  post_id INTEGER NOT NULL REFERENCES Posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES Tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- Insert sample data
INSERT INTO Users (name, email) VALUES 
  ('Alice', 'alice@example.com'),
  ('Bob', 'bob@example.com');

INSERT INTO Posts (title, content, author_id) VALUES
  ('Hello World', 'My first post!', 1),
  ('Learning SQL', 'SQL is great for data management.', 1),
  ('Bob''s Post', 'Hello from Bob!', 2);

INSERT INTO Comments (body, post_id, author_id) VALUES
  ('Great post!', 1, 2),
  ('Thanks for sharing', 1, 2),
  ('Interesting read', 2, 2);

INSERT INTO Tags (name) VALUES ('tech'), ('tutorial'), ('personal');

INSERT INTO PostTags (post_id, tag_id) VALUES
  (1, 3), (2, 1), (2, 2), (3, 3);
`;

export type ViewMode = "nested" | "flat";

interface PersistedState {
    sql: string;
    baseJson?: string;
    editedJson?: string;
    mode?: ViewMode;
    limit?: number;
    nestedLimit?: number;
}

export class PlaygroundViewModel extends DisposableStore {
    private static readonly _compressor = new AsyncLzmaCompressor<PersistedState>();

    readonly sqlContent = observableValue<string>("sqlContent", DEFAULT_SQL);
    /** The frozen base JSON (left side of diff) - only updated by reset */
    readonly baseJson = observableValue<string>("baseJson", "{}");
    /** The edited JSON (right side of diff) - tracks user edits */
    readonly editedJson = observableValue<string>("editedJson", "{}");
    readonly viewMode = observableValue<ViewMode>("viewMode", "nested");
    readonly limit = observableValue<number | undefined>("limit", undefined);
    readonly nestedLimit = observableValue<number | undefined>("nestedLimit", undefined);

    private _urlSyncEnabled = false;

    /** Initialize URL state loading and syncing. Call after construction. */
    async initialize(): Promise<void> {
        await this._loadFromUrl();
        this._startUrlSync();
        this._startAutoSync();
    }

    /** Auto-update base and modified when they are equal (no pending edits) */
    private _startAutoSync(): void {
        this.add(autorun((reader) => {
            const base = this.baseJson.read(reader);
            const edited = this.editedJson.read(reader);
            const dump = this.dumpJson.read(reader);

            // If base equals edited (no pending changes) and dump differs, auto-update
            if (base === edited && dump !== base) {
                this.baseJson.set(dump, undefined);
                this.editedJson.set(dump, undefined);
            }
        }));
    }

    private readonly _debouncedSql = debouncedObservable(this.sqlContent, 500);

    private readonly _sqlExecution = derived(this, (reader) => {
        const sql = this._debouncedSql.read(reader);
        if (!sql.trim()) {
            return undefined;
        }
        const promise = ObservablePromise.fromFn(() => this._executeSql(sql));
        reader.store.add({
            dispose: () => {
                const result = promise.promiseResult.get();
                if (result?.data?.db) {
                    result.data.db.close();
                }
            }
        });
        return promise;
    });

    readonly databaseState = derived(this, (reader) => {
        const promise = this._sqlExecution.read(reader);
        if (!promise) return null;
        const result = promise.promiseResult.read(reader);
        if (!result) return null;
        if (result.error) return null;
        return result.data ?? null;
    });

    readonly isExecuting = derived(this, (reader) => {
        const promise = this._sqlExecution.read(reader);
        if (!promise) return false;
        return promise.promiseResult.read(reader) === undefined;
    });

    readonly error = derived(this, (reader) => {
        const promise = this._sqlExecution.read(reader);
        if (!promise) return null;
        const result = promise.promiseResult.read(reader);
        if (!result) return null;
        if (result.error) {
            return result.error instanceof Error ? result.error.message : String(result.error);
        }
        return null;
    });

    readonly dumpJson = derivedObservableWithCache<string>(this, (reader, lastValue) => {
        const state = this.databaseState.read(reader);
        const mode = this.viewMode.read(reader);
        const limit = this.limit.read(reader);
        const nestedLimit = this.nestedLimit.read(reader);
        if (!state) {
            return lastValue ?? "{}";
        }
        if (mode === "flat") {
            const flatObj: Record<string, unknown[]> = {};
            for (const [tableName, rows] of state.data.tables) {
                const limitedRows = limit !== undefined ? [...rows].slice(0, limit) : [...rows];
                flatObj[tableName] = limitedRows;
            }
            return JSON.stringify(flatObj, null, 2);
        }
        // For nested, re-generate with limits
        const nested = toNested(state.data, state.schema, state.tree, { limit, nestedLimit });
        return JSON.stringify(nested.data, null, 2);
    });

    readonly hasLimits = derived(this, (reader) => {
        const limit = this.limit.read(reader);
        const nestedLimit = this.nestedLimit.read(reader);
        return limit !== undefined || nestedLimit !== undefined;
    });

    /** True when the stored base differs from the current computed dump (database changed) */
    readonly needsReset = derived(this, (reader) => {
        const base = this.baseJson.read(reader);
        const computedDump = this.dumpJson.read(reader);
        return base !== computedDump;
    });

    readonly cliDumpCommand = derived(this, (reader) => {
        const mode = this.viewMode.read(reader);
        const limit = this.limit.read(reader);
        const nestedLimit = this.nestedLimit.read(reader);

        const args = ['json-db-editor dump -c "<connection-string>" -o data.json'];
        if (mode === 'flat') args.push('--flat');
        if (limit !== undefined) args.push(`--limit ${limit}`);
        if (nestedLimit !== undefined) args.push(`--nested-limit ${nestedLimit}`);
        return args.join(' ');
    });

    readonly cliMermaidCommand = derived(this, () => {
        return 'json-db-editor schema -c "<connection-string>" --mermaid';
    });

    readonly cliJsonSchemaCommand = derived(this, () => {
        return 'json-db-editor schema -c "<connection-string>" --json-schema';
    });

    readonly cliSyncCommand = derived(this, () => {
        return 'json-db-editor sync -c "<connection-string>" data.json';
    });

    readonly updateStatements = derived(this, (reader) => {
        const state = this.databaseState.read(reader);
        const baseJson = this.baseJson.read(reader);
        const editedJson = this.editedJson.read(reader);
        const hasLimits = this.hasLimits.read(reader);

        // Can't compute diff when limits are applied - partial data would cause false deletions
        if (!state || hasLimits) return [];

        try {
            // Compare stored base vs edited (not computed dump vs edited)
            const baseData = JSON.parse(baseJson);
            const editedData = JSON.parse(editedJson);
            const baseFlat = fromNested(baseData, state.schema, state.tree);
            const editedFlat = fromNested(editedData, state.schema, state.tree);
            const changes = diff(state.schema, baseFlat, editedFlat);
            const ordered = orderChangesByDependency(state.schema, changes);
            return generateSql(ordered);
        } catch {
            return [];
        }
    });

    appendSqlStatements(statements: { sql: string; params: unknown[] }[]): void {
        const statementsText = statements
            .map(stmt => {
                if (stmt.params.length === 0) {
                    return stmt.sql;
                }
                // Replace $1, $2, etc. with actual values
                let sql = stmt.sql;
                stmt.params.forEach((param, i) => {
                    const value = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : String(param);
                    sql = sql.replace(`$${i + 1}`, value);
                });
                return sql;
            })
            .join('\n');

        const currentSql = this.sqlContent.get();
        this.sqlContent.set(currentSql + '\n\n' + statementsText, undefined);

        // After appending, set base to match modified (so diff shows no changes)
        const edited = this.editedJson.get();
        this.baseJson.set(edited, undefined);
    }
    /** Reset both base and modified to current computed dump */
    resetToCurrentDump(): void {
        const dump = this.dumpJson.get();
        this.baseJson.set(dump, undefined);
        this.editedJson.set(dump, undefined);
    }

    private _hasInitializedJson = false;

    private async _executeSql(sql: string): Promise<DatabaseState | null> {
        const db = new PGlite();
        await db.exec(sql);

        const schema = await extractSchema(db);
        if (schema.tables.size === 0) {
            return null;
        }

        const tree = buildOwnershipTree(schema);
        const data = await this._fetchAllData(db, schema);
        const nested = toNested(data, schema, tree);
        const jsonSchema = generateNestedJsonSchema(schema, { ownershipTree: tree, mode: "strict" });
        const mermaidDiagram = generateMermaid(schema, { showColumns: true, highlightCompositions: true, ownershipTree: tree });

        const state: DatabaseState = { db, schema, tree, data, nested, jsonSchema, mermaid: mermaidDiagram };

        // Only auto-set base/edited on first load (not when database changes later)
        if (!this._hasInitializedJson) {
            this._hasInitializedJson = true;
            const json = JSON.stringify(nested.data, null, 2);
            this.baseJson.set(json, undefined);
            this.editedJson.set(json, undefined);
        }
        return state;
    }

    private async _fetchAllData(db: PGlite, schema: Schema): Promise<FlatDataset> {
        const tables = new Map<string, Record<string, unknown>[]>();

        for (const tableName of schema.tables.keys()) {
            const result = await db.query(`SELECT * FROM "${tableName}"`);
            tables.set(tableName, result.rows as Record<string, unknown>[]);
        }

        return { tables };
    }

    private async _loadFromUrl(): Promise<void> {
        const location = getLocationValue();
        if (location.hashValue) {
            try {
                const state = await PlaygroundViewModel._compressor.decodeData(location.hashValue);
                if (state.sql) this.sqlContent.set(state.sql, undefined);
                if (state.baseJson) {
                    this.baseJson.set(state.baseJson, undefined);
                    this._hasInitializedJson = true; // Don't overwrite with db result
                }
                if (state.editedJson) {
                    this.editedJson.set(state.editedJson, undefined);
                    this._hasInitializedJson = true;
                }
                if (state.mode) this.viewMode.set(state.mode, undefined);
                if (state.limit !== undefined) this.limit.set(state.limit, undefined);
                if (state.nestedLimit !== undefined) this.nestedLimit.set(state.nestedLimit, undefined);
            } catch (e) {
                console.error("Failed to load state from URL:", e);
            }
        }
    }

    private _startUrlSync(): void {
        this._urlSyncEnabled = true;

        const debouncedState = debouncedObservable(
            derived(this, (reader) => ({
                sql: this.sqlContent.read(reader),
                baseJson: this.baseJson.read(reader),
                editedJson: this.editedJson.read(reader),
                mode: this.viewMode.read(reader),
                limit: this.limit.read(reader),
                nestedLimit: this.nestedLimit.read(reader),
            })),
            500
        );

        this.add(autorun(async (reader) => {
            if (!this._urlSyncEnabled) return;
            const state = debouncedState.read(reader);
            try {
                const encoded = await PlaygroundViewModel._compressor.encodeData(state);
                setLocation({ hashValue: encoded, searchParams: {} }, 'replace');
            } catch (e) {
                console.error("Failed to save state to URL:", e);
            }
        }));
    }
}
