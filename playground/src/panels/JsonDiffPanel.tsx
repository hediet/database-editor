import { derived, autorun } from "@vscode/observables";
import { viewWithModel, ViewModel, inject, prop } from "@vscode/observables-react";
import { DiffEditor, Monaco } from "@monaco-editor/react";
import { editor } from "monaco-editor";
import { SqlStatement } from "database-editor";
import { PlaygroundViewModelKey, ViewMode } from "../PlaygroundViewModel";
import { styles } from "../styles";

class JsonDiffViewModel extends ViewModel({
    playground: inject(PlaygroundViewModelKey),
}) {
    private _monacoInstance: Monaco | null = null;

    readonly baseJson = derived((reader) => this.props.playground.baseJson.read(reader));
    readonly dumpJson = derived((reader) => this.props.playground.dumpJson.read(reader));
    readonly editedJson = derived((reader) => this.props.playground.editedJson.read(reader));
    readonly updateStatements = derived((reader) => this.props.playground.updateStatements.read(reader));
    readonly databaseState = derived((reader) => this.props.playground.databaseState.read(reader));
    readonly viewMode = derived((reader) => this.props.playground.viewMode.read(reader));
    readonly limit = derived((reader) => this.props.playground.limit.read(reader));
    readonly nestedLimit = derived((reader) => this.props.playground.nestedLimit.read(reader));
    readonly hasLimits = derived((reader) => this.props.playground.hasLimits.read(reader));
    readonly needsReset = derived((reader) => this.props.playground.needsReset.read(reader));
    readonly cliCommand = derived((reader) => this.props.playground.cliDumpCommand.read(reader));
    readonly cliSyncCommand = derived((reader) => this.props.playground.cliSyncCommand.read(reader));

    resetToCurrentDump(): void {
        this.props.playground.resetToCurrentDump();
    }

    setViewMode(mode: ViewMode): void {
        this.props.playground.viewMode.set(mode, undefined);
    }

    setLimit(value: string): void {
        const num = value === "" ? undefined : parseInt(value, 10);
        this.props.playground.limit.set(isNaN(num!) ? undefined : num, undefined);
    }

    setNestedLimit(value: string): void {
        const num = value === "" ? undefined : parseInt(value, 10);
        this.props.playground.nestedLimit.set(isNaN(num!) ? undefined : num, undefined);
    }

    handleEditorMount(diffEditor: editor.IStandaloneDiffEditor, monaco: Monaco): void {
        this._monacoInstance = monaco;
        this._updateJsonSchema();

        const modifiedEditor = diffEditor.getModifiedEditor();
        modifiedEditor.getModel()?.setEOL(editor.EndOfLineSequence.LF);
        modifiedEditor.onDidChangeModelContent(() => {
            this.props.playground.editedJson.set(modifiedEditor.getValue(), undefined);
        });

        this._store.add(
            autorun(() => {
                this._updateJsonSchema();
            })
        );
    }

    private _updateJsonSchema(): void {
        const state = this.props.playground.databaseState.get();
        if (this._monacoInstance && state?.jsonSchema) {
            this._monacoInstance.languages.json.jsonDefaults.setDiagnosticsOptions({
                validate: true,
                schemas: [
                    {
                        uri: "http://database-editor/nested-schema.json",
                        fileMatch: ["*"],
                        schema: state.jsonSchema,
                    },
                ],
            });
        }
    }
}

export const JsonDiffPanel = viewWithModel(JsonDiffViewModel, {}, (reader, vm) => {
    const baseJson = vm.baseJson.read(reader);
    const editedJson = vm.editedJson.read(reader);
    const updateStatements = vm.updateStatements.read(reader);
    const viewMode = vm.viewMode.read(reader);
    const limit = vm.limit.read(reader);
    const nestedLimit = vm.nestedLimit.read(reader);
    const hasLimits = vm.hasLimits.read(reader);
    const needsReset = vm.needsReset.read(reader);
    const cliCommand = vm.cliCommand.read(reader);

    return (
        <div style={styles.panelContainer}>
            <div style={styles.cliCommandBar}>
                <code style={styles.cliCode}>{cliCommand}</code>
                {needsReset && (
                    <button style={styles.resetButton} onClick={() => vm.resetToCurrentDump()}>
                        Reset to Current
                    </button>
                )}
            </div>
            <div style={styles.toolbarRow}>
                <label style={styles.toolbarLabel}>Format:</label>
                <select
                    style={styles.dropdown}
                    value={viewMode}
                    onChange={(e) => vm.setViewMode(e.target.value as ViewMode)}
                >
                    <option value="nested">Nested</option>
                    <option value="flat">Flat</option>
                </select>
                <label style={styles.toolbarLabel}>Limit:</label>
                <input
                    type="number"
                    style={styles.numberInput}
                    placeholder="∞"
                    value={limit ?? ""}
                    onChange={(e) => vm.setLimit(e.target.value)}
                    min={1}
                />
                {viewMode === "nested" && (
                    <>
                        <label style={styles.toolbarLabel}>Nested Limit:</label>
                        <input
                            type="number"
                            style={styles.numberInput}
                            placeholder="∞"
                            value={nestedLimit ?? ""}
                            onChange={(e) => vm.setNestedLimit(e.target.value)}
                            min={1}
                        />
                    </>
                )}
            </div>
            <div style={styles.diffEditorContainer}>
                <DiffEditor
                    height="100%"
                    language="json"
                    theme="vs-dark"
                    original={baseJson}
                    modified={editedJson}
                    onMount={(editor, monaco) => vm.handleEditorMount(editor, monaco)}
                    options={{
                        readOnly: false,
                        originalEditable: false,
                        minimap: { enabled: false },
                        fontSize: 13,
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        renderSideBySide: true,
                    }}
                />
            </div>

            <SqlStatementsPreview statements={updateStatements} hasLimits={hasLimits} cliCommand={vm.cliSyncCommand.read(reader)} />
        </div>
    );
});

class SqlStatementsViewModel extends ViewModel({
    playground: inject(PlaygroundViewModelKey),
}) {
    appendToSql(statements: SqlStatement[]): void {
        this.props.playground.appendSqlStatements(statements);
    }
}

const SqlStatementsPreview = viewWithModel(
    SqlStatementsViewModel,
    {
        statements: prop<SqlStatement[]>(),
        hasLimits: prop<boolean>(),
        cliCommand: prop<string>(),
    },
    (reader, vm, props) => {
        const statements = props.statements.read(reader);
        const hasLimits = props.hasLimits.read(reader);
        const cliCommand = props.cliCommand.read(reader);

        return (
            <div style={styles.sqlPreviewSection}>
                <div style={styles.sqlPreviewHeader}>
                    <div style={styles.headerLeftGroup}>
                        <span style={styles.sectionTitle}>SQL Statements ({statements.length})</span>
                        <span style={styles.sectionDescription}>
                            {hasLimits ? "(limits applied)" : "(edit JSON to generate)"}
                        </span>
                        <code style={styles.cliCode}>{cliCommand}</code>
                    </div>
                    {statements.length > 0 && (
                        <button style={styles.primaryButton} onClick={() => vm.appendToSql(statements)}>
                            Append to SQL
                        </button>
                    )}
                </div>
                {statements.length > 0 && (
                    <div style={styles.sqlPreview}>
                        {statements.map((stmt, i) => (
                            <div key={i} style={styles.sqlStatement}>
                                <code>{stmt.sql}</code>
                                {stmt.params.length > 0 && (
                                    <span style={styles.sqlParams}>
                                        {" "}-- params: {JSON.stringify(stmt.params)}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
);
