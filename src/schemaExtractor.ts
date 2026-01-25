import type { Schema, Table, Column, Relationship } from './model.ts';

/**
 * Database client interface - compatible with both pg.Client and PGlite
 */
export interface DbClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Extract schema from a PostgreSQL database.
 */
export async function extractSchema(client: DbClient, schemaName = 'public'): Promise<Schema> {
  const tables = await extractTables(client, schemaName);
  const relationships = await extractRelationships(client, schemaName);

  return {
    tables: new Map(tables.map(t => [t.name, t])),
    relationships,
  };
}

async function extractTables(client: DbClient, schemaName: string): Promise<Table[]> {
  // Get all tables
  const tablesResult = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `, [schemaName]);

  const tables: Table[] = [];

  for (const { table_name } of tablesResult.rows) {
    const columns = await extractColumns(client, schemaName, table_name);
    const primaryKey = await extractPrimaryKey(client, schemaName, table_name);

    tables.push({
      name: table_name,
      columns,
      primaryKey,
    });
  }

  return tables;
}

async function extractColumns(client: DbClient, schemaName: string, tableName: string): Promise<Column[]> {
  const result = await client.query<{
    column_name: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    is_generated: string;
  }>(`
    SELECT 
      column_name,
      udt_name,
      is_nullable,
      column_default,
      is_generated
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `, [schemaName, tableName]);

  return result.rows.map(row => ({
    name: row.column_name,
    type: row.udt_name,
    isNullable: row.is_nullable === 'YES',
    hasDefault: row.column_default !== null,
    isGenerated: row.is_generated === 'ALWAYS',
  }));
}

async function extractPrimaryKey(client: DbClient, schemaName: string, tableName: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(`
    SELECT a.attname as column_name
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE i.indisprimary
      AND n.nspname = $1
      AND c.relname = $2
    ORDER BY array_position(i.indkey, a.attnum)
  `, [schemaName, tableName]);

  return result.rows.map(r => r.column_name);
}

/**
 * Parse a PostgreSQL array string like "{a,b,c}" into a JavaScript array.
 * Handles the case where pg driver returns arrays as strings.
 */
function parsePostgresArray(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  // PostgreSQL array format: {element1,element2,...}
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    if (inner === '') return [];
    return inner.split(',');
  }
  return [value];
}

async function extractRelationships(client: DbClient, schemaName: string): Promise<Relationship[]> {
  const result = await client.query<{
    constraint_name: string;
    from_table: string;
    from_columns: string | string[];
    to_table: string;
    to_columns: string | string[];
    delete_rule: string;
    update_rule: string;
  }>(`
    SELECT
      c.conname AS constraint_name,
      cl.relname AS from_table,
      ARRAY(
        SELECT a.attname
        FROM unnest(c.conkey) WITH ORDINALITY AS cols(col, ord)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = cols.col
        ORDER BY cols.ord
      ) AS from_columns,
      cl2.relname AS to_table,
      ARRAY(
        SELECT a.attname
        FROM unnest(c.confkey) WITH ORDINALITY AS cols(col, ord)
        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = cols.col
        ORDER BY cols.ord
      ) AS to_columns,
      CASE c.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
      END AS delete_rule,
      CASE c.confupdtype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
      END AS update_rule
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_class cl2 ON cl2.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = $1
    ORDER BY c.conname
  `, [schemaName]);

  return result.rows.map(row => ({
    id: row.constraint_name,
    fromTable: row.from_table,
    fromColumns: parsePostgresArray(row.from_columns),
    toTable: row.to_table,
    toColumns: parsePostgresArray(row.to_columns),
    onDelete: row.delete_rule as Relationship['onDelete'],
    onUpdate: row.update_rule as Relationship['onUpdate'],
  }));
}
