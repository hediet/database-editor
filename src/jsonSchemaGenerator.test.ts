import { describe, test, expect } from "vitest";
import { generateJsonSchema } from "./jsonSchemaGenerator";
import { createSchema, type Table } from "./model";

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
