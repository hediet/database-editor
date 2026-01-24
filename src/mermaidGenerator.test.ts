import { describe, test, expect } from "vitest";
import { generateMermaid } from "./mermaidGenerator";
import { createSchema, type Table, type Relationship } from "./model";
import { buildOwnershipTree } from "./ownershipTree";
import mermaid from "mermaid";

// Initialize mermaid for testing (browser-like environment via jsdom in vitest)
mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });

/** Validate that the mermaid diagram can be parsed without errors */
async function validateMermaid(diagram: string): Promise<void> {
	// mermaid.parse throws on invalid diagrams
	await mermaid.parse(diagram);
}

describe("generateMermaid", () => {
	test("generates valid ER diagram for simple table", async () => {
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
		const diagram = generateMermaid(schema);

		expect(diagram).toMatchInlineSnapshot(`
			"erDiagram
			    User {
			        uuid id PK
			        string email
			        string name \"nullable\"
			    }"
		`);

		await validateMermaid(diagram);
	});

	test("generates valid relationships between tables with underscored columns", async () => {
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
		const diagram = generateMermaid(schema);

		expect(diagram).toMatchInlineSnapshot(`
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

		await validateMermaid(diagram);
	});

	test("generates valid diagram distinguishing composition from reference", async () => {
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
		const diagram = generateMermaid(schema, { ownershipTree: tree });

		// CASCADE (composition) uses solid line --
		// SET NULL (reference) uses dotted line ..
		expect(diagram).toMatchInlineSnapshot(`
			"erDiagram
			    User {
			        uuid id PK
			    }
			    Session {
			        uuid id PK
			        uuid user_id FK
			    }
			    AuditLog {
			        uuid id PK
			        uuid user_id FK \"nullable\"
			    }
			    User ||--o{ Session : \"fk session user\"
			    User ||..o{ AuditLog : \"fk audit user\""
		`);

		await validateMermaid(diagram);
	});

	test("handles tables with no columns when showColumns is false", async () => {
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
		const diagram = generateMermaid(schema, { showColumns: false });

		expect(diagram).toMatchInlineSnapshot(`
			"erDiagram
			    User {
			    }"
		`);

		await validateMermaid(diagram);
	});

	test("maps PostgreSQL types to Mermaid types", async () => {
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
		const diagram = generateMermaid(schema);

		expect(diagram).toMatchInlineSnapshot(`
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

		await validateMermaid(diagram);
	});

	test("handles composite primary keys", async () => {
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
		const diagram = generateMermaid(schema);

		expect(diagram).toMatchInlineSnapshot(`
			"erDiagram
			    ProjectLanguage {
			        uuid project_id PK
			        uuid language_id PK
			        bool enabled
			    }"
		`);

		await validateMermaid(diagram);
	});

	test("escapes special characters in table names but not columns", async () => {
		const tables: Table[] = [
			{
				name: "user-data",
				columns: [
					{ name: "id", type: "uuid", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "user-email", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
		];

		const schema = createSchema(tables, []);
		const diagram = generateMermaid(schema);

		// Table name is quoted, column name with dash is converted to underscore
		expect(diagram).toMatchInlineSnapshot(`
			"erDiagram
			    \"user-data\" {
			        uuid id PK
			        string user_email
			    }"
		`);

		await validateMermaid(diagram);
	});

	test("complex schema with multiple FK columns validates in mermaid", async () => {
		const tables: Table[] = [
			{
				name: "Users",
				columns: [
					{ name: "id", type: "serial", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "name", type: "varchar", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
			{
				name: "Posts",
				columns: [
					{ name: "id", type: "serial", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "title", type: "varchar", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "author_id", type: "integer", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
			{
				name: "Comments",
				columns: [
					{ name: "id", type: "serial", isNullable: false, hasDefault: true, isGenerated: false },
					{ name: "body", type: "text", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "post_id", type: "integer", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "author_id", type: "integer", isNullable: true, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["id"],
			},
			{
				name: "PostTags",
				columns: [
					{ name: "post_id", type: "integer", isNullable: false, hasDefault: false, isGenerated: false },
					{ name: "tag_id", type: "integer", isNullable: false, hasDefault: false, isGenerated: false },
				],
				primaryKey: ["post_id", "tag_id"],
			},
		];
		const relationships: Relationship[] = [
			{
				id: "Posts_author_id_fkey",
				fromTable: "Posts",
				fromColumns: ["author_id"],
				toTable: "Users",
				toColumns: ["id"],
				onDelete: "CASCADE",
				onUpdate: "NO ACTION",
			},
			{
				id: "Comments_post_id_fkey",
				fromTable: "Comments",
				fromColumns: ["post_id"],
				toTable: "Posts",
				toColumns: ["id"],
				onDelete: "CASCADE",
				onUpdate: "NO ACTION",
			},
			{
				id: "Comments_author_id_fkey",
				fromTable: "Comments",
				fromColumns: ["author_id"],
				toTable: "Users",
				toColumns: ["id"],
				onDelete: "SET NULL",
				onUpdate: "NO ACTION",
			},
			{
				id: "PostTags_post_id_fkey",
				fromTable: "PostTags",
				fromColumns: ["post_id"],
				toTable: "Posts",
				toColumns: ["id"],
				onDelete: "CASCADE",
				onUpdate: "NO ACTION",
			},
		];

		const schema = createSchema(tables, relationships);
		const tree = buildOwnershipTree(schema);
		const diagram = generateMermaid(schema, { ownershipTree: tree });

		// The key test: this must not throw
		await validateMermaid(diagram);

		expect(diagram).toMatchInlineSnapshot(`
			"erDiagram
			    Users {
			        int id PK
			        string name
			    }
			    Posts {
			        int id PK
			        string title
			        int author_id FK
			    }
			    Comments {
			        int id PK
			        string body
			        int post_id FK
			        int author_id FK \"nullable\"
			    }
			    PostTags {
			        int post_id PK,FK
			        int tag_id PK
			    }
			    Users ||--o{ Posts : \"Posts author id fkey\"
			    Posts ||--o{ Comments : \"Comments post id fkey\"
			    Users ||..o{ Comments : \"Comments author id fkey\"
			    Posts ||--o{ PostTags : \"PostTags post id fkey\""
		`);
	});
});
