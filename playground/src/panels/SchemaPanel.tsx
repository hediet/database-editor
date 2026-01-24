import { derived } from "@vscode/observables";
import { viewWithModel, ViewModel, inject } from "@vscode/observables-react";
import Editor from "@monaco-editor/react";
import { PlaygroundViewModelKey } from "../PlaygroundViewModel";
import { styles } from "../styles";

class SchemaPanelViewModel extends ViewModel({
    playground: inject(PlaygroundViewModelKey),
}) {
    readonly schemaJson = derived((reader) => {
        const state = this.props.playground.databaseState.read(reader);
        if (!state) return "";
        return JSON.stringify(state.jsonSchema, null, 2);
    });

    readonly hasData = derived((reader) => {
        return this.props.playground.databaseState.read(reader) !== null;
    });

    readonly cliCommand = derived((reader) => this.props.playground.cliJsonSchemaCommand.read(reader));
}

export const SchemaPanel = viewWithModel(
    SchemaPanelViewModel,
    {},
    (reader, vm) => {
        const schemaJson = vm.schemaJson.read(reader);
        const hasData = vm.hasData.read(reader);
        const cliCommand = vm.cliCommand.read(reader);

        if (!hasData) {
            return <div style={styles.placeholder}>Execute SQL to see the JSON Schema</div>;
        }

        return (
            <div style={styles.panelContainer}>
                <div style={styles.cliCommandBar}>
                    <code style={styles.cliCode}>{cliCommand}</code>
                </div>
                <div style={styles.editorFill}>
                    <Editor
                        height="100%"
                        language="json"
                        theme="vs-dark"
                        value={schemaJson}
                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            fontSize: 13,
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                        }}
                    />
                </div>
            </div>
        );
    }
);
