import { Command } from "commander";
import { DatabaseEditor } from "./databaseEditor";
import { generateSql } from "./sqlGenerator";

const program = new Command();

program
	.name("db-editor")
	.description("Edit PostgreSQL database data as JSON files")
	.version("2.0.0");

program
	.command("dump")
	.description("Export database tables to a JSON file")
	.requiredOption("-c, --connection <string>", "PostgreSQL connection string")
	.requiredOption("-o, --output <file>", "Output JSON file path")
	.option("-l, --limit <number>", "Maximum rows to export per table", parseInt)
	.action(async (options) => {
		const editor = await DatabaseEditor.connect(options.connection);
		try {
			await editor.dump({ output: options.output, limit: options.limit });
			console.log(`Exported to ${options.output}`);
		} finally {
			await editor.close();
		}
	});

program
	.command("preview")
	.description("Show changes that would be applied to sync file to database")
	.requiredOption("-c, --connection <string>", "PostgreSQL connection string")
	.requiredOption("-f, --file <file>", "JSON file to preview")
	.option("--sql", "Output SQL statements instead of change summary")
	.action(async (options) => {
		const editor = await DatabaseEditor.connect(options.connection);
		try {
			const changeSet = await editor.preview(options.file);
			if (changeSet.changes.length === 0) {
				console.log("No changes to apply.");
				return;
			}
			console.log("Changes to apply:");
			for (const change of changeSet.changes) {
				if (change.type === "insert") {
					console.log(`  INSERT ${change.table}`);
					for (const [key, value] of Object.entries(change.row)) {
						console.log(`    + ${key}: ${JSON.stringify(value)}`);
					}
				} else if (change.type === "update") {
					console.log(`  UPDATE ${change.table} pk=${JSON.stringify(change.primaryKey)}`);
					for (const key of Object.keys(change.newValues)) {
						const oldVal = change.oldValues[key];
						const newVal = change.newValues[key];
						console.log(`    ${key}: ${JSON.stringify(oldVal)} → ${JSON.stringify(newVal)}`);
					}
				} else {
					console.log(`  DELETE ${change.table} pk=${JSON.stringify(change.primaryKey)}`);
					for (const [key, value] of Object.entries(change.oldRow)) {
						console.log(`    - ${key}: ${JSON.stringify(value)}`);
					}
				}
			}
			console.log(`Total: ${changeSet.changes.length} change(s)`);

			if (options.sql) {
				console.log("\nSQL statements:");
				const statements = generateSql(changeSet);
				for (const stmt of statements) {
					console.log(`${stmt.sql};`);
					if (stmt.params.length > 0) {
						console.log(`  -- params: ${JSON.stringify(stmt.params)}`);
					}
				}
			}
		} finally {
			await editor.close();
		}
	});

program
	.command("sync")
	.description("Apply changes from file to database (three-way merge)")
	.requiredOption("-c, --connection <string>", "PostgreSQL connection string")
	.requiredOption("-f, --file <file>", "JSON file to sync")
	.action(async (options) => {
		const editor = await DatabaseEditor.connect(options.connection);
		try {
			const changeSet = await editor.preview(options.file);
			if (changeSet.changes.length === 0) {
				console.log("No changes to apply.");
				return;
			}
			await editor.reset(options.file);
			console.log(`Applied ${changeSet.changes.length} change(s).`);
		} finally {
			await editor.close();
		}
	});

program
	.command("reset")
	.description("Reset database to match file exactly (two-way diff)")
	.requiredOption("-c, --connection <string>", "PostgreSQL connection string")
	.requiredOption("-f, --file <file>", "JSON file to reset to")
	.action(async (options) => {
		const editor = await DatabaseEditor.connect(options.connection);
		try {
			await editor.reset(options.file);
			console.log("Database reset to match file.");
		} finally {
			await editor.close();
		}
	});

program.parse();
