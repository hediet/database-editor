import { describe, test, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { extractSchema } from "./schemaExtractor";
import { buildOwnershipTree } from "./ownershipTree";

describe("ownershipTree", () => {
	let db: PGlite;

	beforeEach(async () => {
		db = new PGlite();
	});

	describe("buildOwnershipTree", () => {
		test("identifies root tables (no dominant parent)", async () => {
			await db.exec(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				CREATE TABLE "Project" (id TEXT PRIMARY KEY, name TEXT);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			expect([...tree.roots].sort()).toEqual(["Project", "User"]);
		});

		test("CASCADE relationship creates composition", async () => {
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

			expect(tree.roots).toEqual(["Organization"]);
			expect(tree.getChildren("Organization").map((e) => e.childTable)).toEqual(["Project"]);
			expect(tree.getDominantParent("Project")?.parentTable).toBe("Organization");
		});

		test("non-CASCADE relationships are references (not nested)", async () => {
			await db.exec(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY);
				CREATE TABLE "Project" (
					id TEXT PRIMARY KEY,
					"ownerId" TEXT REFERENCES "User"(id) ON DELETE SET NULL
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			// Both tables are roots (no composition)
			expect([...tree.roots].sort()).toEqual(["Project", "User"]);
			expect(tree.getChildren("User")).toEqual([]);
			expect(tree.getDominantParent("Project")).toBeUndefined();
		});

		test("self-references are always references", async () => {
			await db.exec(`
				CREATE TABLE "Category" (
					id TEXT PRIMARY KEY,
					name TEXT,
					"parentId" TEXT REFERENCES "Category"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			// Self-reference should NOT create nesting
			expect(tree.roots).toEqual(["Category"]);
			expect(tree.getChildren("Category")).toEqual([]);
			expect(tree.getDominantParent("Category")).toBeUndefined();
		});

		test("multi-level nesting", async () => {
			await db.exec(`
				CREATE TABLE "Organization" (id TEXT PRIMARY KEY);
				CREATE TABLE "Project" (
					id TEXT PRIMARY KEY,
					"organizationId" TEXT REFERENCES "Organization"(id) ON DELETE CASCADE
				);
				CREATE TABLE "Task" (
					id TEXT PRIMARY KEY,
					"projectId" TEXT REFERENCES "Project"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			expect(tree.roots).toEqual(["Organization"]);
			expect(tree.getChildren("Organization").map((e) => e.childTable)).toEqual(["Project"]);
			expect(tree.getChildren("Project").map((e) => e.childTable)).toEqual(["Task"]);
			expect(tree.getDominantParent("Task")?.parentTable).toBe("Project");
		});

		test("picks dominant parent when table has multiple compositions", async () => {
			await db.exec(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY);
				CREATE TABLE "Project" (id TEXT PRIMARY KEY);
				CREATE TABLE "Membership" (
					id TEXT PRIMARY KEY,
					"userId" TEXT REFERENCES "User"(id) ON DELETE CASCADE,
					"projectId" TEXT REFERENCES "Project"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			// Membership has two CASCADE parents - should pick one (alphabetically: Project)
			expect([...tree.roots].sort()).toEqual(["Project", "User"]);
			const dominant = tree.getDominantParent("Membership");
			expect(dominant).toBeDefined();
			// Either Project or User could be dominant depending on heuristics
			expect(["Project", "User"]).toContain(dominant?.parentTable);
		});

		test("foreignKeyColumns contains the FK columns on child", async () => {
			await db.exec(`
				CREATE TABLE "Organization" (id TEXT PRIMARY KEY);
				CREATE TABLE "Project" (
					id TEXT PRIMARY KEY,
					"orgId" TEXT REFERENCES "Organization"(id) ON DELETE CASCADE
				);
			`);

			const schema = await extractSchema(db);
			const tree = buildOwnershipTree(schema);

			const edge = tree.getChildren("Organization")[0];
			expect(edge.foreignKeyColumns).toEqual(["orgId"]);
		});
	});
});
