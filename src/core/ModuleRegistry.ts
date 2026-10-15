import { Component, MarkdownRenderChild } from "obsidian";
import type NextcloudPlugin from "../main";
import { BlockDefinition, BlockError, BlockHost, Options, renderBlockMessage } from "./blocks";
import { ModuleContext, NextcloudModule } from "./types";

/**
 * Loads only the enabled modules. Each loaded module is backed by a Component,
 * so disabling it removes its commands, ribbon icons and open views again.
 */
export class ModuleRegistry {
	private loaded = new Map<string, { component: Component; ctx: ModuleContext }>();
	// Obsidian has no public API to unregister a view type, so remember which
	// ones were registered and don't register them twice when re-enabling.
	private registeredViews = new Set<string>();
	// Same for code block processors: registered once, they look up the current definition.
	private blocks = new Map<string, { module: NextcloudModule; block: BlockDefinition | null }>();

	constructor(private plugin: NextcloudPlugin, readonly modules: NextcloudModule[]) {}

	isEnabled(id: string): boolean {
		const enabled = this.plugin.settings.modules[id];
		return enabled ?? this.modules.find((m) => m.id === id)?.defaultEnabled !== false;
	}

	loadEnabled(): void {
		for (const module of this.modules) {
			if (this.isEnabled(module.id)) this.load(module);
		}
	}

	async setEnabled(id: string, enabled: boolean): Promise<void> {
		this.plugin.settings.modules[id] = enabled;
		await this.plugin.saveSettings();
		const module = this.modules.find((m) => m.id === id);
		if (!module) return;
		if (enabled) this.load(module);
		else this.unload(id);
	}

	private load(module: NextcloudModule): void {
		if (this.loaded.has(module.id)) return;
		const plugin = this.plugin;
		const component = plugin.addChild(new Component());
		const ctx: ModuleContext = {
			plugin,
			client: plugin.client,
			registerView: (type, creator) => {
				if (!this.registeredViews.has(type)) {
					plugin.registerView(type, creator);
					this.registeredViews.add(type);
				}
				component.register(() => plugin.app.workspace.detachLeavesOfType(type));
			},
			addCommand: (command) => {
				plugin.addCommand(command);
				component.register(() => plugin.removeCommand(command.id));
			},
			addRibbonIcon: (icon, title, callback) => {
				const el = plugin.addRibbonIcon(icon, title, callback);
				component.register(() => el.remove());
			},
			addStatusBarItem: () => {
				const el = plugin.addStatusBarItem();
				component.register(() => el.remove());
				return el;
			},
			register: (callback) => component.register(callback),
			registerBlock: (block) => {
				if (!this.blocks.has(block.language)) {
					plugin.registerMarkdownCodeBlockProcessor(block.language, (source, el, mctx) => {
						const entry = this.blocks.get(block.language)!;
						const host: BlockHost = { app: plugin.app, addChild: (child) => mctx.addChild(child) };
						if (!entry.block) renderBlockMessage(el, `Das Nextcloud-Modul „${entry.module.name}“ ist ausgeschaltet (Einstellungen → Nextcloud).`);
						else this.renderBlock(entry.block, source, el, host);
					});
				}
				this.blocks.set(block.language, { module, block });
				component.register(() => this.blocks.set(block.language, { module, block: null }));
			},
			exposeApi: (key, api) => {
				plugin.api[key] = api;
				component.register(() => delete plugin.api[key]);
			},
			loadData: <T>() => plugin.settings.moduleData[module.id] as T | undefined,
			saveData: async (data) => {
				plugin.settings.moduleData[module.id] = data;
				await plugin.saveSettings();
			},
		};
		module.load(ctx);
		this.loaded.set(module.id, { component, ctx });
	}

	/** Blocks of the enabled modules. */
	activeBlocks(): BlockDefinition[] {
		return [...this.blocks.values()].flatMap((e) => (e.block ? [e.block] : []));
	}

	/**
	 * Draws a block into `el`. `options` is the YAML text of a code block or an object (from scripts).
	 * Problems with the options are shown inside the block.
	 */
	renderBlock(block: BlockDefinition, options: string | Record<string, unknown> | undefined, el: HTMLElement, host: BlockHost): void {
		let child: MarkdownRenderChild;
		try {
			const parsed = typeof options === "string" ? Options.parse(options) : new Options(options);
			const unknown = parsed.unknownKeys(block.keys);
			if (unknown.length) {
				throw new BlockError(`Unbekannte Option${unknown.length > 1 ? "en" : ""}: ${unknown.join(", ")}. Möglich: ${block.keys.join(", ")}.`);
			}
			child = block.create(el, parsed, host);
		} catch (e) {
			renderBlockMessage(el, e instanceof Error ? e.message : String(e));
			return;
		}
		host.addChild(child);
	}

	/** Lets each enabled module add its own settings below its toggle. */
	renderSettings(module: NextcloudModule, container: HTMLElement): void {
		const loaded = this.loaded.get(module.id);
		if (loaded && module.renderSettings) module.renderSettings(container, loaded.ctx);
	}

	private unload(id: string): void {
		const loaded = this.loaded.get(id);
		if (!loaded) return;
		this.plugin.removeChild(loaded.component);
		this.loaded.delete(id);
	}
}
