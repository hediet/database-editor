import { derived } from "@vscode/observables";
import {
	viewWithModel, ViewModel,
	DIContainer,
	DIProvider,
} from "@vscode/observables-react";
import {
	GoldenLayout,
	LayoutConfig,
	ComponentContainer,
} from "golden-layout";
import React from "react";
import ReactDOM from "react-dom/client";

import { PlaygroundViewModel, PlaygroundViewModelKey } from "./PlaygroundViewModel";
import { SqlEditorPanel } from "./panels/SqlEditorPanel";
import { JsonDiffPanel } from "./panels/JsonDiffPanel";
import { MermaidPanel } from "./panels/MermaidPanel";
import { SchemaPanel } from "./panels/SchemaPanel";
import { styles } from "./styles";

// === App ===

class AppViewModel extends ViewModel({}) {
	private _layout: GoldenLayout | null = null;
	private _layoutElement: HTMLElement | null = null;
	private readonly _componentRoots = new Map<HTMLElement, ReactDOM.Root>();
	private readonly _container: DIContainer;
	private readonly _playground: PlaygroundViewModel;
	private readonly _resizeHandler = (): void => {
		if (this._layout && this._layoutElement) {
			this._layout.setSize(this._layoutElement.offsetWidth, this._layoutElement.offsetHeight);
		}
	};

	constructor() {
		super({});

		this._playground = new PlaygroundViewModel();
		this._container = new DIContainer();
		this._container.register(PlaygroundViewModelKey, this._playground);

		// Initialize URL state loading (runs async)
		this._playground.initialize();

		window.addEventListener("resize", this._resizeHandler);
	}

	readonly initializeLayout = (element: HTMLElement | null): void => {
		if (!element || this._layout) return;

		this._layoutElement = element;

		const config: LayoutConfig = {
			root: {
				type: "row",
				content: [
					{
						type: "column",
						width: 40,
						content: [
							{
								type: "component",
								componentType: "SqlEditor",
								title: "Database",
							},
						],
					},
					{
						type: "column",
						width: 60,
						content: [
							{
								type: "stack",
								content: [
									{
										type: "component",
										componentType: "JsonDiffPanel",
										title: "JSON Dump",
									},
									{
										type: "component",
										componentType: "MermaidPanel",
										title: "ER Diagram",
									},
									{
										type: "component",
										componentType: "SchemaPanel",
										title: "JSON Schema",
									},
								],
							},
						],
					},
				],
			},
		};

		this._layout = new GoldenLayout(element);

		this._layout.registerComponentFactoryFunction("SqlEditor", (container) => {
			this._mountComponent(container, <SqlEditorPanel />);
		});

		this._layout.registerComponentFactoryFunction("JsonDiffPanel", (container) => {
			this._mountComponent(container, <JsonDiffPanel />);
		});

		this._layout.registerComponentFactoryFunction("MermaidPanel", (container) => {
			this._mountComponent(container, <MermaidPanel />);
		});

		this._layout.registerComponentFactoryFunction("SchemaPanel", (container) => {
			this._mountComponent(container, <SchemaPanel />);
		});

		this._layout.loadLayout(config);
	};

	private _mountComponent(container: ComponentContainer, component: React.ReactNode): void {
		const el = container.element;
		const root = ReactDOM.createRoot(el);
		this._componentRoots.set(el, root);

		root.render(
			<DIProvider container={this._container}>
				{component}
			</DIProvider>
		);

		container.addEventListener("beforeComponentRelease", () => {
			const r = this._componentRoots.get(el);
			if (r) {
				r.unmount();
				this._componentRoots.delete(el);
			}
		});
	}

	readonly isExecuting = derived((reader) => this._playground.isExecuting.read(reader));

	override dispose(): void {
		window.removeEventListener("resize", this._resizeHandler);
		for (const root of this._componentRoots.values()) {
			root.unmount();
		}
		this._componentRoots.clear();
		this._layout?.destroy();
		this._layout = null;
		this._layoutElement = null;
		this._playground.dispose();
		super.dispose();
	}
}

const App = viewWithModel(
	AppViewModel,
	{},
	(reader, vm) => {
		const isExecuting = vm.isExecuting.read(reader);

		return (
			<div style={styles.container}>
				<header style={styles.header}>
					<div style={styles.headerLeft}>
						<h1 style={styles.title}>JSON Database Editor Playground</h1>
						{isExecuting && <span style={styles.status}>Executing...</span>}
					</div>
					<div style={styles.headerRight}>
						<div className="star-button-wrapper" style={styles.starButtonWrapper}>
							<a
								className="star-button"
								href="https://github.com/hediet/json-database-editor"
								target="_blank"
								rel="noopener noreferrer"
								style={styles.starButton}
							>
								⭐ Star on GitHub
							</a>
							<div className="tooltip" style={styles.tooltip}>
								<div style={styles.tooltipTitle}>Playground Powered By</div>
								<a className="tooltip-link" href="https://golden-layout.com/" target="_blank" rel="noopener noreferrer" style={styles.tooltipLink}>
									Golden Layout
								</a>
								<a className="tooltip-link" href="https://microsoft.github.io/monaco-editor/" target="_blank" rel="noopener noreferrer" style={styles.tooltipLink}>
									Monaco Editor
								</a>
							</div>
						</div>
					</div>
				</header>
				<div ref={vm.initializeLayout} style={styles.layoutContainer} />
			</div>
		);
	}
);

export { App };
