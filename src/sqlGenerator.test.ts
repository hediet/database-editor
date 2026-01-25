import { describe, test, expect } from 'vitest';
import { generateSql, orderChangesByDependency } from './sqlGenerator.ts';
import { createSchema, ChangeSet } from './model.ts';

describe('generateSql', () => {
  test('generates INSERT statement', () => {
    const changes: ChangeSet = {
      changes: [{
        type: 'insert',
        table: 'User',
        row: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
      }],
    };

    const statements = generateSql(changes);

    expect(statements).toMatchInlineSnapshot(`
      [
        {
          "params": [
            "user-1",
            "Alice",
            "alice@example.com",
          ],
          "sql": "INSERT INTO "User" ("id", "name", "email") VALUES ($1, $2, $3);",
        },
      ]
    `);
  });

  test('generates UPDATE statement', () => {
    const changes: ChangeSet = {
      changes: [{
        type: 'update',
        table: 'User',
        primaryKey: { id: 'user-1' },
        oldValues: { name: 'Alice', email: 'old@example.com' },
        newValues: { name: 'Alice Updated', email: 'new@example.com' },
      }],
    };

    const statements = generateSql(changes);

    expect(statements).toMatchInlineSnapshot(`
      [
        {
          "params": [
            "Alice Updated",
            "new@example.com",
            "user-1",
          ],
          "sql": "UPDATE "User" SET "name" = $1, "email" = $2 WHERE "id" = $3;",
        },
      ]
    `);
  });

  test('generates DELETE statement', () => {
    const changes: ChangeSet = {
      changes: [{
        type: 'delete',
        table: 'User',
        primaryKey: { id: 'user-1' },
        oldRow: { id: 'user-1', name: 'Alice' },
      }],
    };

    const statements = generateSql(changes);

    expect(statements).toMatchInlineSnapshot(`
      [
        {
          "params": [
            "user-1",
          ],
          "sql": "DELETE FROM "User" WHERE "id" = $1;",
        },
      ]
    `);
  });

  test('handles composite primary key in UPDATE', () => {
    const changes: ChangeSet = {
      changes: [{
        type: 'update',
        table: 'ProjectLanguage',
        primaryKey: { projectId: 'p1', languageId: 'en' },
        oldValues: { enabled: true },
        newValues: { enabled: false },
      }],
    };

    const statements = generateSql(changes);

    expect(statements).toMatchInlineSnapshot(`
      [
        {
          "params": [
            false,
            "p1",
            "en",
          ],
          "sql": "UPDATE "ProjectLanguage" SET "enabled" = $1 WHERE "projectId" = $2 AND "languageId" = $3;",
        },
      ]
    `);
  });

  test('handles composite primary key in DELETE', () => {
    const changes: ChangeSet = {
      changes: [{
        type: 'delete',
        table: 'ProjectLanguage',
        primaryKey: { projectId: 'p1', languageId: 'en' },
        oldRow: { projectId: 'p1', languageId: 'en', enabled: true },
      }],
    };

    const statements = generateSql(changes);

    expect(statements).toMatchInlineSnapshot(`
      [
        {
          "params": [
            "p1",
            "en",
          ],
          "sql": "DELETE FROM "ProjectLanguage" WHERE "projectId" = $1 AND "languageId" = $2;",
        },
      ]
    `);
  });

  test('handles null values', () => {
    const changes: ChangeSet = {
      changes: [{
        type: 'insert',
        table: 'User',
        row: { id: 'user-1', name: null },
      }],
    };

    const statements = generateSql(changes);

    expect(statements).toMatchInlineSnapshot(`
      [
        {
          "params": [
            "user-1",
            null,
          ],
          "sql": "INSERT INTO "User" ("id", "name") VALUES ($1, $2);",
        },
      ]
    `);
  });
});

describe('orderChangesByDependency', () => {
  const schema = createSchema([
    { name: 'Organization', columns: [], primaryKey: ['id'] },
    { name: 'Project', columns: [], primaryKey: ['id'] },
    { name: 'Task', columns: [], primaryKey: ['id'] },
  ], [
    {
      id: 'Project_organizationId_fkey',
      fromTable: 'Project',
      fromColumns: ['organizationId'],
      toTable: 'Organization',
      toColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    },
    {
      id: 'Task_projectId_fkey',
      fromTable: 'Task',
      fromColumns: ['projectId'],
      toTable: 'Project',
      toColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    },
  ]);

  test('orders deletes: children before parents', () => {
    const changes: ChangeSet = {
      changes: [
        { type: 'delete', table: 'Organization', primaryKey: { id: 'org-1' }, oldRow: { id: 'org-1' } },
        { type: 'delete', table: 'Task', primaryKey: { id: 'task-1' }, oldRow: { id: 'task-1' } },
        { type: 'delete', table: 'Project', primaryKey: { id: 'proj-1' }, oldRow: { id: 'proj-1' } },
      ],
    };

    const ordered = orderChangesByDependency(schema, changes);
    const tables = ordered.changes.map(c => c.table);

    expect(tables).toMatchInlineSnapshot(`
      [
        "Task",
        "Project",
        "Organization",
      ]
    `);
  });

  test('orders inserts: parents before children', () => {
    const changes: ChangeSet = {
      changes: [
        { type: 'insert', table: 'Task', row: { id: 'task-1' } },
        { type: 'insert', table: 'Organization', row: { id: 'org-1' } },
        { type: 'insert', table: 'Project', row: { id: 'proj-1' } },
      ],
    };

    const ordered = orderChangesByDependency(schema, changes);
    const tables = ordered.changes.map(c => c.table);

    expect(tables).toMatchInlineSnapshot(`
      [
        "Organization",
        "Project",
        "Task",
      ]
    `);
  });

  test('groups by operation type: deletes, then updates, then inserts', () => {
    const changes: ChangeSet = {
      changes: [
        { type: 'insert', table: 'Organization', row: { id: 'org-new' } },
        { type: 'delete', table: 'Organization', primaryKey: { id: 'org-old' }, oldRow: { id: 'org-old' } },
        { type: 'update', table: 'Organization', primaryKey: { id: 'org-1' }, oldValues: {}, newValues: {} },
      ],
    };

    const ordered = orderChangesByDependency(schema, changes);
    const types = ordered.changes.map(c => c.type);

    expect(types).toMatchInlineSnapshot(`
      [
        "delete",
        "update",
        "insert",
      ]
    `);
  });
});
