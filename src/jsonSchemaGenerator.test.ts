import { describe, test, expect } from "vitest";
import { generateJsonSchema, generateNestedJsonSchema } from "./jsonSchemaGenerator";
import { createSchema, type Table, type Relationship } from "./model";
import { buildOwnershipTree } from "./ownershipTree";
import Ajv from "ajv";
import addFormats from "ajv-formats";

describe("jsonSchemaGenerator", () => {
	test("generates schema for simple table", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "name", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = generateJsonSchema(createSchema(tables, []));

		expect(schema).toMatchInlineSnapshot(`
      {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "definitions": {
          "UserRow": {
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string",
              },
              "name": {
                "type": "string",
              },
            },
            "required": [
              "id",
              "name",
            ],
            "type": "object",
          },
        },
        "properties": {
          "$base": {
            "type": "string",
          },
          "$schema": {
            "type": "string",
          },
          "User": {
            "items": {
              "$ref": "#/definitions/UserRow",
            },
            "type": "array",
          },
        },
        "type": "object",
      }
    `);
	});

	test("handles nullable columns", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "bio", type: "text", isNullable: true, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = generateJsonSchema(createSchema(tables, []));
		const rowDef = schema.definitions!["UserRow"] as { properties: Record<string, { type: unknown }> };

		expect(rowDef.properties.bio.type).toMatchInlineSnapshot(`
      [
        "string",
        "null",
      ]
    `);
	});

	test("handles columns with defaults as optional", () => {
		const tables: Table[] = [
			{
				name: "Post",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "created_at", type: "timestamp", isNullable: false, hasDefault: true, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = generateJsonSchema(createSchema(tables, []));
		const rowDef = schema.definitions!["PostRow"] as { required?: string[] };

		// created_at should not be required (has default)
		expect(rowDef.required).toMatchInlineSnapshot(`
      [
        "id",
      ]
    `);
	});

	test("maps numeric types correctly", () => {
		const tables: Table[] = [
			{
				name: "Numbers",
				columns: [
					{ name: "id", type: "serial", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "count", type: "integer", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "amount", type: "numeric", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "big", type: "bigint", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = generateJsonSchema(createSchema(tables, []));
		const rowDef = schema.definitions!["NumbersRow"] as { properties: Record<string, { type: string }> };

		expect({
			id: rowDef.properties.id.type,
			count: rowDef.properties.count.type,
			amount: rowDef.properties.amount.type,
			big: rowDef.properties.big.type,
		}).toMatchInlineSnapshot(`
      {
        "amount": "number",
        "big": "string",
        "count": "integer",
        "id": "integer",
      }
    `);
	});

	test("maps date/time types with format", () => {
		const tables: Table[] = [
			{
				name: "Events",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "date", type: "date", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "timestamp", type: "timestamp with time zone", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = generateJsonSchema(createSchema(tables, []));
		const rowDef = schema.definitions!["EventsRow"] as { properties: Record<string, { format?: string }> };

		expect({
			date: rowDef.properties.date.format,
			timestamp: rowDef.properties.timestamp.format,
		}).toMatchInlineSnapshot(`
      {
        "date": "date",
        "timestamp": "date-time",
      }
    `);
	});

	test("maps uuid with format and pattern", () => {
		const tables: Table[] = [
			{
				name: "Entity",
				columns: [
					{ name: "id", type: "uuid", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = generateJsonSchema(createSchema(tables, []));
		const rowDef = schema.definitions!["EntityRow"] as { properties: Record<string, { format?: string; pattern?: string }> };

		expect(rowDef.properties.id).toMatchInlineSnapshot(`
      {
        "format": "uuid",
        "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        "type": "string",
      }
    `);
	});

	test("handles boolean type", () => {
		const tables: Table[] = [
			{
				name: "Settings",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "enabled", type: "boolean", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = generateJsonSchema(createSchema(tables, []));
		const rowDef = schema.definitions!["SettingsRow"] as { properties: Record<string, { type: string }> };

		expect(rowDef.properties.enabled.type).toBe("boolean");
	});

	test("handles json/jsonb as any", () => {
		const tables: Table[] = [
			{
				name: "Data",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "meta", type: "jsonb", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = generateJsonSchema(createSchema(tables, []));
		const rowDef = schema.definitions!["DataRow"] as { properties: Record<string, object> };

		// Empty object allows any JSON value
		expect(rowDef.properties.meta).toEqual({});
	});
});

describe("generateNestedJsonSchema", () => {
	function createAjv() {
		const ajv = new Ajv({ strict: false, allErrors: true });
		addFormats(ajv);
		return ajv;
	}

	test("generates nested schema with root tables only at top level", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "name", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
			{
				name: "Post",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "title", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "user_id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];
		const relationships: Relationship[] = [
			{
				id: "fk_post_user",
				fromTable: "Post",
				fromColumns: ["user_id"],
				toTable: "User",
				toColumns: ["id"],
				onDelete: "CASCADE",
				onUpdate: "NO ACTION",
			},
		];

		const dbSchema = createSchema(tables, relationships);
		const tree = buildOwnershipTree(dbSchema);
		const jsonSchema = generateNestedJsonSchema(dbSchema, { ownershipTree: tree });

		// Only root tables (User) should be at top level - Post is nested
		expect(Object.keys(jsonSchema.properties)).toMatchInlineSnapshot(`
			[
			  "$schema",
			  "$connection",
			  "$base",
			  "user",
			]
		`);

		// User row should have nested post array
		const userRowDef = jsonSchema.definitions!["UserNestedRow"] as { properties: Record<string, unknown> };
		expect(Object.keys(userRowDef.properties)).toMatchInlineSnapshot(`
			[
			  "id",
			  "name",
			  "post",
			]
		`);
	});

	test("nested row excludes FK columns to parent", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
			{
				name: "Session",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "token", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "user_id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];
		const relationships: Relationship[] = [
			{
				id: "fk_session_user",
				fromTable: "Session",
				fromColumns: ["user_id"],
				toTable: "User",
				toColumns: ["id"],
				onDelete: "CASCADE",
				onUpdate: "NO ACTION",
			},
		];

		const dbSchema = createSchema(tables, relationships);
		const tree = buildOwnershipTree(dbSchema);
		const jsonSchema = generateNestedJsonSchema(dbSchema, { ownershipTree: tree });

		// Session nested row should NOT have user_id (implicit from nesting)
		const sessionRowDef = jsonSchema.definitions!["SessionNestedRow"] as { properties: Record<string, unknown> };
		expect(Object.keys(sessionRowDef.properties)).toMatchInlineSnapshot(`
			[
			  "id",
			  "token",
			]
		`);
	});

	test("validates nested dump data against generated schema", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "email", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
			{
				name: "Credential",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "key", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "user_id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];
		const relationships: Relationship[] = [
			{
				id: "fk_credential_user",
				fromTable: "Credential",
				fromColumns: ["user_id"],
				toTable: "User",
				toColumns: ["id"],
				onDelete: "CASCADE",
				onUpdate: "NO ACTION",
			},
		];

		const dbSchema = createSchema(tables, relationships);
		const tree = buildOwnershipTree(dbSchema);
		const jsonSchema = generateNestedJsonSchema(dbSchema, { ownershipTree: tree });

		const ajv = createAjv();
		const validate = ajv.compile(jsonSchema);

		// Valid nested data
		const validData = {
			$schema: "./schema.json",
			$connection: "postgresql://localhost/test",
			$base: "./base.json",
			user: [
				{
					id: "u1",
					email: "alice@example.com",
					credential: [
						{ id: "c1", key: "abc123" },
						{ id: "c2", key: "def456" },
					],
				},
			],
		};

		expect(validate(validData)).toBe(true);
	});

	test("rejects invalid nested data", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "email", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const dbSchema = createSchema(tables, []);
		const tree = buildOwnershipTree(dbSchema);
		const jsonSchema = generateNestedJsonSchema(dbSchema, { ownershipTree: tree });

		const ajv = createAjv();
		const validate = ajv.compile(jsonSchema);

		// Invalid: missing required field 'email'
		const invalidData = {
			user: [{ id: "u1" }], // missing email
		};

		expect(validate(invalidData)).toBe(false);
		expect(validate.errors?.some((e) => e.message?.includes("required"))).toBe(true);
	});

	test("validates data with nullable fields", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "bio", type: "text", isNullable: true, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const dbSchema = createSchema(tables, []);
		const tree = buildOwnershipTree(dbSchema);
		const jsonSchema = generateNestedJsonSchema(dbSchema, { ownershipTree: tree });

		const ajv = createAjv();
		const validate = ajv.compile(jsonSchema);

		// Valid: bio can be null
		expect(validate({ user: [{ id: "u1", bio: null }] })).toBe(true);
		// Valid: bio can be string
		expect(validate({ user: [{ id: "u1", bio: "Hello" }] })).toBe(true);
	});

	test("validates timestamps with date-time format", () => {
		const tables: Table[] = [
			{
				name: "Event",
				columns: [
					{ name: "id", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "created_at", type: "timestamptz", isNullable: false, hasDefault: true, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const dbSchema = createSchema(tables, []);
		const tree = buildOwnershipTree(dbSchema);
		const jsonSchema = generateNestedJsonSchema(dbSchema, { ownershipTree: tree });

		const ajv = createAjv();
		const validate = ajv.compile(jsonSchema);

		// Valid ISO 8601 timestamp
		expect(validate({ event: [{ id: "e1", created_at: "2026-01-17T15:30:00.000Z" }] })).toBe(true);
		// Invalid timestamp format
		expect(validate({ event: [{ id: "e1", created_at: "not-a-date" }] })).toBe(false);
	});
});
