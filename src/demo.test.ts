/**
 * # Database Editor Demo
 *
 * This test serves as a CI-verified demo of the database-editor workflow.
 * It demonstrates:
 * 1. Setting up a PostgreSQL schema with PGLite
 * 2. Dumping data to nested JSON
 * 3. JSON Schema generation for editor autocomplete
 * 4. Editing data via object manipulation
 * 5. Previewing changes as SQL statements
 *
 * @see README.md for usage documentation
 */

import { describe, test, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { SyncEngine } from "./syncEngine";
import { extractSchema } from "./schemaExtractor";
import { buildOwnershipTree } from "./ownershipTree";
import { toNested, fromNested } from "./nested";
import { generateNestedJsonSchema } from "./jsonSchemaGenerator";
import { generateSql } from "./sqlGenerator";

describe("Demo: Complete Workflow", () => {
	let db: PGlite;

	beforeEach(async () => {
		db = new PGlite();

		// ========================================
		// 1. Create an interesting schema
		// ========================================
		// A todo-list app with users, lists, and items
		await db.exec(`
			-- Users table
			CREATE TABLE "User" (
				id TEXT PRIMARY KEY,
				email TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);

			-- Todo lists owned by users (CASCADE = composition)
			CREATE TABLE "TodoList" (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE
			);

			-- Todo items within lists (CASCADE = composition)
			CREATE TABLE "TodoItem" (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				completed BOOLEAN NOT NULL DEFAULT FALSE,
				due_date DATE,
				list_id TEXT NOT NULL REFERENCES "TodoList"(id) ON DELETE CASCADE
			);

			-- Tags that can be applied to items (reference, not composition)
			CREATE TABLE "Tag" (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				color TEXT
			);

			-- Many-to-many: items can have multiple tags
			CREATE TABLE "TodoItemTag" (
				item_id TEXT NOT NULL REFERENCES "TodoItem"(id) ON DELETE CASCADE,
				tag_id TEXT NOT NULL REFERENCES "Tag"(id) ON DELETE RESTRICT,
				PRIMARY KEY (item_id, tag_id)
			);
		`);

		// ========================================
		// 2. Insert sample data
		// ========================================
		await db.exec(`
			-- Users (explicitly set created_at for deterministic tests)
			INSERT INTO "User" (id, email, name, created_at) VALUES
				('u1', 'alice@example.com', 'Alice', '2026-01-15 10:00:00'),
				('u2', 'bob@example.com', 'Bob', '2026-01-15 10:00:00');

			-- Alice's lists
			INSERT INTO "TodoList" (id, title, user_id) VALUES
				('list-1', 'Work Tasks', 'u1'),
				('list-2', 'Personal', 'u1');

			-- Bob's list
			INSERT INTO "TodoList" (id, title, user_id) VALUES
				('list-3', 'Projects', 'u2');

			-- Items in Alice's Work Tasks
			INSERT INTO "TodoItem" (id, title, completed, due_date, list_id) VALUES
				('item-1', 'Review PR #123', FALSE, '2026-01-20', 'list-1'),
				('item-2', 'Update documentation', FALSE, NULL, 'list-1'),
				('item-3', 'Deploy to staging', TRUE, '2026-01-15', 'list-1');

			-- Items in Alice's Personal list
			INSERT INTO "TodoItem" (id, title, completed, list_id) VALUES
				('item-4', 'Buy groceries', FALSE, 'list-2');

			-- Items in Bob's Projects
			INSERT INTO "TodoItem" (id, title, completed, list_id) VALUES
				('item-5', 'Design new feature', FALSE, 'list-3');

			-- Tags
			INSERT INTO "Tag" (id, name, color) VALUES
				('tag-urgent', 'Urgent', '#ff0000'),
				('tag-backend', 'Backend', '#00ff00');

			-- Tag assignments
			INSERT INTO "TodoItemTag" (item_id, tag_id) VALUES
				('item-1', 'tag-urgent'),
				('item-1', 'tag-backend'),
				('item-5', 'tag-backend');
		`);
	});

	test("full workflow: dump → edit → preview SQL", async () => {
		// ========================================
		// 3. Extract schema and build ownership tree
		// ========================================
		const schema = await extractSchema(db);
		const tree = buildOwnershipTree(schema);

		// Show the ownership tree structure
		expect({
			roots: tree.roots,
			children: Object.fromEntries(
				tree.roots.map((r) => [r, tree.getChildren(r).map((e) => e.childTable)])
			),
		}).toMatchInlineSnapshot(`
			{
			  "children": {
			    "Tag": [],
			    "User": [
			      "TodoList",
			    ],
			  },
			  "roots": [
			    "Tag",
			    "User",
			  ],
			}
		`);

		// ========================================
		// 4. Generate JSON Schema (truncated preview)
		// ========================================
		const jsonSchema = generateNestedJsonSchema(schema, { ownershipTree: tree });

		// Show first 40 lines of the schema
		const schemaLines = JSON.stringify(jsonSchema, null, 2).split("\n");
		const schemaPreview = schemaLines.slice(0, 40).join("\n") + "\n// ... truncated";

		expect(schemaPreview).toMatchInlineSnapshot(`
			"{
			  "$schema": "http://json-schema.org/draft-07/schema#",
			  "type": "object",
			  "properties": {
			    "$schema": {
			      "type": "string"
			    },
			    "$connection": {
			      "type": "string"
			    },
			    "$base": {
			      "type": "string"
			    },
			    "tag": {
			      "type": "array",
			      "items": {
			        "$ref": "#/definitions/TagNestedRow"
			      }
			    },
			    "user": {
			      "type": "array",
			      "items": {
			        "$ref": "#/definitions/UserNestedRow"
			      }
			    }
			  },
			  "definitions": {
			    "TagNestedRow": {
			      "type": "object",
			      "properties": {
			        "id": {
			          "type": "string"
			        },
			        "name": {
			          "type": "string"
			        },
			        "color": {
			          "type": [
			            "string",
			            "null"
			// ... truncated"
		`);

		// ========================================
		// 5. Dump data as nested JSON
		// ========================================
		const engine = new SyncEngine(db, schema);
		const { dataset: flatData } = await engine.fetchCurrentData();
		const nested = toNested(flatData, schema, tree);

		expect(nested.data).toMatchInlineSnapshot(`
			{
			  "tag": [
			    {
			      "color": "#00ff00",
			      "id": "tag-backend",
			      "name": "Backend",
			    },
			    {
			      "color": "#ff0000",
			      "id": "tag-urgent",
			      "name": "Urgent",
			    },
			  ],
			  "user": [
			    {
			      "created_at": 2026-01-15T09:00:00.000Z,
			      "email": "alice@example.com",
			      "id": "u1",
			      "name": "Alice",
			      "todoList": [
			        {
			          "id": "list-1",
			          "title": "Work Tasks",
			          "todoItem": [
			            {
			              "completed": false,
			              "due_date": 2026-01-20T00:00:00.000Z,
			              "id": "item-1",
			              "title": "Review PR #123",
			              "todoItemTag": [
			                {
			                  "tag_id": "tag-backend",
			                },
			                {
			                  "tag_id": "tag-urgent",
			                },
			              ],
			            },
			            {
			              "completed": false,
			              "due_date": null,
			              "id": "item-2",
			              "title": "Update documentation",
			              "todoItemTag": [],
			            },
			            {
			              "completed": true,
			              "due_date": 2026-01-15T00:00:00.000Z,
			              "id": "item-3",
			              "title": "Deploy to staging",
			              "todoItemTag": [],
			            },
			          ],
			        },
			        {
			          "id": "list-2",
			          "title": "Personal",
			          "todoItem": [
			            {
			              "completed": false,
			              "due_date": null,
			              "id": "item-4",
			              "title": "Buy groceries",
			              "todoItemTag": [],
			            },
			          ],
			        },
			      ],
			    },
			    {
			      "created_at": 2026-01-15T09:00:00.000Z,
			      "email": "bob@example.com",
			      "id": "u2",
			      "name": "Bob",
			      "todoList": [
			        {
			          "id": "list-3",
			          "title": "Projects",
			          "todoItem": [
			            {
			              "completed": false,
			              "due_date": null,
			              "id": "item-5",
			              "title": "Design new feature",
			              "todoItemTag": [
			                {
			                  "tag_id": "tag-backend",
			                },
			              ],
			            },
			          ],
			        },
			      ],
			    },
			  ],
			}
		`);

		// ========================================
		// 6. Edit the data (simulate user editing JSON)
		// ========================================
		// Make a mutable copy for editing
		const editableData = JSON.parse(JSON.stringify(nested.data));

		// The structure is:
		// - user[0] = Alice
		//   - todoList[0] = "Work Tasks" (list-1) with items: item-1, item-2, item-3
		//   - todoList[1] = "Personal" (list-2) with items: item-4
		// - user[1] = Bob
		//   - todoList[0] = "Projects" (list-3) with items: item-5

		// Edit 1: Rename Alice's "Personal" list
		editableData.user[0].todoList[1].title = "Personal Goals";

		// Edit 2: Mark "Update documentation" (item-2) as completed
		editableData.user[0].todoList[0].todoItem[1].completed = true;

		// Edit 3: Add a new todo item to Bob's list
		editableData.user[1].todoList[0].todoItem.push({
			id: "item-6",
			title: "Write tests",
			completed: false,
			due_date: "2026-01-25",
		});

		// Edit 4: Delete the "Urgent" tag
		editableData.tag = editableData.tag.filter(
			(t: { id: string }) => t.id !== "tag-urgent"
		);

		// ========================================
		// 7. Convert back to flat and compute diff
		// ========================================
		const editedFlat = fromNested(editableData, schema, tree);
		const changeSet = await engine.preview(editedFlat);

		expect(
			changeSet.changes.map((c) => ({
				type: c.type,
				table: c.table,
				...(c.type === "update" ? { changes: c.newValues } : {}),
				...(c.type === "insert" ? { row: c.row } : {}),
				...(c.type === "delete" ? { pk: c.primaryKey } : {}),
			}))
		).toMatchInlineSnapshot(`
			[
			  {
			    "pk": {
			      "id": "tag-urgent",
			    },
			    "table": "Tag",
			    "type": "delete",
			  },
			  {
			    "changes": {
			      "completed": true,
			    },
			    "table": "TodoItem",
			    "type": "update",
			  },
			  {
			    "changes": {
			      "title": "Personal Goals",
			    },
			    "table": "TodoList",
			    "type": "update",
			  },
			  {
			    "row": {
			      "completed": false,
			      "due_date": "2026-01-25",
			      "id": "item-6",
			      "list_id": "list-3",
			      "title": "Write tests",
			    },
			    "table": "TodoItem",
			    "type": "insert",
			  },
			]
		`);

		// ========================================
		// 8. Generate SQL statements (dry run)
		// ========================================
		const sqlStatements = generateSql(changeSet);

		expect(
			sqlStatements.map((s) => ({
				sql: s.sql,
				params: s.params,
			}))
		).toMatchInlineSnapshot(`
			[
			  {
			    "params": [
			      "tag-urgent",
			    ],
			    "sql": "DELETE FROM "Tag" WHERE "id" = $1",
			  },
			  {
			    "params": [
			      true,
			      "item-2",
			    ],
			    "sql": "UPDATE "TodoItem" SET "completed" = $1 WHERE "id" = $2",
			  },
			  {
			    "params": [
			      "Personal Goals",
			      "list-2",
			    ],
			    "sql": "UPDATE "TodoList" SET "title" = $1 WHERE "id" = $2",
			  },
			  {
			    "params": [
			      "item-6",
			      "Write tests",
			      false,
			      "2026-01-25",
			      "list-3",
			    ],
			    "sql": "INSERT INTO "TodoItem" ("id", "title", "completed", "due_date", "list_id") VALUES ($1, $2, $3, $4, $5)",
			  },
			]
		`);
	});
});
