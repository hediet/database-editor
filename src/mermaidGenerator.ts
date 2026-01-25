import type { Schema } from "./model.ts";
import type { OwnershipTree } from "./ownershipTree.ts";

export interface MermaidOptions {
	/** Include column details in tables */
	readonly showColumns?: boolean;
	/** Highlight composition relationships (CASCADE) differently */
	readonly highlightCompositions?: boolean;
	/** Ownership tree for relationship classification */
	readonly ownershipTree?: OwnershipTree;
}

/**
 * Generate a Mermaid ER diagram from a database schema.
 */
export function generateMermaid(schema: Schema, options: MermaidOptions = {}): string {
	const showColumns = options.showColumns ?? true;
	const highlightCompositions = options.highlightCompositions ?? true;
	const tree = options.ownershipTree;

	const lines: string[] = ["erDiagram"];

	// Generate table definitions
	for (const [tableName, table] of schema.tables) {
		if (showColumns) {
			lines.push(`    ${escapeEntityName(tableName)} {`);
			for (const column of table.columns) {
				const isPK = table.primaryKey.includes(column.name);
				const isFK = isForeignKey(column.name, tableName, schema);
				// Mermaid supports comma-separated keys like "PK,FK" but not "PK FK"
				const keyMarker = isPK && isFK ? " PK,FK" : isPK ? " PK" : isFK ? " FK" : "";
				const nullComment = column.isNullable ? ' "nullable"' : "";
				lines.push(
					`        ${mapPgTypeToMermaid(column.type)} ${escapeAttributeName(column.name)}${keyMarker}${nullComment}`
				);
			}
			lines.push("    }");
		} else {
			// Just declare the table exists
			lines.push(`    ${escapeEntityName(tableName)} {`);
			lines.push("    }");
		}
	}

	// Generate relationships
	for (const rel of schema.relationships) {
		const isComposition = rel.onDelete === "CASCADE";
		const classified = tree?.classifiedRelationships.find(
			(cr) => cr.relationship.id === rel.id
		);
		const isDominant = classified?.isDominant ?? false;

		// Relationship line style
		// CASCADE (composition) uses solid line --
		// Others (references) use dotted line ..
		let lineStyle: string;
		if (highlightCompositions && isComposition) {
			if (isDominant) {
				lineStyle = "--"; // solid for dominant composition
			} else {
				lineStyle = "--"; // solid for composition (even non-dominant)
			}
		} else {
			lineStyle = ".."; // dotted for references
		}

		// Build relationship label
		const label = rel.id.replace(/_/g, " ");

		// Mermaid ER syntax: Entity1 cardinality--cardinality Entity2 : "label"
		// ||--o{ means: Entity1 has exactly one, Entity2 has zero or more
		// toTable (referenced) has exactly one (||), fromTable (FK holder) has many (o{)
		lines.push(
			`    ${escapeEntityName(rel.toTable)} ||${lineStyle}o{ ${escapeEntityName(rel.fromTable)} : "${label}"`
		);
	}

	return lines.join("\n");
}

function isForeignKey(columnName: string, tableName: string, schema: Schema): boolean {
	return schema.relationships.some(
		(rel) => rel.fromTable === tableName && rel.fromColumns.includes(columnName)
	);
}

/**
 * Escape entity names (table names) for Mermaid ER diagrams.
 * Entity names can be quoted if they contain special characters.
 */
function escapeEntityName(name: string): string {
	if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
		return name;
	}
	return `"${name.replace(/"/g, '\\"')}"`;
}

/**
 * Escape attribute names (column names) for Mermaid ER diagrams.
 * Attributes cannot be quoted (quotes mean comments in Mermaid ER).
 * Convert invalid characters to underscores.
 */
function escapeAttributeName(name: string): string {
	// Replace any character that's not alphanumeric or underscore
	return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function mapPgTypeToMermaid(pgType: string): string {
	const normalizedType = pgType.toLowerCase().replace(/\(.+\)/, "").trim();

	switch (normalizedType) {
		case "text":
		case "varchar":
		case "character varying":
		case "char":
		case "character":
			return "string";

		case "integer":
		case "int":
		case "int4":
		case "smallint":
		case "int2":
		case "serial":
		case "smallserial":
			return "int";

		case "bigint":
		case "int8":
		case "bigserial":
			return "bigint";

		case "real":
		case "float4":
		case "double precision":
		case "float8":
		case "numeric":
		case "decimal":
			return "float";

		case "boolean":
		case "bool":
			return "bool";

		case "uuid":
			return "uuid";

		case "date":
			return "date";

		case "timestamp":
		case "timestamp without time zone":
		case "timestamp with time zone":
		case "timestamptz":
			return "timestamp";

		case "time":
		case "time without time zone":
			return "time";

		case "json":
		case "jsonb":
			return "json";

		case "bytea":
			return "bytes";

		default:
			return pgType;
	}
}
