import { Plugin } from "obsidian";
import { NextcloudClient } from "./core/NextcloudClient";
import { DEFAULT_SETTINGS, NextcloudSettings } from "./core/types";
import { NextcloudSettingTab } from "./settings";

export default class NextcloudPlugin extends Plugin {
	settings: NextcloudSettings;
	client: NextcloudClient;

	async onload() {
		await this.loadSettings();
		this.client = new NextcloudClient(() => this.settings);
		this.addSettingTab(new NextcloudSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
