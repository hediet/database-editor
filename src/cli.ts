import { Command } from "commander";
import { DatabaseEditor } from "./databaseEditor";

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
	.action(async (options) => {
		const editor = await DatabaseEditor.connect(options.connection);
		try {
			await editor.dump({ output: options.output });
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
				} else if (change.type === "update") {
					console.log(`  UPDATE ${change.table} pk=${JSON.stringify(change.primaryKey)}`);
				} else {
					console.log(`  DELETE ${change.table} pk=${JSON.stringify(change.primaryKey)}`);
				}
			}
			console.log(`Total: ${changeSet.changes.length} change(s)`);
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
