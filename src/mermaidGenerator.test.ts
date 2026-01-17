import { describe, test, expect } from "vitest";
import { generateMermaid } from "./mermaidGenerator";
import { createSchema, type Table, type Relationship } from "./model";
import { buildOwnershipTree } from "./ownershipTree";

describe("generateMermaid", () => {
	test("generates ER diagram for simple table", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "uuid", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "email", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "name", type: "text", isNullable: true, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = createSchema(tables, []);
		const mermaid = generateMermaid(schema);

		expect(mermaid).toMatchInlineSnapshot(`
			"erDiagram
			    User {
			        uuid id PK
			        string email
			        string? name
			    }"
		`);
	});

	test("generates relationships between tables", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "uuid", isNullable: false, hasDefault: true, isGenerated: false },
				],
				primaryKey: ["id"],
			},
			{
				name: "Post",
				columns: [
					{ name: "id", type: "uuid", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "user_id", type: "uuid", isNullable: false, hasDefault: false, isGenerated: false },
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

		const schema = createSchema(tables, relationships);
		const mermaid = generateMermaid(schema);

		expect(mermaid).toMatchInlineSnapshot(`
			"erDiagram
			    User {
			        uuid id PK
			    }
			    Post {
			        uuid id PK
			        uuid user_id FK
			    }
			    User ||--o{ Post : "fk post user""
		`);
	});

	test("distinguishes composition from reference relationships", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [{ name: "id", type: "uuid", isNullable: false, hasDefault: true, isGenerated: false }],
				primaryKey: ["id"],
			},
			{
				name: "Session",
				columns: [
					{ name: "id", type: "uuid", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "user_id", type: "uuid", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
			{
				name: "AuditLog",
				columns: [
					{ name: "id", type: "uuid", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "user_id", type: "uuid", isNullable: true, hasDefault: false, isGenerated: false },
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
				onDelete: "CASCADE", // composition
				onUpdate: "NO ACTION",
			},
			{
				id: "fk_audit_user",
				fromTable: "AuditLog",
				fromColumns: ["user_id"],
				toTable: "User",
				toColumns: ["id"],
				onDelete: "SET NULL", // reference
				onUpdate: "NO ACTION",
			},
		];

		const schema = createSchema(tables, relationships);
		const tree = buildOwnershipTree(schema);
		const mermaid = generateMermaid(schema, { ownershipTree: tree });

		// CASCADE (composition) uses solid line --
		// SET NULL (reference) uses dotted line ..
		expect(mermaid).toContain('User ||--o{ Session : "fk session user"');
		expect(mermaid).toContain('User ||..o{ AuditLog : "fk audit user"');
	});

	test("handles tables with no columns when showColumns is false", () => {
		const tables: Table[] = [
			{
				name: "User",
				columns: [
					{ name: "id", type: "uuid", isNullable: false, hasDefault: true, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = createSchema(tables, []);
		const mermaid = generateMermaid(schema, { showColumns: false });

		expect(mermaid).toMatchInlineSnapshot(`
			"erDiagram
			    User {
			    }"
		`);
	});

	test("maps PostgreSQL types to Mermaid types", () => {
		const tables: Table[] = [
			{
				name: "AllTypes",
				columns: [
					{ name: "id", type: "serial", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "big_id", type: "bigint", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "amount", type: "numeric", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "active", type: "boolean", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "uuid_col", type: "uuid", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "created", type: "timestamptz", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "data", type: "jsonb", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = createSchema(tables, []);
		const mermaid = generateMermaid(schema);

		expect(mermaid).toMatchInlineSnapshot(`
			"erDiagram
			    AllTypes {
			        int id PK
			        bigint big_id
			        float amount
			        bool active
			        uuid uuid_col
			        timestamp created
			        json data
			    }"
		`);
	});

	test("handles composite primary keys", () => {
		const tables: Table[] = [
			{
				name: "ProjectLanguage",
				columns: [
					{ name: "project_id", type: "uuid", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "language_id", type: "uuid", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "enabled", type: "boolean", isNullable: false, hasDefault: true, isGenerated: false },
				],
				primaryKey: ["project_id", "language_id"],
			},
		];

		const schema = createSchema(tables, []);
		const mermaid = generateMermaid(schema);

		expect(mermaid).toMatchInlineSnapshot(`
			"erDiagram
			    ProjectLanguage {
			        uuid project_id PK
			        uuid language_id PK
			        bool enabled
			    }"
		`);
	});

	test("escapes special characters in table names", () => {
		const tables: Table[] = [
			{
				name: "user-data",
				columns: [
					{ name: "id", type: "uuid", isNullable: false, hasDefault: true, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = createSchema(tables, []);
		const mermaid = generateMermaid(schema);

		expect(mermaid).toContain('"user-data"');
	});
});
