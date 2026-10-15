import { ButtonComponent, DropdownComponent, ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { DavCalendar } from "../../core/CalDav";
import { errorMessage } from "../../core/NextcloudClient";
import { loadTasks, renderQuickAdd, renderTasks, TaskActions } from "./TaskList";
import { TasksApi } from "./TasksApi";
import { Task } from "./vtodo";

export const TASKS_VIEW = "nextcloud-tasks";

/** "today", "all", or the path of one list. */
type Filter = string;

interface TasksViewState {
	filter?: Filter;
	showCompleted?: boolean;
}

export class TasksView extends ItemView {
	private filter: Filter = "all";
	private showCompleted = false;
	private lists: DavCalendar[] | null = null;
	private loadId = 0;
	private toolbarEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private actions: TaskActions;

	constructor(leaf: WorkspaceLeaf, private api: TasksApi) {
		super(leaf);
		this.actions = new TaskActions(this.app, api, () => this.loadTasks());
	}

	getViewType() {
		return TASKS_VIEW;
	}

	getDisplayText() {
		return "Aufgaben";
	}

	getIcon() {
		return "list-checks";
	}

	getState(): Record<string, unknown> {
		return { filter: this.filter, showCompleted: this.showCompleted };
	}

	async setState(state: unknown, result: ViewStateResult) {
		const { filter, showCompleted } = (state ?? {}) as TasksViewState;
		if (filter) this.filter = filter;
		if (showCompleted !== undefined) this.showCompleted = showCompleted;
		await super.setState(state, result);
		await this.loadTasks(true);
	}

	async onOpen() {
		this.contentEl.addClass("nc-tasks");
		this.toolbarEl = this.contentEl.createDiv({ cls: "nc-cal-toolbar" });
		this.bodyEl = this.contentEl.createDiv({ cls: "nc-tasks-body" });
		await this.loadTasks(true);
	}

	async reload() {
		this.lists = null;
		await this.loadTasks(true);
	}

	private changed() {
		this.app.workspace.requestSaveLayout();
		this.loadTasks(true);
	}

	/**
	 * @param withToolbar also rebuild the toolbar; skipped after editing tasks so the
	 *   quick-add field keeps its focus for entering several tasks in a row.
	 */
	private async loadTasks(withToolbar = false) {
		if (!this.bodyEl) return; // setState can run before onOpen
		const loadId = ++this.loadId;
		this.bodyEl.empty();
		this.bodyEl.createEl("p", { text: "Wird geladen …", cls: "nc-cookbook-status" });

		let tasks: Task[];
		try {
			if (!this.lists) this.lists = await this.api.listLists();
			if (loadId !== this.loadId) return;
			if (this.filter !== "today" && this.filter !== "all" && !this.lists.some((l) => l.path === this.filter)) this.filter = "all";
			if (withToolbar) this.renderToolbar();

			const lists = this.lists.filter((l) => this.filter === "today" || this.filter === "all" || l.path === this.filter);
			tasks = await loadTasks(this.api, lists, { completed: this.showCompleted, today: this.filter === "today" }, () => loadId === this.loadId);
		} catch (e) {
			if (loadId !== this.loadId) return;
			this.bodyEl.empty();
			this.bodyEl.createEl("p", { text: `Aufgabenlisten konnten nicht geladen werden: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
			return;
		}
		if (loadId !== this.loadId) return;

		this.bodyEl.empty();
		renderTasks(this.bodyEl, tasks, this.actions, {
			showList: this.filter === "today" || this.filter === "all",
			empty: this.filter === "today" ? "Heute ist nichts fällig." : "Keine Aufgaben.",
		});
	}

	private renderToolbar() {
		const bar = this.toolbarEl;
		bar.empty();
		const dropdown = new DropdownComponent(bar).addOption("today", "Heute").addOption("all", "Alle Listen");
		for (const list of this.lists ?? []) dropdown.addOption(list.path, list.name);
		dropdown.setValue(this.filter).onChange((filter) => {
			this.filter = filter;
			this.changed();
		});

		const actions = bar.createDiv({ cls: "nc-cal-toolbar-group" });
		const toggle = new ButtonComponent(actions)
			.setIcon("check-check")
			.setTooltip(this.showCompleted ? "Erledigte ausblenden" : "Erledigte anzeigen")
			.onClick(() => {
				this.showCompleted = !this.showCompleted;
				this.changed();
			});
		toggle.buttonEl.toggleClass("is-active", this.showCompleted);
		new ButtonComponent(actions).setIcon("refresh-cw").setTooltip("Neu laden").onClick(() => this.reload());

		const target = this.targetList();
		if (target) renderQuickAdd(bar, target, (title) => this.actions.create(target, title, this.filter === "today"));
	}

	/** Where quick-add puts new tasks: the selected list, or the first writable one. */
	private targetList(): DavCalendar | undefined {
		const writable = (this.lists ?? []).filter((l) => !l.readOnly);
		return writable.find((l) => l.path === this.filter) ?? writable[0];
	}
}
