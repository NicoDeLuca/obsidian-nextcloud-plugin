import { App, moment, Notice } from "obsidian";
import { DavCalendar, isConflict } from "../../core/CalDav";
import { errorMessage } from "../../core/NextcloudClient";
import { confirmModal } from "../../core/ui";
import { formatDue, isOverdue, priorityBucket, TaskModal } from "./TaskModal";
import { TasksApi } from "./TasksApi";
import { completeRecurringIcs, createTaskIcs, RuleChoice, setCompletedIcs, Task, TaskDraft, updateTaskIcs } from "./vtodo";

/**
 * Loads the tasks of the given lists. A list that fails is reported and skipped.
 * @param today only tasks due today or earlier
 */
export async function loadTasks(api: TasksApi, lists: DavCalendar[], options: { completed: boolean; today: boolean }, isCurrent: () => boolean = () => true): Promise<Task[]> {
	const tasks: Task[] = [];
	const results = await Promise.allSettled(lists.map((l) => api.getTasks(l, options.completed)));
	results.forEach((r, i) => {
		if (r.status === "fulfilled") tasks.push(...r.value);
		else if (isCurrent()) new Notice(`"${lists[i].name}" konnte nicht geladen werden: ${errorMessage(r.reason)}`);
	});
	if (!options.today) return tasks;
	const endOfToday = moment().endOf("day").valueOf();
	return tasks.filter((t) => t.due && t.due.getTime() <= endOfToday);
}

/** What can be done with a task: tick it, open it for editing, add new ones. Calls `changed` afterwards. */
export class TaskActions {
	constructor(private app: App, private api: TasksApi, private changed: () => void) {}

	open(task: Task) {
		new TaskModal(this.app, task, {
			save: (draft, rule) => this.save(task, draft, rule),
			delete: () => this.delete(task),
		}).open();
	}

	async setCompleted(task: Task, checkbox: HTMLInputElement) {
		checkbox.disabled = true;
		try {
			// Completion only touches the status (or the due date of a repeating task), so it is
			// applied to the latest version even if the task changed elsewhere.
			const source = await this.api.getSource(task.path);
			if (task.recurring && checkbox.checked) {
				const { ics, nextDue } = completeRecurringIcs(source.ics);
				await this.api.save(task.path, ics, source.etag);
				new Notice(nextDue ? `Erledigt. Nächstes Mal: ${formatDue({ due: nextDue, dueAllDay: task.dueAllDay })}` : "Erledigt. Die Serie ist beendet.");
			} else {
				await this.api.save(task.path, setCompletedIcs(source.ics, checkbox.checked), source.etag);
			}
		} catch (e) {
			checkbox.checked = task.completed;
			new Notice(`Aufgabe konnte nicht aktualisiert werden: ${errorMessage(e)}`, 8000);
		}
		this.changed();
	}

	/** @param dueToday give the new task today as due date (e.g. when added in "Heute") */
	async create(list: DavCalendar, title: string, dueToday: boolean) {
		const draft: TaskDraft = { title, notes: "", due: null, dueAllDay: true, priority: 0 };
		if (dueToday) draft.due = moment().startOf("day").toDate();
		try {
			const { uid, ics } = createTaskIcs(draft);
			await this.api.save(`${list.path}${uid}.ics`, ics);
		} catch (e) {
			new Notice(`Aufgabe konnte nicht angelegt werden: ${errorMessage(e)}`, 8000);
		}
		this.changed();
	}

	private async save(task: Task, draft: TaskDraft, rule: RuleChoice) {
		const source = await this.api.getSource(task.path);
		if (source.etag !== task.etag) {
			const overwrite = await confirmModal(
				this.app,
				"Aufgabe wurde woanders geändert",
				"Diese Aufgabe wurde woanders geändert, nachdem die Liste geladen wurde. Speichern überschreibt diese Änderungen.",
				"Überschreiben"
			);
			if (!overwrite) throw new Error("abgebrochen, weil die Aufgabe woanders geändert wurde");
		}
		await this.api.save(task.path, updateTaskIcs(source.ics, draft, task, rule), source.etag);
		new Notice("Aufgabe gespeichert.");
		this.changed();
	}

	private async delete(task: Task) {
		const confirmed = await confirmModal(this.app, "Aufgabe löschen", `"${task.title || "(Ohne Titel)"}" löschen?`, "Löschen");
		if (!confirmed) return;
		try {
			await this.api.delete(task.path, task.etag);
			new Notice("Aufgabe gelöscht.");
		} catch (e) {
			new Notice(isConflict(e) ? "Die Aufgabe wurde woanders geändert. Bitte neu laden und erneut versuchen." : `Aufgabe konnte nicht gelöscht werden: ${errorMessage(e)}`, 8000);
		}
		this.changed();
	}
}

/**
 * Draws tasks with their subtasks below them, sorted.
 * @param showList show each task's list (when several lists are mixed)
 * @param max show at most this many top-level tasks (0 = all)
 */
export function renderTasks(parent: HTMLElement, tasks: Task[], actions: TaskActions, options: { showList: boolean; empty: string; max?: number }) {
	if (!tasks.length) {
		parent.createEl("p", { text: options.empty, cls: "nc-cookbook-status" });
		return;
	}

	// Subtasks are shown under their parent; if the parent isn't shown (e.g. in "Today"), they stand alone.
	const shown = new Set(tasks.map((t) => t.uid));
	const children = new Map<string, Task[]>();
	let roots: Task[] = [];
	for (const task of tasks) {
		if (task.parentUid && shown.has(task.parentUid) && task.parentUid !== task.uid) {
			children.set(task.parentUid, [...(children.get(task.parentUid) ?? []), task]);
		} else {
			roots.push(task);
		}
	}
	roots = roots.sort(compareTasks);
	const hidden = options.max ? Math.max(0, roots.length - options.max) : 0;
	if (hidden) roots = roots.slice(0, options.max);

	const listEl = parent.createDiv({ cls: "nc-tasks-list" });
	const seen = new Set<string>();
	const render = (task: Task, depth: number) => {
		if (seen.has(task.uid)) return; // guards against RELATED-TO cycles
		seen.add(task.uid);
		renderTask(listEl, task, depth, options.showList, actions);
		for (const child of (children.get(task.uid) ?? []).sort(compareTasks)) render(child, depth + 1);
	};
	for (const task of roots) render(task, 0);
	if (hidden) parent.createEl("p", { text: `… und ${hidden} weitere`, cls: "nc-cookbook-status" });
}

function renderTask(parent: HTMLElement, task: Task, depth: number, showList: boolean, actions: TaskActions) {
	const row = parent.createDiv({ cls: "nc-task" });
	row.style.setProperty("--nc-task-depth", String(Math.min(depth, 4)));
	row.toggleClass("is-completed", task.completed);

	const checkbox = row.createEl("input", { type: "checkbox", cls: "task-list-item-checkbox" });
	checkbox.checked = task.completed;
	checkbox.disabled = task.list.readOnly;
	checkbox.addEventListener("click", (evt) => evt.stopPropagation());
	checkbox.addEventListener("change", () => actions.setCompleted(task, checkbox));

	const main = row.createDiv({ cls: "nc-task-main" });
	main.createDiv({ cls: "nc-task-title", text: task.title || "(Ohne Titel)" });
	const meta = main.createDiv({ cls: "nc-task-meta" });
	if (task.due) meta.createSpan({ text: formatDue(task), cls: isOverdue(task) ? "nc-task-due is-overdue" : "nc-task-due" });
	const priority = priorityBucket(task.priority);
	if (priority) meta.createSpan({ text: priority === 1 ? "!!!" : priority === 5 ? "!!" : "!", cls: `nc-task-priority p${priority}` });
	if (task.recurring) meta.createSpan({ text: "↻", attr: { title: "Wiederkehrend" } });
	if (task.notes) meta.createSpan({ text: "¶", attr: { title: "Hat Notizen" } });
	if (showList) {
		const list = meta.createSpan({ cls: "nc-task-list" });
		list.createSpan({ cls: "nc-cal-dot" }).style.background = task.list.color;
		list.createSpan({ text: task.list.name });
	}

	row.addEventListener("click", () => actions.open(task));
}

/** Open before done, then by due date (none last), priority (none last) and title. */
export function compareTasks(a: Task, b: Task): number {
	if (a.completed !== b.completed) return a.completed ? 1 : -1;
	const dueA = a.due?.getTime() ?? Infinity;
	const dueB = b.due?.getTime() ?? Infinity;
	if (dueA !== dueB) return dueA - dueB;
	const prioA = a.priority || 10;
	const prioB = b.priority || 10;
	if (prioA !== prioB) return prioA - prioB;
	return a.title.localeCompare(b.title);
}

/** A text field that adds a task on Enter. */
export function renderQuickAdd(parent: HTMLElement, list: DavCalendar, onAdd: (title: string) => void): HTMLInputElement {
	const add = parent.createEl("input", {
		type: "text",
		cls: "nc-tasks-add",
		attr: { placeholder: `Aufgabe zu ${list.name} hinzufügen …`, enterkeyhint: "done" },
	});
	add.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter" || evt.isComposing || !add.value.trim()) return;
		const title = add.value.trim();
		add.value = "";
		onAdd(title);
	});
	return add;
}
