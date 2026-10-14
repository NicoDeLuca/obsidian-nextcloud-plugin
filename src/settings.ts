import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type NextcloudPlugin from "./main";

export class NextcloudSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: NextcloudPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Connection").setHeading();

		new Setting(containerEl)
			.setName("Nextcloud URL")
			.setDesc("e.g. https://cloud.example.de")
			.addText((text) =>
				text
					.setPlaceholder("https://cloud.example.de")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Username").addText((text) =>
			text.setValue(this.plugin.settings.username).onChange(async (value) => {
				this.plugin.settings.username = value.trim();
				await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl)
			.setName("App password")
			.setDesc("Create one in Nextcloud under Settings → Security → Devices & sessions.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(this.plugin.settings.appPassword).onChange(async (value) => {
					this.plugin.settings.appPassword = value.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName("Test connection").addButton((button) =>
			button.setButtonText("Test").onClick(async () => {
				button.setDisabled(true);
				try {
					const name = await this.plugin.client.testConnection();
					new Notice(`Connected to Nextcloud as ${name}.`);
				} catch (e) {
					new Notice(`Connection failed: ${errorMessage(e)}`);
				} finally {
					button.setDisabled(false);
				}
			})
		);

		new Setting(containerEl).setName("Modules").setHeading();

		for (const module of this.plugin.registry.modules) {
			new Setting(containerEl)
				.setName(module.name)
				.setDesc(module.description)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.registry.isEnabled(module.id))
						.onChange((value) => this.plugin.registry.setEnabled(module.id, value))
				);
		}
	}
}

export function errorMessage(e: unknown): string {
	if (e && typeof e === "object" && "status" in e) return `HTTP ${(e as { status: number }).status}`;
	return e instanceof Error ? e.message : String(e);
}
