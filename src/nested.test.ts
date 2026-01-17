import { describe, test, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { extractSchema } from "./schemaExtractor";
import { buildOwnershipTree } from "./ownershipTree";
import { toNested, fromNested } from "./nested";
import { createFlatDataset } from "./model";

describe("nested", () => {
	let db: PGlite;

	beforeEach(async () => {
		db = new PGlite();
	});

	describe("toNested", () => {
		test("converts flat to nested with children inlined", async () => {
			await db.exec(`
				CREATE TABLE "Organization" (id TEXT PRIMARY KEY, name TEXT);
				CREATE TABLE "Project" (
					id TEXT PRIMARY KEY,
					name TEXT,
					"organizationId" TEXT REFERENCES "Organization"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const flat = createFlatDataset({
				Organization: [{ id: "org-1", name: "Acme" }],
				Project: [
					{ id: "proj-1", name: "Alpha", organizationId: "org-1" },
					{ id: "proj-2", name: "Beta", organizationId: "org-1" },
				],
			});

			const { data } = toNested(flat, schema, tree);

			expect(data).toMatchInlineSnapshot(`
				{
				  "organization": [
				    {
				      "id": "org-1",
				      "name": "Acme",
				      "project": [
				        {
				          "id": "proj-1",
				          "name": "Alpha",
				        },
				        {
				          "id": "proj-2",
				          "name": "Beta",
				        },
				      ],
				    },
				  ],
				}
			`);
		});

		test("removes FK columns from nested children", async () => {
			await db.exec(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY);
				CREATE TABLE "Post" (
					id TEXT PRIMARY KEY,
					title TEXT,
					"authorId" TEXT REFERENCES "User"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const flat = createFlatDataset({
				User: [{ id: "u1" }],
				Post: [{ id: "p1", title: "Hello", authorId: "u1" }],
			});

			const { data } = toNested(flat, schema, tree);
			const post = (data.user[0] as Record<string, unknown>).post as Record<string, unknown>[];

			// authorId should be removed (implicit from nesting)
			expect(post[0]).not.toHaveProperty("authorId");
			expect(post[0]).toMatchInlineSnapshot(`
				{
				  "id": "p1",
				  "title": "Hello",
				}
			`);
		});

		test("handles multi-level nesting", async () => {
			await db.exec(`
				CREATE TABLE "Org" (id TEXT PRIMARY KEY);
				CREATE TABLE "Team" (
					id TEXT PRIMARY KEY,
					"orgId" TEXT REFERENCES "Org"(id) ON DELETE CASCADE
				);
				CREATE TABLE "Member" (
					id TEXT PRIMARY KEY,
					"teamId" TEXT REFERENCES "Team"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const flat = createFlatDataset({
				Org: [{ id: "o1" }],
				Team: [{ id: "t1", orgId: "o1" }],
				Member: [{ id: "m1", teamId: "t1" }],
			});

			const { data } = toNested(flat, schema, tree);

			expect(data).toMatchInlineSnapshot(`
				{
				  "org": [
				    {
				      "id": "o1",
				      "team": [
				        {
				          "id": "t1",
				          "member": [
				            {
				              "id": "m1",
				            },
				          ],
				        },
				      ],
				    },
				  ],
				}
			`);
		});

		test("respects limit option", async () => {
			await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY)`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const flat = createFlatDataset({
				User: [{ id: "u1" }, { id: "u2" }, { id: "u3" }],
			});

			const { data, truncated } = toNested(flat, schema, tree, { limit: 2 });

			expect(data.user).toMatchInlineSnapshot(`
				[
				  {
				    "id": "u1",
				  },
				  {
				    "id": "u2",
				  },
				  {
				    "$partial": true,
				    "skipped": 1,
				  },
				]
			`);
			expect(truncated.get("User")).toBe(1);
		});

		test("respects nestedLimit option", async () => {
			await db.exec(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY);
				CREATE TABLE "Post" (
					id TEXT PRIMARY KEY,
					"userId" TEXT REFERENCES "User"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const flat = createFlatDataset({
				User: [{ id: "u1" }],
				Post: [
					{ id: "p1", userId: "u1" },
					{ id: "p2", userId: "u1" },
					{ id: "p3", userId: "u1" },
				],
			});

			const { data } = toNested(flat, schema, tree, { nestedLimit: 2 });
			const user = data.user[0] as Record<string, unknown>;

			expect(user.post).toMatchInlineSnapshot(`
				[
				  {
				    "id": "p1",
				  },
				  {
				    "id": "p2",
				  },
				  {
				    "$partial": true,
				    "skipped": 1,
				  },
				]
			`);
		});
	});

	describe("fromNested", () => {
		test("converts nested back to flat", async () => {
			await db.exec(`
				CREATE TABLE "Organization" (id TEXT PRIMARY KEY, name TEXT);
				CREATE TABLE "Project" (
					id TEXT PRIMARY KEY,
					name TEXT,
					"organizationId" TEXT REFERENCES "Organization"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const nested = {
				organization: [
					{
						id: "org-1",
						name: "Acme",
						project: [
							{ id: "proj-1", name: "Alpha" },
							{ id: "proj-2", name: "Beta" },
						],
					},
				],
			};

			const flat = fromNested(nested, schema, tree);

			expect(flat.tables.get("Organization")).toMatchInlineSnapshot(`
				[
				  {
				    "id": "org-1",
				    "name": "Acme",
				  },
				]
			`);
			expect(flat.tables.get("Project")).toMatchInlineSnapshot(`
				[
				  {
				    "id": "proj-1",
				    "name": "Alpha",
				    "organizationId": "org-1",
				  },
				  {
				    "id": "proj-2",
				    "name": "Beta",
				    "organizationId": "org-1",
				  },
				]
			`);
		});

		test("reconstructs FK columns from parent context", async () => {
			await db.exec(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY);
				CREATE TABLE "Post" (
					id TEXT PRIMARY KEY,
					"authorId" TEXT REFERENCES "User"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const nested = {
				user: [
					{
						id: "u1",
						post: [{ id: "p1" }],
					},
				],
			};

			const flat = fromNested(nested, schema, tree);
			const posts = flat.tables.get("Post");

			expect(posts).toMatchInlineSnapshot(`
				[
				  {
				    "authorId": "u1",
				    "id": "p1",
				  },
				]
			`);
		});

		test("handles $ref markers", async () => {
			await db.exec(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY);
				CREATE TABLE "Post" (
					id TEXT PRIMARY KEY,
					"authorId" TEXT REFERENCES "User"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const nested = {
				user: [
					{
						id: "u1",
						post: [{ $ref: true, id: "p1" }],
					},
				],
			};

			const flat = fromNested(nested, schema, tree);
			const posts = flat.tables.get("Post");

			// Ref should create a minimal row with PK + FK
			expect(posts).toMatchInlineSnapshot(`
				[
				  {
				    "authorId": "u1",
				    "id": "p1",
				  },
				]
			`);
		});

		test("skips $partial markers", async () => {
			await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY)`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const nested = {
				user: [{ id: "u1" }, { $partial: true, skipped: 10 }],
			};

			const flat = fromNested(nested, schema, tree);

			expect(flat.tables.get("User")).toMatchInlineSnapshot(`
				[
				  {
				    "id": "u1",
				  },
				]
			`);
		});
	});

	describe("roundtrip", () => {
		test("toNested then fromNested preserves data", async () => {
			await db.exec(`
				CREATE TABLE "Organization" (id TEXT PRIMARY KEY, name TEXT);
				CREATE TABLE "Project" (
					id TEXT PRIMARY KEY,
					name TEXT,
					"organizationId" TEXT REFERENCES "Organization"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const original = createFlatDataset({
				Organization: [{ id: "org-1", name: "Acme" }],
				Project: [
					{ id: "proj-1", name: "Alpha", organizationId: "org-1" },
					{ id: "proj-2", name: "Beta", organizationId: "org-1" },
				],
			});

			const { data: nested } = toNested(original, schema, tree);
			const restored = fromNested(nested, schema, tree);

			expect(restored.tables.get("Organization")).toEqual(
				original.tables.get("Organization")
			);
			expect(restored.tables.get("Project")).toEqual(original.tables.get("Project"));
		});
	});
});
