import type { Schema, FlatDataset, FlatRow, ChangeSet } from './model';
import type { DbClient } from './schemaExtractor';
import { diff } from './diff';
import { generateSql, orderChangesByDependency, escapeIdentifier } from './sqlGenerator';

export interface FetchOptions {
  /** Maximum rows to fetch per table. Undefined means no limit. */
  readonly limit?: number;
}

export interface FetchResult {
  readonly dataset: FlatDataset;
  /** Tables that were truncated due to limit, with skipped count */
  readonly truncated: ReadonlyMap<string, number>;
}

/**
 * SyncEngine handles syncing flat data to the database.
 */
export class SyncEngine {
  constructor(
    private readonly _client: DbClient,
    private readonly _schema: Schema
  ) { }

  /**
   * Fetch current data from all tables in the schema.
   */
  async fetchCurrentData(options: FetchOptions = {}): Promise<FetchResult> {
    const tables = new Map<string, FlatRow[]>();
    const truncated = new Map<string, number>();

    for (const tableName of this._schema.tables.keys()) {
      const table = this._schema.tables.get(tableName)!;
      const pk = table.primaryKey;
      const escapedTable = escapeIdentifier(tableName);
      const orderBy = pk.length > 0 ? `ORDER BY ${pk.map(c => escapeIdentifier(c)).join(', ')}` : '';

      if (options.limit !== undefined) {
        // Get total count first
        const countResult = await this._client.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM ${escapedTable}`
        );
        const totalCount = parseInt(countResult.rows[0].count, 10);

        // Fetch limited rows
        const result = await this._client.query<FlatRow>(
          `SELECT * FROM ${escapedTable} ${orderBy} LIMIT ${options.limit}`
        );
        tables.set(tableName, result.rows);

        // Track if truncated
        if (totalCount > options.limit) {
          truncated.set(tableName, totalCount - options.limit);
        }
      } else {
        const result = await this._client.query<FlatRow>(
          `SELECT * FROM ${escapedTable} ${orderBy}`
        );
        tables.set(tableName, result.rows);
      }
    }

    return { dataset: { tables }, truncated };
  }

  /**
   * Preview changes without applying them (dry run).
   */
  async preview(desired: FlatDataset): Promise<ChangeSet> {
    const { dataset: current } = await this.fetchCurrentData();
    const changes = diff(this._schema, current, desired);
    return orderChangesByDependency(this._schema, changes);
  }

  /**
   * Apply changes to make database match desired state.
   * Executes in a transaction - rolls back on any error.
   */
  async apply(desired: FlatDataset): Promise<ChangeSet> {
    const changes = await this.preview(desired);

    if (changes.changes.length === 0) {
      return changes;
    }

    const statements = generateSql(changes);

    // Execute in transaction
    await this._client.query('BEGIN');

    try {
      for (const stmt of statements) {
        await this._client.query(stmt.sql, stmt.params);
      }
      await this._client.query('COMMIT');
    } catch (error) {
      await this._client.query('ROLLBACK');
      throw error;
    }

    return changes;
  }
}
