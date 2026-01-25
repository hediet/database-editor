import { describe, test, expect } from 'vitest';
import { diff } from './diff.ts';
import { createFlatDataset, createSchema } from './model.ts';

describe('diff', () => {
  const schema = createSchema([
    { name: 'User', columns: [], primaryKey: ['id'] },
    { name: 'Project', columns: [], primaryKey: ['id'] },
    { name: 'ProjectLanguage', columns: [], primaryKey: ['projectId', 'languageId'] },
  ], []);

  test('detects inserts', () => {
    const current = createFlatDataset({
      User: [],
    });
    const desired = createFlatDataset({
      User: [{ id: 'user-1', name: 'Alice' }],
    });

    const changes = diff(schema, current, desired);

    expect(changes.changes).toMatchInlineSnapshot(`
      [
        {
          "row": {
            "id": "user-1",
            "name": "Alice",
          },
          "table": "User",
          "type": "insert",
        },
      ]
    `);
  });

  test('detects deletes', () => {
    const current = createFlatDataset({
      User: [{ id: 'user-1', name: 'Alice' }],
    });
    const desired = createFlatDataset({
      User: [],
    });

    const changes = diff(schema, current, desired);

    expect(changes.changes).toMatchInlineSnapshot(`
      [
        {
          "oldRow": {
            "id": "user-1",
            "name": "Alice",
          },
          "primaryKey": {
            "id": "user-1",
          },
          "table": "User",
          "type": "delete",
        },
      ]
    `);
  });

  test('detects updates', () => {
    const current = createFlatDataset({
      User: [{ id: 'user-1', name: 'Alice', email: 'alice@old.com' }],
    });
    const desired = createFlatDataset({
      User: [{ id: 'user-1', name: 'Alice', email: 'alice@new.com' }],
    });

    const changes = diff(schema, current, desired);

    expect(changes.changes).toMatchInlineSnapshot(`
      [
        {
          "newValues": {
            "email": "alice@new.com",
          },
          "oldValues": {
            "email": "alice@old.com",
          },
          "primaryKey": {
            "id": "user-1",
          },
          "table": "User",
          "type": "update",
        },
      ]
    `);
  });

  test('no changes when identical', () => {
    const data = createFlatDataset({
      User: [{ id: 'user-1', name: 'Alice' }],
    });

    const changes = diff(schema, data, data);

    expect(changes.changes).toEqual([]);
  });

  test('handles composite primary keys', () => {
    const current = createFlatDataset({
      ProjectLanguage: [
        { projectId: 'p1', languageId: 'en', enabled: true },
      ],
    });
    const desired = createFlatDataset({
      ProjectLanguage: [
        { projectId: 'p1', languageId: 'en', enabled: false },
      ],
    });

    const changes = diff(schema, current, desired);

    expect(changes.changes).toMatchInlineSnapshot(`
      [
        {
          "newValues": {
            "enabled": false,
          },
          "oldValues": {
            "enabled": true,
          },
          "primaryKey": {
            "languageId": "en",
            "projectId": "p1",
          },
          "table": "ProjectLanguage",
          "type": "update",
        },
      ]
    `);
  });

  test('handles multiple changes across tables', () => {
    const current = createFlatDataset({
      User: [
        { id: 'user-1', name: 'Alice' },
        { id: 'user-2', name: 'Bob' },
      ],
      Project: [
        { id: 'proj-1', name: 'Alpha' },
      ],
    });
    const desired = createFlatDataset({
      User: [
        { id: 'user-1', name: 'Alice Updated' },
        { id: 'user-3', name: 'Charlie' },
      ],
      Project: [],
    });

    const changes = diff(schema, current, desired);

    expect(changes.changes).toMatchInlineSnapshot(`
      [
        {
          "newValues": {
            "name": "Alice Updated",
          },
          "oldValues": {
            "name": "Alice",
          },
          "primaryKey": {
            "id": "user-1",
          },
          "table": "User",
          "type": "update",
        },
        {
          "oldRow": {
            "id": "user-2",
            "name": "Bob",
          },
          "primaryKey": {
            "id": "user-2",
          },
          "table": "User",
          "type": "delete",
        },
        {
          "row": {
            "id": "user-3",
            "name": "Charlie",
          },
          "table": "User",
          "type": "insert",
        },
        {
          "oldRow": {
            "id": "proj-1",
            "name": "Alpha",
          },
          "primaryKey": {
            "id": "proj-1",
          },
          "table": "Project",
          "type": "delete",
        },
      ]
    `);
  });

  test('handles null values correctly', () => {
    const current = createFlatDataset({
      User: [{ id: 'user-1', name: null }],
    });
    const desired = createFlatDataset({
      User: [{ id: 'user-1', name: 'Alice' }],
    });

    const changes = diff(schema, current, desired);

    expect(changes.changes).toMatchInlineSnapshot(`
      [
        {
          "newValues": {
            "name": "Alice",
          },
          "oldValues": {
            "name": null,
          },
          "primaryKey": {
            "id": "user-1",
          },
          "table": "User",
          "type": "update",
        },
      ]
    `);
  });

  test('treats missing table in desired as delete all', () => {
    const current = createFlatDataset({
      User: [{ id: 'user-1', name: 'Alice' }],
    });
    const desired = createFlatDataset({});

    const changes = diff(schema, current, desired);

    expect(changes.changes).toMatchInlineSnapshot(`
      [
        {
          "oldRow": {
            "id": "user-1",
            "name": "Alice",
          },
          "primaryKey": {
            "id": "user-1",
          },
          "table": "User",
          "type": "delete",
        },
      ]
    `);
  });
});
