import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { errorMessage } from "./core/NextcloudClient";
import type NextcloudPlugin from "./main";

export class NextcloudSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: NextcloudPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Verbindung").setHeading();

		new Setting(containerEl)
			.setName("Nextcloud URL")
			.setDesc("z. B. https://cloud.example.de")
			.addText((text) =>
				text
					.setPlaceholder("https://cloud.example.de")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Benutzername").addText((text) =>
			text.setValue(this.plugin.settings.username).onChange(async (value) => {
				this.plugin.settings.username = value.trim();
				await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl)
			.setName("App-Passwort")
			.setDesc(
				"Erstellen in Nextcloud unter Einstellungen → Sicherheit → Geräte & Sitzungen. Es wird unverschlüsselt in der data.json dieses Plugins im Ordner .obsidian gespeichert – den .obsidian-Ordner daher nicht in ein öffentliches Git-Repository oder einen fremden Sync geben."
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(this.plugin.settings.appPassword).onChange(async (value) => {
					this.plugin.settings.appPassword = value.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName("Verbindung testen").addButton((button) =>
			button.setButtonText("Testen").onClick(async () => {
				button.setDisabled(true);
				try {
					const name = await this.plugin.client.testConnection();
					new Notice(`Verbunden mit Nextcloud als ${name}.`);
				} catch (e) {
					new Notice(`Verbindung fehlgeschlagen: ${errorMessage(e)}`);
				} finally {
					button.setDisabled(false);
				}
			})
		);

		new Setting(containerEl).setName("Module").setHeading();

		for (const module of this.plugin.registry.modules) {
			new Setting(containerEl)
				.setName(module.name)
				.setDesc(module.description)
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.registry.isEnabled(module.id)).onChange(async (value) => {
						await this.plugin.registry.setEnabled(module.id, value);
						this.display(); // show or hide the module's own settings
					})
				);
			const moduleSettings = containerEl.createDiv({ cls: "nc-module-settings" });
			this.plugin.registry.renderSettings(module, moduleSettings);
		}
	}
}
