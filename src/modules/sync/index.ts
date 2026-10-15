import { ModuleContext, NextcloudModule } from "../../core/types";
import { VaultSync } from "./VaultSync";

const instances = new WeakMap<ModuleContext, VaultSync>();

export const syncModule: NextcloudModule = {
	id: "sync",
	name: "Datei-Sync",
	description: "Gleicht den ganzen Vault mit einem Ordner in deinen Nextcloud-Dateien ab – beim Start und regelmäßig im Hintergrund.",
	// Syncing changes files on both sides, so it has to be switched on deliberately.
	defaultEnabled: false,
	load(ctx) {
		instances.set(ctx, new VaultSync(ctx));
	},
	renderSettings(container, ctx) {
		instances.get(ctx)?.renderSettings(container);
	},
};
