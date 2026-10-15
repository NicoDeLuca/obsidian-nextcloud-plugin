import { ButtonComponent, DropdownComponent, ItemView, moment, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { DavCalendar, isConflict } from "../../core/CalDav";
import { errorMessage } from "../../core/NextcloudClient";
import { confirmModal } from "../../core/ui";
import { formatDue, isOverdue, priorityBucket, TaskModal } from "./TaskModal";
import { TasksApi } from "./TasksApi";
import { completeRecurringIcs, createTaskIcs, RuleChoice, setCompletedIcs, Task, TaskDraft, updateTaskIcs } from "./vtodo";

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

	constructor(leaf: WorkspaceLeaf, private api: TasksApi) {
		super(leaf);
	}

	getViewType() {
		return TASKS_VIEW;
	}

	getDisplayText() {
		return "Tasks";
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
		this.bodyEl.createEl("p", { text: "Loading…", cls: "nc-cookbook-status" });

		let tasks: Task[] = [];
		try {
			if (!this.lists) this.lists = await this.api.listLists();
			if (loadId !== this.loadId) return;
			if (this.filter !== "today" && this.filter !== "all" && !this.lists.some((l) => l.path === this.filter)) this.filter = "all";
			if (withToolbar) this.renderToolbar();

			const lists = this.lists.filter((l) => this.filter === "today" || this.filter === "all" || l.path === this.filter);
			const results = await Promise.allSettled(lists.map((l) => this.api.getTasks(l, this.showCompleted)));
			results.forEach((r, i) => {
				if (r.status === "fulfilled") tasks.push(...r.value);
				else if (loadId === this.loadId) new Notice(`Could not load "${lists[i].name}": ${errorMessage(r.reason)}`);
			});
		} catch (e) {
			if (loadId !== this.loadId) return;
			this.bodyEl.empty();
			this.bodyEl.createEl("p", { text: `Could not load task lists: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
			return;
		}
		if (loadId !== this.loadId) return;

		if (this.filter === "today") {
			const endOfToday = moment().endOf("day").valueOf();
			tasks = tasks.filter((t) => t.due && t.due.getTime() <= endOfToday);
		}
		this.renderTasks(tasks);
	}

	private renderToolbar() {
		const bar = this.toolbarEl;
		bar.empty();
		const dropdown = new DropdownComponent(bar).addOption("today", "Today").addOption("all", "All lists");
		for (const list of this.lists ?? []) dropdown.addOption(list.path, list.name);
		dropdown.setValue(this.filter).onChange((filter) => {
			this.filter = filter;
			this.changed();
		});

		const actions = bar.createDiv({ cls: "nc-cal-toolbar-group" });
		const toggle = new ButtonComponent(actions)
			.setIcon("check-check")
			.setTooltip(this.showCompleted ? "Hide completed" : "Show completed")
			.onClick(() => {
				this.showCompleted = !this.showCompleted;
				this.changed();
			});
		toggle.buttonEl.toggleClass("is-active", this.showCompleted);
		new ButtonComponent(actions).setIcon("refresh-cw").setTooltip("Reload").onClick(() => this.reload());

		const target = this.targetList();
		if (!target) return;
		const add = bar.createEl("input", {
			type: "text",
			cls: "nc-tasks-add",
			attr: { placeholder: `Add a task to ${target.name}…`, enterkeyhint: "done" },
		});
		add.addEventListener("keydown", async (evt) => {
			if (evt.key !== "Enter" || evt.isComposing || !add.value.trim()) return;
			const title = add.value.trim();
			add.value = "";
			await this.createTask(target, title);
		});
	}

	/** Where quick-add puts new tasks: the selected list, or the first writable one. */
	private targetList(): DavCalendar | undefined {
		const writable = (this.lists ?? []).filter((l) => !l.readOnly);
		return writable.find((l) => l.path === this.filter) ?? writable[0];
	}

	private renderTasks(tasks: Task[]) {
		this.bodyEl.empty();
		if (!tasks.length) {
			const empty = this.filter === "today" ? "Nothing due today." : "No tasks.";
			this.bodyEl.createEl("p", { text: empty, cls: "nc-cookbook-status" });
			return;
		}

		// Subtasks are shown under their parent; if the parent isn't shown (e.g. in "Today"), they stand alone.
		const shown = new Set(tasks.map((t) => t.uid));
		const children = new Map<string, Task[]>();
		const roots: Task[] = [];
		for (const task of tasks) {
			if (task.parentUid && shown.has(task.parentUid) && task.parentUid !== task.uid) {
				children.set(task.parentUid, [...(children.get(task.parentUid) ?? []), task]);
			} else {
				roots.push(task);
			}
		}

		const showList = this.filter === "today" || this.filter === "all";
		const listEl = this.bodyEl.createDiv({ cls: "nc-tasks-list" });
		const seen = new Set<string>();
		const render = (task: Task, depth: number) => {
			if (seen.has(task.uid)) return; // guards against RELATED-TO cycles
			seen.add(task.uid);
			this.renderTask(listEl, task, depth, showList);
			for (const child of (children.get(task.uid) ?? []).sort(compareTasks)) render(child, depth + 1);
		};
		for (const task of roots.sort(compareTasks)) render(task, 0);
	}

	private renderTask(parent: HTMLElement, task: Task, depth: number, showList: boolean) {
		const row = parent.createDiv({ cls: "nc-task" });
		row.style.setProperty("--nc-task-depth", String(Math.min(depth, 4)));
		row.toggleClass("is-completed", task.completed);

		const checkbox = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
		checkbox.checked = task.completed;
		checkbox.disabled = task.list.readOnly;
		checkbox.addEventListener("click", (evt) => evt.stopPropagation());
		checkbox.addEventListener("change", () => this.setCompleted(task, checkbox));

		const main = row.createDiv({ cls: "nc-task-main" });
		main.createDiv({ cls: "nc-task-title", text: task.title || "(No title)" });
		const meta = main.createDiv({ cls: "nc-task-meta" });
		if (task.due) meta.createSpan({ text: formatDue(task), cls: isOverdue(task) ? "nc-task-due is-overdue" : "nc-task-due" });
		const priority = priorityBucket(task.priority);
		if (priority) meta.createSpan({ text: priority === 1 ? "!!!" : priority === 5 ? "!!" : "!", cls: `nc-task-priority p${priority}` });
		if (task.recurring) meta.createSpan({ text: "↻", attr: { title: "Recurring" } });
		if (task.notes) meta.createSpan({ text: "¶", attr: { title: "Has notes" } });
		if (showList) {
			const list = meta.createSpan({ cls: "nc-task-list" });
			list.createSpan({ cls: "nc-cal-dot" }).style.background = task.list.color;
			list.createSpan({ text: task.list.name });
		}

		row.addEventListener("click", () =>
			new TaskModal(this.app, task, {
				save: (draft, rule) => this.saveTask(task, draft, rule),
				delete: () => this.deleteTask(task),
			}).open()
		);
	}

	private async setCompleted(task: Task, checkbox: HTMLInputElement) {
		checkbox.disabled = true;
		try {
			// Completion only touches the status (or the due date of a repeating task), so it is
			// applied to the latest version even if the task changed elsewhere.
			const source = await this.api.getSource(task.path);
			if (task.recurring && checkbox.checked) {
				const { ics, nextDue } = completeRecurringIcs(source.ics);
				await this.api.save(task.path, ics, source.etag);
				new Notice(nextDue ? `Done. Next: ${formatDue({ due: nextDue, dueAllDay: task.dueAllDay })}` : "Done. The series has ended.");
			} else {
				await this.api.save(task.path, setCompletedIcs(source.ics, checkbox.checked), source.etag);
			}
		} catch (e) {
			checkbox.checked = task.completed;
			new Notice(`Could not update task: ${errorMessage(e)}`, 8000);
		}
		this.loadTasks();
	}

	private async createTask(list: DavCalendar, title: string) {
		const draft: TaskDraft = { title, notes: "", due: null, dueAllDay: true, priority: 0 };
		if (this.filter === "today") draft.due = moment().startOf("day").toDate();
		try {
			const { uid, ics } = createTaskIcs(draft);
			await this.api.save(`${list.path}${uid}.ics`, ics);
		} catch (e) {
			new Notice(`Could not create task: ${errorMessage(e)}`, 8000);
		}
		this.loadTasks();
	}

	private async saveTask(task: Task, draft: TaskDraft, rule: RuleChoice) {
		const source = await this.api.getSource(task.path);
		if (source.etag !== task.etag) {
			const overwrite = await confirmModal(
				this.app,
				"Task changed elsewhere",
				"This task was changed somewhere else after the list was loaded. Saving overwrites those changes.",
				"Overwrite"
			);
			if (!overwrite) throw new Error("cancelled because the task changed elsewhere");
		}
		await this.api.save(task.path, updateTaskIcs(source.ics, draft, task, rule), source.etag);
		new Notice("Task saved.");
		this.loadTasks();
	}

	private async deleteTask(task: Task) {
		const confirmed = await confirmModal(this.app, "Delete task", `Delete "${task.title || "(No title)"}"?`, "Delete");
		if (!confirmed) return;
		try {
			await this.api.delete(task.path, task.etag);
			new Notice("Task deleted.");
		} catch (e) {
			new Notice(isConflict(e) ? "The task was changed elsewhere. Reload and try again." : `Could not delete task: ${errorMessage(e)}`, 8000);
		}
		this.loadTasks();
	}
}

/** Open before done, then by due date (none last), priority (none last) and title. */
function compareTasks(a: Task, b: Task): number {
	if (a.completed !== b.completed) return a.completed ? 1 : -1;
	const dueA = a.due?.getTime() ?? Infinity;
	const dueB = b.due?.getTime() ?? Infinity;
	if (dueA !== dueB) return dueA - dueB;
	const prioA = a.priority || 10;
	const prioB = b.priority || 10;
	if (prioA !== prioB) return prioA - prioB;
	return a.title.localeCompare(b.title);
}
