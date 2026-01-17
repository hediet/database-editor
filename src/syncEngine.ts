import type { Schema, FlatDataset, FlatRow, ChangeSet } from './model';
import type { DbClient } from './schemaExtractor';
import { diff } from './diff';
import { generateSql, orderChangesByDependency } from './sqlGenerator';

/**
 * SyncEngine handles syncing flat data to the database.
 */
export class SyncEngine {
  constructor(
    private readonly _client: DbClient,
    private readonly _schema: Schema
  ) {}

  /**
   * Fetch current data from all tables in the schema.
   */
  async fetchCurrentData(): Promise<FlatDataset> {
    const tables = new Map<string, FlatRow[]>();

    for (const tableName of this._schema.tables.keys()) {
      const result = await this._client.query<FlatRow>(
        `SELECT * FROM "${tableName}"`
      );
      tables.set(tableName, result.rows);
    }

    return { tables };
  }

  /**
   * Preview changes without applying them (dry run).
   */
  async preview(desired: FlatDataset): Promise<ChangeSet> {
    const current = await this.fetchCurrentData();
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
