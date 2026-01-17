import type { Schema, Table, Column } from "./model";

export interface JsonSchema {
	readonly $schema: string;
	readonly type: string;
	readonly properties: Record<string, unknown>;
	readonly definitions?: Record<string, unknown>;
}

/**
 * Generate a JSON Schema from a database schema.
 * This enables autocomplete and validation in editors.
 */
export function generateJsonSchema(schema: Schema): JsonSchema {
	const properties: Record<string, unknown> = {
		$schema: { type: "string" },
		$base: { type: "string" },
	};

	const definitions: Record<string, unknown> = {};

	for (const [tableName, table] of schema.tables) {
		// Create row schema for this table
		const rowSchema = generateRowSchema(table);
		definitions[`${tableName}Row`] = rowSchema;

		// Table property is an array of rows
		properties[tableName] = {
			type: "array",
			items: { $ref: `#/definitions/${tableName}Row` },
		};
	}

	return {
		$schema: "http://json-schema.org/draft-07/schema#",
		type: "object",
		properties,
		definitions,
	};
}

function generateRowSchema(table: Table): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const column of table.columns) {
		properties[column.name] = columnToJsonSchemaType(column);

		// Required if: not nullable AND no default AND not generated
		if (!column.isNullable && !column.hasDefault && !column.isGenerated) {
			required.push(column.name);
		}
	}

	return {
		type: "object",
		properties,
		required: required.length > 0 ? required : undefined,
		additionalProperties: false,
	};
}

function columnToJsonSchemaType(column: Column): Record<string, unknown> {
	const baseType = pgTypeToJsonSchemaType(column.type);

	if (column.isNullable) {
		// Allow null values
		if (typeof baseType.type === "string") {
			return { ...baseType, type: [baseType.type, "null"] };
		}
		return { oneOf: [baseType, { type: "null" }] };
	}

	return baseType;
}

function pgTypeToJsonSchemaType(pgType: string): Record<string, unknown> {
	// Normalize type for comparison
	const normalizedType = pgType.toLowerCase().replace(/\(.+\)/, "").trim();

	switch (normalizedType) {
		// Numeric types
		case "smallint":
		case "integer":
		case "int":
		case "int2":
		case "int4":
		case "serial":
		case "smallserial":
			return { type: "integer" };

		case "bigint":
		case "int8":
		case "bigserial":
			// JSON can't represent bigint precisely, use string
			return { type: "string", pattern: "^-?\\d+$" };

		case "real":
		case "float4":
		case "double precision":
		case "float8":
		case "numeric":
		case "decimal":
			return { type: "number" };

		// Boolean
		case "boolean":
		case "bool":
			return { type: "boolean" };

		// Text types
		case "text":
		case "varchar":
		case "character varying":
		case "char":
		case "character":
		case "name":
			return { type: "string" };

		// UUID
		case "uuid":
			return {
				type: "string",
				format: "uuid",
				pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
			};

		// Date/Time types
		case "date":
			return { type: "string", format: "date" };

		case "time":
		case "time without time zone":
			return { type: "string", format: "time" };

		case "timestamp":
		case "timestamp without time zone":
		case "timestamp with time zone":
		case "timestamptz":
			return { type: "string", format: "date-time" };

		// JSON types
		case "json":
		case "jsonb":
			return {}; // Any JSON value

		// Array types
		case "text[]":
		case "varchar[]":
			return { type: "array", items: { type: "string" } };

		case "integer[]":
		case "int4[]":
			return { type: "array", items: { type: "integer" } };

		// Binary
		case "bytea":
			return { type: "string", contentEncoding: "base64" };

		// Default: treat as string
		default:
			return { type: "string" };
	}
}
