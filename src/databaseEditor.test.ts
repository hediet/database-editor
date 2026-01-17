import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { DatabaseEditor } from "./databaseEditor";

describe("DatabaseEditor", () => {
	let db: PGlite;
	let editor: DatabaseEditor;
	let tempDir: string;

	beforeEach(async () => {
		db = new PGlite();
		editor = await DatabaseEditor.fromClient(db);

		// Create temp directory for file tests
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-editor-test-"));
	});

	afterEach(() => {
		// Clean up temp directory
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	describe("dump", () => {
		test("dumps database to flat JSON file", async () => {
			await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO "User" VALUES ('u1', 'Alice');
      `);
			editor = await DatabaseEditor.fromClient(db);

			const outputPath = path.join(tempDir, "data.json");
			await editor.dump({ output: outputPath, flat: true });

			const content = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
			expect(content.User).toMatchInlineSnapshot(`
        [
          {
            "id": "u1",
            "name": "Alice",
          },
        ]
      `);
		});

		test("dumps database to nested JSON file by default", async () => {
			await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE "Post" (
          id TEXT PRIMARY KEY, 
          title TEXT, 
          user_id TEXT REFERENCES "User"(id) ON DELETE CASCADE
        );
        INSERT INTO "User" VALUES ('u1', 'Alice');
        INSERT INTO "Post" VALUES ('p1', 'Hello', 'u1');
      `);
			editor = await DatabaseEditor.fromClient(db);

			const outputPath = path.join(tempDir, "data.json");
			await editor.dump({ output: outputPath });

			const content = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
			// Nested format: posts appear under user, without user_id column
			expect(content.user).toMatchInlineSnapshot(`
        [
          {
            "id": "u1",
            "name": "Alice",
            "post": [
              {
                "id": "p1",
                "title": "Hello",
              },
            ],
          },
        ]
      `);
		});

		test("creates base file in .db-editor directory", async () => {
			await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY)`);
			editor = await DatabaseEditor.fromClient(db);

			const outputPath = path.join(tempDir, "data.json");
			await editor.dump({ output: outputPath });

			const baseDir = path.join(tempDir, ".db-editor");
			expect(fs.existsSync(baseDir)).toBe(true);
			expect(fs.existsSync(path.join(baseDir, "data.base.json"))).toBe(true);
		});

		test("creates JSON schema file for autocomplete", async () => {
			await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT)`);
			editor = await DatabaseEditor.fromClient(db);

			const outputPath = path.join(tempDir, "data.json");
			await editor.dump({ output: outputPath });

			const schemaPath = path.join(tempDir, ".db-editor", "data.schema.json");
			expect(fs.existsSync(schemaPath)).toBe(true);

			const schemaContent = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
			expect(schemaContent.$schema).toBe("http://json-schema.org/draft-07/schema#");
			expect(schemaContent.definitions?.UserRow).toBeDefined();
		});

		test("main file references base and schema", async () => {
			await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY)`);
			editor = await DatabaseEditor.fromClient(db);

			const outputPath = path.join(tempDir, "data.json");
			await editor.dump({ output: outputPath });

			const content = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
			expect(content.$base).toBe("./.db-editor/data.base.json");
			expect(content.$schema).toBe("./.db-editor/data.schema.json");
		});

		test("can skip base file creation", async () => {
			await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY)`);
			editor = await DatabaseEditor.fromClient(db);

			const outputPath = path.join(tempDir, "data.json");
			await editor.dump({ output: outputPath, createBase: false });

			const baseDir = path.join(tempDir, ".db-editor");
			expect(fs.existsSync(baseDir)).toBe(false);

			const content = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
			expect(content.$base).toBeUndefined();
		});
	});

	describe("preview", () => {
		test("shows changes without applying", async () => {
			await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO "User" VALUES ('u1', 'Alice');
      `);
			editor = await DatabaseEditor.fromClient(db);

			// Write a file with changes
			const inputPath = path.join(tempDir, "input.json");
			fs.writeFileSync(
				inputPath,
				JSON.stringify({
					User: [
						{ id: "u1", name: "Alice Updated" },
						{ id: "u2", name: "Bob" },
					],
				})
			);

			const changes = await editor.preview(inputPath);

			expect(changes.changes.map((c) => c.type)).toMatchInlineSnapshot(`
        [
          "update",
          "insert",
        ]
      `);

			// Verify DB unchanged
			const result = await db.query('SELECT * FROM "User"');
			expect(result.rows).toMatchInlineSnapshot(`
        [
          {
            "id": "u1",
            "name": "Alice",
          },
        ]
      `);
		});
	});

	describe("reset", () => {
		test("makes DB match file exactly", async () => {
			await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO "User" VALUES ('u1', 'Alice'), ('u2', 'Bob');
      `);
			editor = await DatabaseEditor.fromClient(db);

			// Reset to only have u1 with updated name
			const inputPath = path.join(tempDir, "input.json");
			fs.writeFileSync(
				inputPath,
				JSON.stringify({
					User: [{ id: "u1", name: "Alice Updated" }],
				})
			);

			await editor.reset(inputPath);

			const result = await db.query('SELECT * FROM "User" ORDER BY id');
			expect(result.rows).toMatchInlineSnapshot(`
        [
          {
            "id": "u1",
            "name": "Alice Updated",
          },
        ]
      `);
		});

		test("updates base file after successful reset", async () => {
			await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO "User" VALUES ('u1', 'Alice');
      `);
			editor = await DatabaseEditor.fromClient(db);

			// Create .db-editor dir and base file
			const dbEditorDir = path.join(tempDir, ".db-editor");
			fs.mkdirSync(dbEditorDir);
			const basePath = path.join(dbEditorDir, "data.base.json");
			fs.writeFileSync(basePath, JSON.stringify({ User: [{ id: "u1", name: "Alice" }] }));

			// Write input file with $base reference
			const inputPath = path.join(tempDir, "data.json");
			fs.writeFileSync(
				inputPath,
				JSON.stringify({
					$base: "./.db-editor/data.base.json",
					User: [{ id: "u1", name: "Updated" }],
				})
			);

			await editor.reset(inputPath);

			// Base file should now reflect new state
			const baseContent = JSON.parse(fs.readFileSync(basePath, "utf-8"));
			expect(baseContent.User[0].name).toBe("Updated");
		});
	});
});
