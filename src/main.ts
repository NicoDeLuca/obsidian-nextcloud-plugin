import { Component, MarkdownRenderChild, Notice, Plugin } from "obsidian";
import { blockMarkdown, BlockSuggestModal, renderBlockMessage } from "./core/blocks";
import { ModuleRegistry } from "./core/ModuleRegistry";
import { NextcloudClient } from "./core/NextcloudClient";
import { DEFAULT_SETTINGS, NextcloudSettings } from "./core/types";
import { activityModule } from "./modules/activity";
import { calendarModule } from "./modules/calendar";
import { cookbookModule } from "./modules/cookbook";
import { deckModule } from "./modules/deck";
import { syncModule } from "./modules/sync";
import { tasksModule } from "./modules/tasks";
import { zeiterfassungModule } from "./modules/zeiterfassung";
import { NextcloudSettingTab } from "./settings";

export default class NextcloudPlugin extends Plugin {
	settings: NextcloudSettings;
	client: NextcloudClient;
	registry: ModuleRegistry;
	/**
	 * For other plugins and scripts (DataviewJS, Templater):
	 * `app.plugins.plugins["obsidian-nextcloud-plugin"].api`. Enabled modules add their functions
	 * (e.g. `api.tasks`); `api.render` draws any block into an element.
	 */
	api: Record<string, unknown> = {
		version: 1,
		render: (el: HTMLElement, block: string, options?: string | Record<string, unknown>, component?: Component) => this.renderBlock(el, block, options, component),
	};

	async onload() {
		await this.loadSettings();
		this.client = new NextcloudClient(() => this.settings);
		this.registry = new ModuleRegistry(this, [cookbookModule, calendarModule, tasksModule, deckModule, activityModule, syncModule, zeiterfassungModule]);
		this.registry.loadEnabled();
		this.addSettingTab(new NextcloudSettingTab(this.app, this));
		this.addCommand({
			id: "insert-block",
			name: "Nextcloud-Block einfügen",
			editorCallback: (editor) => {
				const blocks = this.registry.activeBlocks();
				if (!blocks.length) {
					new Notice("Es ist kein Nextcloud-Modul mit Blöcken eingeschaltet (Einstellungen → Nextcloud).");
					return;
				}
				new BlockSuggestModal(this.app, blocks, (block) => editor.replaceSelection(blockMarkdown(block))).open();
			},
		});
	}

	/**
	 * `api.render`: draws a block (e.g. "aufgaben" or "nextcloud-aufgaben") into `el`. Pass the
	 * caller's component (DataviewJS: `dv.component`) so the block stops updating when it goes away.
	 */
	private renderBlock(el: HTMLElement, name: string, options?: string | Record<string, unknown>, component?: Component): void {
		const language = name.startsWith("nextcloud-") ? name : `nextcloud-${name}`;
		const block = this.registry.activeBlocks().find((b) => b.language === language);
		if (!block) {
			renderBlockMessage(el, `Unbekannter oder ausgeschalteter Nextcloud-Block: ${name}`);
			return;
		}
		const owner = component ?? this;
		this.registry.renderBlock(block, options, el, {
			app: this.app,
			addChild: (child: MarkdownRenderChild) => owner.addChild(child),
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, { modules: {}, moduleData: {} }, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
