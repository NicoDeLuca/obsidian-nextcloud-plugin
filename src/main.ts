import { Plugin } from "obsidian";
import { ModuleRegistry } from "./core/ModuleRegistry";
import { NextcloudClient } from "./core/NextcloudClient";
import { DEFAULT_SETTINGS, NextcloudSettings } from "./core/types";
import { cookbookModule } from "./modules/cookbook";
import { NextcloudSettingTab } from "./settings";

export default class NextcloudPlugin extends Plugin {
	settings: NextcloudSettings;
	client: NextcloudClient;
	registry: ModuleRegistry;

	async onload() {
		await this.loadSettings();
		this.client = new NextcloudClient(() => this.settings);
		this.registry = new ModuleRegistry(this, [cookbookModule]);
		this.registry.loadEnabled();
		this.addSettingTab(new NextcloudSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, { modules: {} }, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
