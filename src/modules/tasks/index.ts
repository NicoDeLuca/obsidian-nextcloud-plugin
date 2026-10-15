import { App } from "obsidian";
import { NextcloudModule } from "../../core/types";
import { tasksApi } from "./api";
import { tasksBlock } from "./TasksBlock";
import { TasksApi } from "./TasksApi";
import { TASKS_VIEW, TasksView } from "./TasksView";

export const tasksModule: NextcloudModule = {
	id: "tasks",
	name: "Aufgaben",
	description: "Aufgaben aus Nextcloud Tasks ansehen, anlegen, abhaken und bearbeiten (CalDAV).",
	load(ctx) {
		const app = ctx.plugin.app;
		const api = new TasksApi(ctx.client);

		ctx.registerView(TASKS_VIEW, (leaf) => new TasksView(leaf, api));
		ctx.addRibbonIcon("list-checks", "Aufgaben öffnen", () => openTasks(app));
		ctx.addCommand({
			id: "tasks-open",
			name: "Aufgaben öffnen",
			callback: () => openTasks(app),
		});
		ctx.registerBlock(tasksBlock(api));
		ctx.exposeApi("tasks", tasksApi(api));
	},
};

async function openTasks(app: App) {
	const existing = app.workspace.getLeavesOfType(TASKS_VIEW)[0];
	const leaf = existing ?? app.workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: TASKS_VIEW, active: true });
	await app.workspace.revealLeaf(leaf);
}
