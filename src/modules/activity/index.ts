import { App } from "obsidian";
import { NextcloudModule } from "../../core/types";
import { ActivityApi } from "./ActivityApi";
import { ACTIVITY_VIEW, ActivityView } from "./ActivityView";

export const activityModule: NextcloudModule = {
	id: "activity",
	name: "Aktivität",
	description: "Die Nextcloud-Aktivitäten: was sich in Dateien, Kalendern, Freigaben usw. geändert hat.",
	load(ctx) {
		const app = ctx.plugin.app;
		const api = new ActivityApi(ctx.client);

		ctx.registerView(ACTIVITY_VIEW, (leaf) => new ActivityView(leaf, api));
		ctx.addRibbonIcon("activity", "Nextcloud-Aktivitäten öffnen", () => openActivity(app));
		ctx.addCommand({
			id: "activity-open",
			name: "Aktivitäten öffnen",
			callback: () => openActivity(app),
		});
	},
};

async function openActivity(app: App) {
	const existing = app.workspace.getLeavesOfType(ACTIVITY_VIEW)[0];
	const leaf = existing ?? app.workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: ACTIVITY_VIEW, active: true });
	await app.workspace.revealLeaf(leaf);
}
