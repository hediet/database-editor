import { describe, test, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { extractSchema } from './schemaExtractor.ts';

describe('extractSchema', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
  });

  test('extracts simple table with columns', async () => {
    await db.exec(`
      CREATE TABLE "User" (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT
      )
    `);

    const schema = await extractSchema(db);
    const user = schema.tables.get('User');

    expect(user).toBeDefined();
    expect({
      name: user!.name,
      primaryKey: user!.primaryKey,
      columns: user!.columns.map(c => ({ name: c.name, type: c.type, isNullable: c.isNullable })),
    }).toMatchInlineSnapshot(`
      {
        "columns": [
          {
            "isNullable": false,
            "name": "id",
            "type": "text",
          },
          {
            "isNullable": false,
            "name": "email",
            "type": "text",
          },
          {
            "isNullable": true,
            "name": "name",
            "type": "text",
          },
        ],
        "name": "User",
        "primaryKey": [
          "id",
        ],
      }
    `);
  });

  test('extracts foreign key relationships', async () => {
    await db.exec(`
      CREATE TABLE "Organization" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE "Project" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE
      );
    `);

    const schema = await extractSchema(db);

    expect(schema.relationships).toMatchInlineSnapshot(`
      [
        {
          "fromColumns": [
            "organizationId",
          ],
          "fromTable": "Project",
          "id": "Project_organizationId_fkey",
          "onDelete": "CASCADE",
          "onUpdate": "NO ACTION",
          "toColumns": [
            "id",
          ],
          "toTable": "Organization",
        },
      ]
    `);
  });

  test('extracts composite primary key', async () => {
    await db.exec(`
      CREATE TABLE "ProjectLanguage" (
        "projectId" TEXT NOT NULL,
        "languageId" TEXT NOT NULL,
        PRIMARY KEY ("projectId", "languageId")
      )
    `);

    const schema = await extractSchema(db);
    const table = schema.tables.get('ProjectLanguage');

    expect(table!.primaryKey).toMatchInlineSnapshot(`
      [
        "projectId",
        "languageId",
      ]
    `);
  });

  test('extracts composite foreign key', async () => {
    await db.exec(`
      CREATE TABLE "Project" (id TEXT PRIMARY KEY);
      CREATE TABLE "Language" (id TEXT PRIMARY KEY);
      CREATE TABLE "ProjectLanguage" (
        "projectId" TEXT NOT NULL REFERENCES "Project"(id),
        "languageId" TEXT NOT NULL REFERENCES "Language"(id),
        PRIMARY KEY ("projectId", "languageId")
      );
      CREATE TABLE "LocalizedContent" (
        id TEXT PRIMARY KEY,
        "projectId" TEXT NOT NULL,
        "languageId" TEXT NOT NULL,
        content TEXT,
        FOREIGN KEY ("projectId", "languageId") 
          REFERENCES "ProjectLanguage"("projectId", "languageId") ON DELETE CASCADE
      );
    `);

    const schema = await extractSchema(db);
    const compositeFK = schema.relationships.find(
      r => r.fromTable === 'LocalizedContent' && r.toTable === 'ProjectLanguage'
    );

    expect(compositeFK).toMatchInlineSnapshot(`
      {
        "fromColumns": [
          "projectId",
          "languageId",
        ],
        "fromTable": "LocalizedContent",
        "id": "LocalizedContent_projectId_languageId_fkey",
        "onDelete": "CASCADE",
        "onUpdate": "NO ACTION",
        "toColumns": [
          "projectId",
          "languageId",
        ],
        "toTable": "ProjectLanguage",
      }
    `);
  });

  test('detects columns with defaults', async () => {
    await db.exec(`
      CREATE TABLE "Item" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        name TEXT NOT NULL
      )
    `);

    const schema = await extractSchema(db);
    const table = schema.tables.get('Item');

    expect(table!.columns.map(c => ({ name: c.name, hasDefault: c.hasDefault }))).toMatchInlineSnapshot(`
      [
        {
          "hasDefault": true,
          "name": "id",
        },
        {
          "hasDefault": true,
          "name": "createdAt",
        },
        {
          "hasDefault": false,
          "name": "name",
        },
      ]
    `);
  });

  test('ignores system tables', async () => {
    await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY)`);

    const schema = await extractSchema(db);

    // Should not include pg_* tables or information_schema
    const tableNames = [...schema.tables.keys()];
    expect(tableNames).toEqual(['User']);
  });

  test('extracts multiple foreign keys on same table', async () => {
    await db.exec(`
      CREATE TABLE "User" (id TEXT PRIMARY KEY);
      CREATE TABLE "Organization" (id TEXT PRIMARY KEY);
      CREATE TABLE "Membership" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE
      );
    `);

    const schema = await extractSchema(db);
    const membershipFKs = schema.relationships.filter(r => r.fromTable === 'Membership');

    expect(membershipFKs.length).toBe(2);
    expect(membershipFKs.map(fk => ({
      fromColumns: fk.fromColumns,
      toTable: fk.toTable,
      toColumns: fk.toColumns,
    }))).toMatchInlineSnapshot(`
      [
        {
          "fromColumns": [
            "organizationId",
          ],
          "toColumns": [
            "id",
          ],
          "toTable": "Organization",
        },
        {
          "fromColumns": [
            "userId",
          ],
          "toColumns": [
            "id",
          ],
          "toTable": "User",
        },
      ]
    `);
  });

  test('FK columns are proper arrays not strings', async () => {
    await db.exec(`
      CREATE TABLE "Parent" (id TEXT PRIMARY KEY);
      CREATE TABLE "Child" (
        id TEXT PRIMARY KEY,
        "parentId" TEXT REFERENCES "Parent"(id)
      );
    `);

    const schema = await extractSchema(db);
    const rel = schema.relationships[0];

    // Verify columns are actual arrays, not strings that look like arrays
    expect(Array.isArray(rel.fromColumns)).toBe(true);
    expect(Array.isArray(rel.toColumns)).toBe(true);
    expect(rel.fromColumns).toEqual(['parentId']);
    expect(rel.toColumns).toEqual(['id']);
  });

  test('extracts different ON DELETE actions', async () => {
    await db.exec(`
      CREATE TABLE "User" (id TEXT PRIMARY KEY);
      CREATE TABLE "Session" (
        id TEXT PRIMARY KEY,
        "userId" TEXT REFERENCES "User"(id) ON DELETE CASCADE
      );
      CREATE TABLE "AuditLog" (
        id TEXT PRIMARY KEY,
        "userId" TEXT REFERENCES "User"(id) ON DELETE SET NULL
      );
      CREATE TABLE "Profile" (
        id TEXT PRIMARY KEY,
        "userId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT
      );
    `);

    const schema = await extractSchema(db);

    expect(schema.relationships.map(r => ({
      fromTable: r.fromTable,
      onDelete: r.onDelete,
    }))).toMatchInlineSnapshot(`
      [
        {
          "fromTable": "AuditLog",
          "onDelete": "SET NULL",
        },
        {
          "fromTable": "Profile",
          "onDelete": "RESTRICT",
        },
        {
          "fromTable": "Session",
          "onDelete": "CASCADE",
        },
      ]
    `);
  });
});
