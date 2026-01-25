import { describe, test, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";

/**
 * CLI Integration Tests
 * 
 * These tests verify the full CLI workflow using PGLite databases
 * persisted to disk, simulating real-world usage.
 * 
 * IMPORTANT: Run `npm run build` before running these tests!
 */
describe("CLI Integration", () => {
    let tempDir: string;
    let dbPath: string;

    // Path to the built CLI - relative to project root
    const cliPath = path.resolve(process.cwd(), "dist/cli.js");

    beforeAll(() => {
        // Verify CLI exists
        if (!fs.existsSync(cliPath)) {
            throw new Error(
                `CLI not found at ${cliPath}. Run 'npm run build' before running integration tests.`
            );
        }
    });

    beforeEach(async () => {
        // Create temp directory for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
        dbPath = path.join(tempDir, "testdb");
    });

    afterEach(() => {
        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    /**
     * Run CLI command and return result
     */
    function runCli(args: string): { stdout: string; stderr: string; exitCode: number } {
        const result = spawnSync("node", [cliPath, ...args.split(" ")], {
            cwd: tempDir,
            encoding: "utf-8",
            timeout: 30000,
        });
        return {
            stdout: result.stdout || "",
            stderr: result.stderr || "",
            exitCode: result.status ?? 1,
        };
    }

    /**
     * Helper to set up a database with schema and data
     */
    async function setupDatabase(sql: string): Promise<void> {
        const db = new PGlite(dbPath);
        await db.exec(sql);
        await db.close();
    }

    describe("dump command", () => {
        test("dumps database to nested JSON file", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				INSERT INTO "User" VALUES ('u1', 'Alice'), ('u2', 'Bob');
			`);

            const outputPath = path.join(tempDir, "data.json");
            const result = runCli(`dump -c pglite:${dbPath} -o ${outputPath}`);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain("Exported to");

            const content = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
            expect(content.user).toMatchInlineSnapshot(`
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
        });

        test("dumps database to flat JSON file with --flat", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				INSERT INTO "User" VALUES ('u1', 'Alice');
			`);

            const outputPath = path.join(tempDir, "data.json");
            const result = runCli(`dump -c pglite:${dbPath} -o ${outputPath} --flat`);

            expect(result.exitCode).toBe(0);

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

        test("creates base file and schema file in .db-editor directory", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
			`);

            const outputPath = path.join(tempDir, "data.json");
            runCli(`dump -c pglite:${dbPath} -o ${outputPath}`);

            const dbEditorDir = path.join(tempDir, ".db-editor");
            expect(fs.existsSync(dbEditorDir)).toBe(true);
            expect(fs.existsSync(path.join(dbEditorDir, "data.base.json"))).toBe(true);
            expect(fs.existsSync(path.join(dbEditorDir, "data.schema.json"))).toBe(true);
        });

        test("respects --limit option", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				INSERT INTO "User" VALUES ('u1', 'A'), ('u2', 'B'), ('u3', 'C'), ('u4', 'D'), ('u5', 'E');
			`);

            const outputPath = path.join(tempDir, "data.json");
            runCli(`dump -c pglite:${dbPath} -o ${outputPath} --limit 2`);

            const content = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
            expect(content.user).toMatchInlineSnapshot(`
              [
                {
                  "id": "u1",
                  "name": "A",
                },
                {
                  "id": "u2",
                  "name": "B",
                },
              ]
            `);
        });
    });

    describe("preview command", () => {
        test("shows changes without applying them", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				INSERT INTO "User" VALUES ('u1', 'Alice');
			`);

            // Create a file with changes (add a user)
            const inputPath = path.join(tempDir, "data.json");
            fs.writeFileSync(inputPath, JSON.stringify({
                User: [
                    { id: "u1", name: "Alice" },
                    { id: "u2", name: "Bob" },
                ],
            }));

            const result = runCli(`preview -c pglite:${dbPath} -f ${inputPath}`);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toMatchInlineSnapshot(`
              "Changes to apply:
                INSERT User
                  + id: "u2"
                  + name: "Bob"
              Total: 1 change(s)
              "
            `);

            // Verify database unchanged
            const db = new PGlite(dbPath);
            const rows = await db.query('SELECT * FROM "User"');
            expect(rows.rows).toHaveLength(1);
            await db.close();
        });

        test("shows no changes message when file matches database", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				INSERT INTO "User" VALUES ('u1', 'Alice');
			`);

            const inputPath = path.join(tempDir, "data.json");
            fs.writeFileSync(inputPath, JSON.stringify({
                User: [{ id: "u1", name: "Alice" }],
            }));

            const result = runCli(`preview -c pglite:${dbPath} -f ${inputPath}`);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain("No changes");
        });

        test("outputs SQL with --sql flag", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				INSERT INTO "User" VALUES ('u1', 'Alice');
			`);

            const inputPath = path.join(tempDir, "data.json");
            fs.writeFileSync(inputPath, JSON.stringify({
                User: [
                    { id: "u1", name: "Alice Updated" },
                ],
            }));

            const result = runCli(`preview -c pglite:${dbPath} -f ${inputPath} --sql`);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toMatchInlineSnapshot(`
              "Changes to apply:
                UPDATE User pk={"id":"u1"}
                  name: "Alice" → "Alice Updated"
              Total: 1 change(s)

              SQL statements:
              UPDATE "User" SET "name" = $1 WHERE "id" = $2;;
                -- params: ["Alice Updated","u1"]
              "
            `);
        });
    });

    describe("sync command (three-way merge)", () => {
        test("applies user changes while preserving concurrent DB changes", async () => {
            // Initial state
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				INSERT INTO "User" VALUES ('u1', 'Alice');
			`);

            // Dump to create base file
            const dataPath = path.join(tempDir, "data.json");
            runCli(`dump -c pglite:${dbPath} -o ${dataPath}`);

            // Simulate concurrent change: add user directly to DB
            const db1 = new PGlite(dbPath);
            await db1.exec(`INSERT INTO "User" VALUES ('u2', 'Bob')`);
            await db1.close();

            // User edits their dump: adds u3
            const content = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
            content.user.push({ id: "u3", name: "Charlie" });
            fs.writeFileSync(dataPath, JSON.stringify(content, null, 2));

            // Sync with --yes to skip confirmation
            const result = runCli(`sync -c pglite:${dbPath} -f ${dataPath} --yes`);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toMatchInlineSnapshot(`
              "Changes to apply:
                INSERT User
                  + id: "u3"
                  + name: "Charlie"
              Total: 1 change(s)
              Applied 1 change(s).
              "
            `);

            // Verify all users present (u1 original, u2 concurrent, u3 user's add)
            const db2 = new PGlite(dbPath);
            const rows = await db2.query<{ id: string }>('SELECT * FROM "User" ORDER BY id');
            expect(rows.rows.map(r => r.id)).toMatchInlineSnapshot();
            await db2.close();
        });

        test("requires base file for sync", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
			`);

            // Create file without $base reference
            const inputPath = path.join(tempDir, "data.json");
            fs.writeFileSync(inputPath, JSON.stringify({ User: [] }));

            const result = runCli(`sync -c pglite:${dbPath} -f ${inputPath} --yes`);

            expect(result.exitCode).not.toBe(0);
            expect(result.stderr).toContain("base file");
        });
    });

    describe("reset command (two-way diff)", () => {
        test("makes database match file exactly", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				INSERT INTO "User" VALUES ('u1', 'Alice'), ('u2', 'Bob'), ('u3', 'Charlie');
			`);

            // Reset to only have u1 with updated name
            const inputPath = path.join(tempDir, "data.json");
            fs.writeFileSync(inputPath, JSON.stringify({
                User: [{ id: "u1", name: "Alice Updated" }],
            }));

            const result = runCli(`reset -c pglite:${dbPath} -f ${inputPath} --yes`);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toMatchInlineSnapshot(`
              "Changes to apply:
                DELETE User pk={"id":"u2"}
                  - id: "u2"
                  - name: "Bob"
                DELETE User pk={"id":"u3"}
                  - id: "u3"
                  - name: "Charlie"
                UPDATE User pk={"id":"u1"}
                  name: "Alice" → "Alice Updated"
              Total: 3 change(s)

              ⚠️  WARNING: Reset will delete any rows in the database that are not in the file!
              Database reset to match file.
              "
            `);

            // Verify database matches file
            const db = new PGlite(dbPath);
            const rows = await db.query('SELECT * FROM "User" ORDER BY id');
            expect(rows.rows).toMatchInlineSnapshot(`
              [
                {
                  "id": "u1",
                  "name": "Alice Updated",
                },
              ]
            `);
            await db.close();
        });

        test("shows warning about data deletion", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				INSERT INTO "User" VALUES ('u1', 'Alice'), ('u2', 'Bob');
			`);

            const inputPath = path.join(tempDir, "data.json");
            fs.writeFileSync(inputPath, JSON.stringify({
                User: [{ id: "u1", name: "Alice" }],
            }));

            const result = runCli(`reset -c pglite:${dbPath} -f ${inputPath} --yes`);

            expect(result.stdout).toContain("WARNING");
        });
    });

    describe("mermaid command", () => {
        test("generates Mermaid ER diagram", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT);
				CREATE TABLE "Post" (
					id TEXT PRIMARY KEY,
					title TEXT,
					user_id TEXT REFERENCES "User"(id) ON DELETE CASCADE
				);
			`);

            const result = runCli(`mermaid -c pglite:${dbPath}`);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toMatchInlineSnapshot(`
              "erDiagram
                  Post {
                      string id PK
                      string title "nullable"
                      string user_id FK "nullable"
                  }
                  User {
                      string id PK
                      string name "nullable"
                  }
                  User ||--o{ Post : "Post user id fkey"
              "
            `);
        });

        test("outputs to file with -o option", async () => {
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY);
			`);

            const outputPath = path.join(tempDir, "diagram.mmd");
            const result = runCli(`mermaid -c pglite:${dbPath} -o ${outputPath}`);

            expect(result.exitCode).toBe(0);
            expect(fs.existsSync(outputPath)).toBe(true);
            expect(fs.readFileSync(outputPath, "utf-8")).toContain("erDiagram");
        });
    });

    describe("full workflow", () => {
        test("dump → edit → preview → sync cycle", async () => {
            // 1. Set up initial database
            await setupDatabase(`
				CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT, email TEXT);
				CREATE TABLE "Post" (
					id TEXT PRIMARY KEY,
					title TEXT,
					user_id TEXT REFERENCES "User"(id) ON DELETE CASCADE
				);
				INSERT INTO "User" VALUES ('u1', 'Alice', 'alice@test.com');
				INSERT INTO "Post" VALUES ('p1', 'Hello World', 'u1');
			`);

            // 2. Dump database
            const dataPath = path.join(tempDir, "data.json");
            let result = runCli(`dump -c pglite:${dbPath} -o ${dataPath}`);
            expect(result.exitCode).toBe(0);

            // 3. Edit the dump (update user, add post)
            const content = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
            content.user[0].name = "Alice Smith";
            content.user[0].post.push({ id: "p2", title: "Second Post" });
            fs.writeFileSync(dataPath, JSON.stringify(content, null, 2));

            // 4. Preview changes
            result = runCli(`preview -c pglite:${dbPath} -f ${dataPath}`);
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toMatchInlineSnapshot(`
              "Changes to apply:
                UPDATE User pk={"id":"u1"}
                  name: "Alice" → "Alice Smith"
                INSERT Post
                  + id: "p2"
                  + title: "Second Post"
                  + user_id: "u1"
              Total: 2 change(s)
              "
            `);

            // 5. Apply changes
            result = runCli(`sync -c pglite:${dbPath} -f ${dataPath} --yes`);
            expect(result.exitCode).toBe(0);

            // 6. Verify changes
            const db = new PGlite(dbPath);
            const users = await db.query('SELECT * FROM "User"');
            expect(users.rows).toMatchInlineSnapshot();

            const posts = await db.query('SELECT * FROM "Post" ORDER BY id');
            expect(posts.rows).toMatchInlineSnapshot();
            await db.close();
        });

        test("handles nested format roundtrip correctly", async () => {
            await setupDatabase(`
				CREATE TABLE "Organization" (id TEXT PRIMARY KEY, name TEXT);
				CREATE TABLE "Team" (
					id TEXT PRIMARY KEY,
					name TEXT,
					org_id TEXT REFERENCES "Organization"(id) ON DELETE CASCADE
				);
				CREATE TABLE "Member" (
					id TEXT PRIMARY KEY,
					name TEXT,
					team_id TEXT REFERENCES "Team"(id) ON DELETE CASCADE
				);
				INSERT INTO "Organization" VALUES ('o1', 'Acme');
				INSERT INTO "Team" VALUES ('t1', 'Engineering', 'o1');
				INSERT INTO "Member" VALUES ('m1', 'Alice', 't1'), ('m2', 'Bob', 't1');
			`);

            // Dump
            const dataPath = path.join(tempDir, "data.json");
            runCli(`dump -c pglite:${dbPath} -o ${dataPath}`);

            // Verify nested structure
            const content = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
            expect(content.organization).toMatchInlineSnapshot(`
              [
                {
                  "id": "o1",
                  "name": "Acme",
                  "team": [
                    {
                      "id": "t1",
                      "member": [
                        {
                          "id": "m1",
                          "name": "Alice",
                        },
                        {
                          "id": "m2",
                          "name": "Bob",
                        },
                      ],
                      "name": "Engineering",
                    },
                  ],
                },
              ]
            `);

            // Edit: add a member
            content.organization[0].team[0].member.push({ id: "m3", name: "Charlie" });
            fs.writeFileSync(dataPath, JSON.stringify(content, null, 2));

            // Sync
            runCli(`sync -c pglite:${dbPath} -f ${dataPath} --yes`);

            // Verify
            const db = new PGlite(dbPath);
            const members = await db.query('SELECT * FROM "Member" ORDER BY id');
            expect(members.rows).toMatchInlineSnapshot();
            await db.close();
        });
    });
});
