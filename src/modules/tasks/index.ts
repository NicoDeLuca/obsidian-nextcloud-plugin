import { App } from "obsidian";
import { NextcloudModule } from "../../core/types";
import { TasksApi } from "./TasksApi";
import { TASKS_VIEW, TasksView } from "./TasksView";

export const tasksModule: NextcloudModule = {
	id: "tasks",
	name: "Tasks",
	description: "View, add, complete and edit tasks from Nextcloud Tasks (CalDAV).",
	load(ctx) {
		const app = ctx.plugin.app;
		const api = new TasksApi(ctx.client);

		ctx.registerView(TASKS_VIEW, (leaf) => new TasksView(leaf, api));
		ctx.addRibbonIcon("list-checks", "Open tasks", () => openTasks(app));
		ctx.addCommand({
			id: "tasks-open",
			name: "Open tasks",
			callback: () => openTasks(app),
		});
	},
};

async function openTasks(app: App) {
	const existing = app.workspace.getLeavesOfType(TASKS_VIEW)[0];
	const leaf = existing ?? app.workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: TASKS_VIEW, active: true });
	await app.workspace.revealLeaf(leaf);
}
