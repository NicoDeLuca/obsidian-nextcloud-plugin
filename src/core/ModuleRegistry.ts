import { Component } from "obsidian";
import type NextcloudPlugin from "../main";
import { ModuleContext, NextcloudModule } from "./types";

/**
 * Loads only the enabled modules. Each loaded module is backed by a Component,
 * so disabling it removes its commands, ribbon icons and open views again.
 */
export class ModuleRegistry {
	private loaded = new Map<string, Component>();
	// Obsidian has no public API to unregister a view type, so remember which
	// ones were registered and don't register them twice when re-enabling.
	private registeredViews = new Set<string>();

	constructor(private plugin: NextcloudPlugin, readonly modules: NextcloudModule[]) {}

	isEnabled(id: string): boolean {
		return this.plugin.settings.modules[id] !== false;
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
			loadData: <T>() => plugin.settings.moduleData[module.id] as T | undefined,
			saveData: async (data) => {
				plugin.settings.moduleData[module.id] = data;
				await plugin.saveSettings();
			},
		};
		module.load(ctx);
		this.loaded.set(module.id, component);
	}

	private unload(id: string): void {
		const component = this.loaded.get(id);
		if (!component) return;
		this.plugin.removeChild(component);
		this.loaded.delete(id);
	}
}
