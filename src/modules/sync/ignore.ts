export interface IgnoreOptions {
	/** The vault's config folder, usually ".obsidian". */
	configDir: string;
	/** Whether to sync the config folder at all. */
	syncConfig: boolean;
	/** This plugin's folder: its data.json holds the credentials and the device's sync state. */
	pluginDir: string;
}

const NEVER = new Set([".git", "node_modules", ".DS_Store", "Thumbs.db", "desktop.ini"]);

/** Whether a path (file or folder, relative to the vault/sync folder) stays out of the sync, on both sides. */
export function isIgnored(path: string, options: IgnoreOptions): boolean {
	const segments = path.split("/");
	const first = segments[0];
	if (segments.some((s) => NEVER.has(s))) return true;
	if (first === ".trash") return true;
	if (segments.length === 1 && first.startsWith("_remotely-save-metadata")) return true;
	// Obsidian doesn't see hidden files inside normal folders, so they can't be synced reliably.
	if (!first.startsWith(".") && segments.some((s) => s.startsWith("."))) return true;

	const { configDir, pluginDir } = options;
	if (first === configDir) {
		if (!options.syncConfig) return true;
		// Open tabs and panes are per device.
		if (path === `${configDir}/workspace.json` || path === `${configDir}/workspace-mobile.json`) return true;
		const inside = (folder: string) => path === folder || path.startsWith(folder + "/");
		if (inside(pluginDir) || inside(`${configDir}/plugins/remotely-save`)) return true;
	}
	return false;
}
