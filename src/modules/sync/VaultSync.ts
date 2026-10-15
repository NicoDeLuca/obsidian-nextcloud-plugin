import { moment, Notice, Platform, Setting } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { ModuleContext } from "../../core/types";
import { confirmModal } from "../../core/ui";
import { isIgnored } from "./ignore";
import { LocalVault } from "./LocalVault";
import { SyncEngine, SyncResult, SyncState } from "./SyncEngine";
import { davRoot, WebDavRemote } from "./WebDavRemote";

interface SyncSettings {
	/** Folder in the user's Nextcloud files, e.g. "Obsidian/Notizen". */
	folder: string;
	device: string;
	/** Minutes between automatic syncs; 0 = only at startup. */
	interval: number;
	syncConfig: boolean;
	lastSync?: number;
	lastError?: string;
}

/** Runs the vault sync: at startup, periodically and on demand. */
export class VaultSync {
	settings: SyncSettings;
	private running = false;
	private timer: number | undefined;
	private statusEl: HTMLElement;
	private saving = Promise.resolve();
	/** Called after each run, e.g. to refresh the settings tab. */
	onChange: (() => void) | undefined;

	constructor(private ctx: ModuleContext) {
		this.settings = Object.assign({ folder: "", device: defaultDevice(), interval: 5, syncConfig: true }, ctx.loadData<Partial<SyncSettings>>());
		this.statusEl = ctx.addStatusBarItem();
		this.statusEl.addClass("nc-sync-status");
		this.showStatus();

		ctx.addRibbonIcon("folder-sync", "Mit Nextcloud synchronisieren", () => this.sync(true));
		ctx.addCommand({ id: "sync-now", name: "Dateien jetzt synchronisieren", callback: () => this.sync(true) });

		ctx.plugin.app.workspace.onLayoutReady(() => {
			const startup = window.setTimeout(() => this.sync(false), 3000);
			ctx.register(() => window.clearTimeout(startup));
		});
		this.schedule();
		ctx.register(() => window.clearInterval(this.timer));
	}

	schedule(): void {
		window.clearInterval(this.timer);
		this.timer = this.settings.interval > 0 ? window.setInterval(() => this.sync(false), this.settings.interval * 60_000) : undefined;
	}

	async saveSettings(): Promise<void> {
		await this.ctx.saveData(this.settings);
	}

	/** @param manual started by the user: report the outcome and ask before deleting many files */
	async sync(manual: boolean, allowMassDeletion = false): Promise<void> {
		const notify = (message: string) => manual && new Notice(message);
		if (!this.ctx.client.isConfigured) return void notify("Die Nextcloud-Verbindung ist noch nicht eingerichtet.");
		if (!this.settings.folder) return void notify("Bitte zuerst in den Einstellungen den Nextcloud-Ordner für den Sync festlegen.");
		if (this.running) return void notify("Die Synchronisierung läuft bereits.");

		this.running = true;
		this.statusEl.setText("Sync läuft …");
		const failedBefore = !!this.settings.lastError;
		let blocked: number | undefined;
		try {
			const result = await this.run(allowMassDeletion);
			blocked = result.blocked;
			if (blocked) {
				this.settings.lastError = `Angehalten, weil ${blocked} Dateien gelöscht würden.`;
			} else {
				this.settings.lastSync = Date.now();
				this.settings.lastError = result.errors.length
					? `${result.errors.length} Datei(en) fehlgeschlagen: ` + result.errors.slice(0, 3).map((e) => `${e.path} (${e.message})`).join(", ")
					: undefined;
				this.report(result, manual);
			}
		} catch (e) {
			this.settings.lastError = errorMessage(e);
			// Automatic runs only report the first failure, not every one while offline.
			if (manual || !failedBefore) new Notice(`Nextcloud-Sync fehlgeschlagen: ${errorMessage(e)}`);
		} finally {
			this.running = false;
			await this.saveSettings();
			this.showStatus();
			this.onChange?.();
		}

		if (blocked) {
			const message = `Der Sync würde ${blocked} Dateien löschen, weil sie auf der anderen Seite fehlen.`;
			if (!manual) {
				if (!failedBefore) new Notice(`${message} Er wurde angehalten – bitte „Dateien jetzt synchronisieren“ ausführen und bestätigen.`, 15_000);
			} else if (await confirmModal(this.ctx.plugin.app, "Viele Dateien löschen?", `${message} Gelöschte Dateien landen im Papierkorb (.trash bzw. Nextcloud-Papierkorb).`, "Löschen und synchronisieren")) {
				await this.sync(true, true);
			}
		}
	}

	private async run(allowMassDeletion: boolean): Promise<SyncResult> {
		const app = this.ctx.plugin.app;
		const { id } = await this.ctx.client.getCurrentUser();
		const root = davRoot(id, this.settings.folder);
		const engine = new SyncEngine(new LocalVault(app), new WebDavRemote(this.ctx.client, root), this.ctx.client.baseUrl + root);
		const configDir = app.vault.configDir;
		const ignore = { configDir, syncConfig: this.settings.syncConfig, pluginDir: this.pluginDir() };
		const { result, state } = await engine.run(await this.loadState(), {
			device: this.settings.device || defaultDevice(),
			allowMassDeletion,
			ignored: (path) => isIgnored(path, ignore),
			keepNewer: (path) => path.startsWith(configDir + "/"),
			checkpoint: (s) => this.saveState(s),
		});
		await this.saveState(state);
		return result;
	}

	private report(result: SyncResult, manual: boolean): void {
		const parts = [];
		if (result.uploaded) parts.push(`${result.uploaded} hochgeladen`);
		if (result.downloaded) parts.push(`${result.downloaded} heruntergeladen`);
		if (result.deleted) parts.push(`${result.deleted} gelöscht`);
		if (manual) new Notice(parts.length ? `Sync fertig: ${parts.join(", ")}.` : "Alles ist synchron.");
		if (result.conflicts.length) {
			new Notice(`Sync-Konflikt – beide Versionen behalten. Deine Version liegt jetzt unter:\n${result.conflicts.join("\n")}`, 15_000);
		}
		if (result.errors.length) new Notice(`Sync: ${this.settings.lastError}`, 10_000);
	}

	/** Short status for the status bar and the settings. */
	statusText(): string {
		const { lastSync, lastError } = this.settings;
		const time = lastSync ? `Zuletzt synchronisiert: ${moment(lastSync).format("DD.MM.YYYY, HH:mm")}.` : "Noch nie synchronisiert.";
		return lastError ? `${time} Fehler: ${lastError}` : time;
	}

	private showStatus(): void {
		const { lastSync, lastError } = this.settings;
		this.statusEl.setText(lastError ? "Sync ⚠" : lastSync ? `Sync ${moment(lastSync).format("HH:mm")}` : "");
		this.statusEl.setAttr("title", this.statusText());
	}

	private pluginDir(): string {
		const { manifest, app } = this.ctx.plugin;
		return manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`;
	}

	/** The state lives next to the plugin (not in data.json), as it can get large and is per device. */
	private async loadState(): Promise<SyncState | null> {
		const adapter = this.ctx.plugin.app.vault.adapter;
		const path = `${this.pluginDir()}/sync-state.json`;
		try {
			return (await adapter.exists(path)) ? (JSON.parse(await adapter.read(path)) as SyncState) : null;
		} catch {
			return null;
		}
	}

	private saveState(state: SyncState): Promise<void> {
		const adapter = this.ctx.plugin.app.vault.adapter;
		const path = `${this.pluginDir()}/sync-state.json`;
		this.saving = this.saving.then(() => adapter.write(path, JSON.stringify(state)));
		return this.saving;
	}

	renderSettings(container: HTMLElement): void {
		const app = this.ctx.plugin.app;
		const plugins = (app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
		if (plugins?.enabledPlugins?.has("remotely-save")) {
			container.createEl("p", {
				cls: "mod-warning",
				text: "Remotely Save ist in diesem Vault noch aktiv. Bitte deaktivieren, bevor beide denselben Nextcloud-Ordner synchronisieren.",
			});
		}

		new Setting(container)
			.setName("Nextcloud-Ordner")
			.setDesc("Ordner in deinen Nextcloud-Dateien, mit dem der ganze Vault abgeglichen wird, z. B. Obsidian/Notizen. Er wird angelegt, falls er fehlt.")
			.addText((text) => {
				text.setPlaceholder("Obsidian/Notizen").setValue(this.settings.folder);
				// Applied when leaving the field, so a sync never runs against a half-typed folder name.
				text.inputEl.addEventListener("change", async () => {
					this.settings.folder = text.getValue().trim().replace(/^\/+|\/+$/g, "");
					await this.saveSettings();
				});
			});

		new Setting(container)
			.setName("Gerätename")
			.setDesc("Steht im Namen von Konfliktkopien, z. B. „Idee (Konflikt iPhone 2026-10-15 1430).md“.")
			.addText((text) =>
				text.setValue(this.settings.device).onChange(async (value) => {
					this.settings.device = value.trim();
					await this.saveSettings();
				})
			);

		new Setting(container)
			.setName("Automatisch synchronisieren")
			.setDesc("Beim Start von Obsidian und dann im gewählten Abstand.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ "0": "Nur beim Start", "1": "Jede Minute", "5": "Alle 5 Minuten", "15": "Alle 15 Minuten", "30": "Alle 30 Minuten", "60": "Jede Stunde" })
					.setValue(String(this.settings.interval))
					.onChange(async (value) => {
						this.settings.interval = Number(value);
						await this.saveSettings();
						this.schedule();
					})
			);

		new Setting(container)
			.setName("Obsidian-Einstellungen mitsynchronisieren")
			.setDesc(`Den Ordner ${app.vault.configDir} (Plugins, Designs, Tastenkürzel …), ohne die geöffneten Tabs und ohne dieses Plugin. Bei Konflikten gewinnt dort die neuere Version.`)
			.addToggle((toggle) =>
				toggle.setValue(this.settings.syncConfig).onChange(async (value) => {
					this.settings.syncConfig = value;
					await this.saveSettings();
				})
			);

		const status = new Setting(container)
			.setName("Jetzt synchronisieren")
			.setDesc(this.statusText())
			.addButton((button) =>
				button.setButtonText("Synchronisieren").onClick(async () => {
					button.setDisabled(true);
					await this.sync(true);
					button.setDisabled(false);
				})
			);
		this.onChange = () => status.setDesc(this.statusText());
	}
}

function defaultDevice(): string {
	if (Platform.isIosApp) return Platform.isTablet ? "iPad" : "iPhone";
	if (Platform.isAndroidApp) return "Android";
	if (Platform.isMacOS) return "Mac";
	if (Platform.isWin) return "Windows";
	if (Platform.isLinux) return "Linux";
	return "Gerät";
}
