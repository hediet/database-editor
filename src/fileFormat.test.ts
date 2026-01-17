import { describe, test, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { extractSchema } from "./schemaExtractor";
import { SyncEngine } from "./syncEngine";
import {
    serializeFlatDataset,
    parseFlatDataset
} from "./fileFormat";

describe("fileFormat", () => {
	let db: PGlite;

	beforeEach(async () => {
		db = new PGlite();
	});

	describe("serializeFlatDataset", () => {
		test("serializes flat dataset to JSON string", async () => {
			await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO "User" VALUES ('u1', 'Alice'), ('u2', 'Bob');
      `);

			const schema = await extractSchema(db);
			const engine = new SyncEngine(db, schema);
			const data = await engine.fetchCurrentData();

			const json = serializeFlatDataset(data);
			const parsed = JSON.parse(json);

			expect(parsed).toMatchInlineSnapshot(`
        {
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

		test("includes metadata when provided", async () => {
			await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY)`);

			const schema = await extractSchema(db);
			const engine = new SyncEngine(db, schema);
			const data = await engine.fetchCurrentData();

			const json = serializeFlatDataset(data, {
				$schema: "./.db-editor/data.schema.json",
				$base: "./.db-editor/data.base.json",
			});
			const parsed = JSON.parse(json);

			expect(parsed.$schema).toBe("./.db-editor/data.schema.json");
			expect(parsed.$base).toBe("./.db-editor/data.base.json");
		});
	});

	describe("parseFlatDataset", () => {
		test("parses JSON string to flat dataset", () => {
			const json = JSON.stringify({
				User: [
					{ id: "u1", name: "Alice" },
					{ id: "u2", name: "Bob" },
				],
				Project: [{ id: "p1", name: "Alpha" }],
			});

			const { dataset, metadata } = parseFlatDataset(json);

			expect(dataset.tables.get("User")).toMatchInlineSnapshot(`
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
			expect(dataset.tables.get("Project")).toMatchInlineSnapshot(`
        [
          {
            "id": "p1",
            "name": "Alpha",
          },
        ]
      `);
		});

		test("extracts metadata from JSON", () => {
			const json = JSON.stringify({
				$schema: "./schema.json",
				$base: "./base.json",
				User: [],
			});

			const { metadata } = parseFlatDataset(json);

			expect(metadata).toMatchInlineSnapshot(`
        {
          "$base": "./base.json",
          "$schema": "./schema.json",
        }
      `);
		});

		test("handles empty tables", () => {
			const json = JSON.stringify({ User: [] });
			const { dataset } = parseFlatDataset(json);

			expect(dataset.tables.get("User")).toEqual([]);
		});
	});

	describe("roundtrip", () => {
		test("serialize then parse preserves data", async () => {
			await db.exec(`
        CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT, age INTEGER);
        INSERT INTO "User" VALUES ('u1', 'Alice', 30), ('u2', 'Bob', null);
      `);

			const schema = await extractSchema(db);
			const engine = new SyncEngine(db, schema);
			const original = await engine.fetchCurrentData();

			const json = serializeFlatDataset(original);
			const { dataset: parsed } = parseFlatDataset(json);

			expect(parsed.tables.get("User")).toEqual(original.tables.get("User"));
		});
	});
});
