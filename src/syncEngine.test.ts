import { describe, test, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SyncEngine } from './syncEngine';
import { extractSchema } from './schemaExtractor';
import { createFlatDataset } from './model';

describe('SyncEngine', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
  });

  describe('preview (dry run)', () => {
    test('shows inserts for new rows', async () => {
      await db.exec(`
        CREATE TABLE "User" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      const desired = createFlatDataset({
        User: [{ id: 'user-1', name: 'Alice' }],
      });

      const preview = await engine.preview(desired);

      expect(preview.changes.map(c => ({ type: c.type, table: c.table }))).toMatchInlineSnapshot(`
        [
          {
            "table": "User",
            "type": "insert",
          },
        ]
      `);
    });

    test('shows deletes for removed rows', async () => {
      await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        INSERT INTO "User" VALUES ('user-1', 'Alice');
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      const desired = createFlatDataset({
        User: [],
      });

      const preview = await engine.preview(desired);

      expect(preview.changes.map(c => ({ type: c.type, table: c.table }))).toMatchInlineSnapshot(`
        [
          {
            "table": "User",
            "type": "delete",
          },
        ]
      `);
    });
  });

  describe('apply', () => {
    test('inserts new rows', async () => {
      await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT NOT NULL)
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      const desired = createFlatDataset({
        User: [
          { id: 'user-1', name: 'Alice' },
          { id: 'user-2', name: 'Bob' },
        ],
      });

      await engine.apply(desired);

      const result = await db.query('SELECT * FROM "User" ORDER BY id');
      expect(result.rows).toMatchInlineSnapshot(`
        [
          {
            "id": "user-1",
            "name": "Alice",
          },
          {
            "id": "user-2",
            "name": "Bob",
          },
        ]
      `);
    });

    test('updates existing rows', async () => {
      await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        INSERT INTO "User" VALUES ('user-1', 'Alice');
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      const desired = createFlatDataset({
        User: [{ id: 'user-1', name: 'Alice Updated' }],
      });

      await engine.apply(desired);

      const result = await db.query('SELECT * FROM "User"');
      expect(result.rows).toMatchInlineSnapshot(`
        [
          {
            "id": "user-1",
            "name": "Alice Updated",
          },
        ]
      `);
    });

    test('deletes removed rows', async () => {
      await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        INSERT INTO "User" VALUES ('user-1', 'Alice');
        INSERT INTO "User" VALUES ('user-2', 'Bob');
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      const desired = createFlatDataset({
        User: [{ id: 'user-1', name: 'Alice' }],
      });

      await engine.apply(desired);

      const result = await db.query('SELECT * FROM "User"');
      expect(result.rows).toMatchInlineSnapshot(`
        [
          {
            "id": "user-1",
            "name": "Alice",
          },
        ]
      `);
    });

    test('handles complex scenario with FK dependencies', async () => {
      await db.exec(`
        CREATE TABLE "Organization" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE "Project" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE
        );
        
        INSERT INTO "Organization" VALUES ('org-1', 'Acme');
        INSERT INTO "Project" VALUES ('proj-1', 'Alpha', 'org-1');
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      // Add new org, add project to it, delete old org (cascades to delete old project)
      const desired = createFlatDataset({
        Organization: [{ id: 'org-2', name: 'NewCorp' }],
        Project: [{ id: 'proj-2', name: 'Beta', organizationId: 'org-2' }],
      });

      await engine.apply(desired);

      const orgs = await db.query('SELECT * FROM "Organization"');
      const projects = await db.query('SELECT * FROM "Project"');

      expect({ orgs: orgs.rows, projects: projects.rows }).toMatchInlineSnapshot(`
        {
          "orgs": [
            {
              "id": "org-2",
              "name": "NewCorp",
            },
          ],
          "projects": [
            {
              "id": "proj-2",
              "name": "Beta",
              "organizationId": "org-2",
            },
          ],
        }
      `);
    });

    test('rollback on error', async () => {
      await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        INSERT INTO "User" VALUES ('user-1', 'Alice');
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      // This will try to insert a row with NULL name (violates NOT NULL)
      const desired = createFlatDataset({
        User: [
          { id: 'user-1', name: 'Alice' },
          { id: 'user-2', name: null }, // Will fail
        ],
      });

      await expect(engine.apply(desired)).rejects.toThrow();

      // Original data should be unchanged
      const result = await db.query('SELECT * FROM "User"');
      expect(result.rows).toMatchInlineSnapshot(`
        [
          {
            "id": "user-1",
            "name": "Alice",
          },
        ]
      `);
    });
  });

  describe('fetchCurrentData', () => {
    test('fetches all table data', async () => {
      await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE "Project" (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO "User" VALUES ('u1', 'Alice'), ('u2', 'Bob');
        INSERT INTO "Project" VALUES ('p1', 'Alpha');
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      const { dataset } = await engine.fetchCurrentData();

      expect({
        User: dataset.tables.get('User'),
        Project: dataset.tables.get('Project'),
      }).toMatchInlineSnapshot(`
        {
          "Project": [
            {
              "id": "p1",
              "name": "Alpha",
            },
          ],
          "User": [
            {
              "id": "u1",
              "name": "Alice",
            },
            {
              "id": "u2",
              "name": "Bob",
            },
          ],
        }
      `);
    });

    test('respects limit option', async () => {
      await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO "User" VALUES ('u1', 'Alice'), ('u2', 'Bob'), ('u3', 'Charlie');
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      const { dataset, truncated } = await engine.fetchCurrentData({ limit: 2 });

      expect(dataset.tables.get('User')).toMatchInlineSnapshot(`
        [
          {
            "id": "u1",
            "name": "Alice",
          },
          {
            "id": "u2",
            "name": "Bob",
          },
        ]
      `);
      expect(truncated.get('User')).toBe(1);
    });

    test('orders by primary key when fetching', async () => {
      await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO "User" VALUES ('c', 'Charlie'), ('a', 'Alice'), ('b', 'Bob');
      `);

      const schema = await extractSchema(db);
      const engine = new SyncEngine(db, schema);

      const { dataset } = await engine.fetchCurrentData();

      expect(dataset.tables.get('User')?.map(r => r.id)).toMatchInlineSnapshot(`
        [
          "a",
          "b",
          "c",
        ]
      `);
    });
  });
});
