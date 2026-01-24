import { derived, observableValue, autorun } from "@vscode/observables";
import { viewWithModel, ViewModel, inject } from "@vscode/observables-react";
import mermaid from "mermaid";
import { PlaygroundViewModelKey, PlaygroundViewModel } from "../PlaygroundViewModel";
import { styles } from "../styles";

let mermaidIdCounter = 0;

async function renderMermaid(diagram: string): Promise<string> {
    mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
    });

    try {
        const { svg } = await mermaid.render(`mermaid-diagram-${mermaidIdCounter++}`, diagram);
        return svg;
    } catch (e) {
        return `<pre style="color: #f66;">Error rendering diagram: ${e}</pre>`;
    }
}

class MermaidPanelViewModel extends ViewModel({
    playground: inject(PlaygroundViewModelKey),
}) {
    readonly renderedSvg = observableValue<string>("renderedSvg", "");

    constructor(props: { playground: PlaygroundViewModel }) {
        super(props);

        this._store.add(
            autorun(async (reader) => {
                const state = this.props.playground.databaseState.read(reader);
                if (state?.mermaid) {
                    const svg = await renderMermaid(state.mermaid);
                    this.renderedSvg.set(svg, undefined);
                } else {
                    this.renderedSvg.set("", undefined);
                }
            })
        );
    }

    readonly mermaidSource = derived((reader) => {
        const state = this.props.playground.databaseState.read(reader);
        return state?.mermaid ?? "";
    });

    readonly hasData = derived((reader) => {
        return this.props.playground.databaseState.read(reader) !== null;
    });

    readonly cliCommand = derived((reader) => this.props.playground.cliMermaidCommand.read(reader));
}

export const MermaidPanel = viewWithModel(
    MermaidPanelViewModel,
    {},
    (reader, vm) => {
        const svg = vm.renderedSvg.read(reader);
        const hasData = vm.hasData.read(reader);
        const cliCommand = vm.cliCommand.read(reader);

        if (!hasData) {
            return <div style={styles.placeholder}>Execute SQL to see the ER diagram</div>;
        }

        return (
            <div style={styles.mermaidContainer}>
                <div style={styles.cliCommandBar}>
                    <code style={styles.cliCode}>{cliCommand}</code>
                </div>
                <div style={styles.mermaidDiagram} dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
        );
    }
);
