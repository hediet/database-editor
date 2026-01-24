import { derived } from "@vscode/observables";
import { viewWithModel, ViewModel, inject } from "@vscode/observables-react";
import Editor from "@monaco-editor/react";
import { PlaygroundViewModelKey } from "../PlaygroundViewModel";
import { styles } from "../styles";

class SqlEditorViewModel extends ViewModel({
    playground: inject(PlaygroundViewModelKey),
}) {
    readonly sqlContent = derived((reader) => this.props.playground.sqlContent.read(reader));
    readonly error = derived((reader) => this.props.playground.error.read(reader));

    handleSqlChange(value: string): void {
        this.props.playground.sqlContent.set(value, undefined);
    }
}

export const SqlEditorPanel = viewWithModel(SqlEditorViewModel, {}, (reader, vm) => {
    const sql = vm.sqlContent.read(reader);
    const error = vm.error.read(reader);

    return (
        <div style={styles.panelContainer}>
            <div style={styles.editorFill}>
                <Editor
                    height="100%"
                    language="sql"
                    theme="vs-dark"
                    value={sql}
                    onChange={(value) => vm.handleSqlChange(value ?? "")}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                    }}
                />
            </div>
            {error && <div style={styles.error}>{error}</div>}
        </div>
    );
});
