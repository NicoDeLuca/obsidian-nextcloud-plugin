import { moment } from "obsidian";
import { findByName } from "../../core/blocks";
import { loadTasks } from "./TaskList";
import { TasksApi } from "./TasksApi";
import { createTaskIcs } from "./vtodo";

/** `api.tasks`: read tasks and add new ones from scripts (DataviewJS, Templater). */
export function tasksApi(api: TasksApi) {
	return {
		async lists() {
			return (await api.listLists()).map((l) => ({ name: l.name, color: l.color, readOnly: l.readOnly }));
		},

		/**
		 * Open tasks (with `completed: true` also completed ones) of the named lists (default: all).
		 * `today: true`: only those due today or earlier.
		 */
		async tasks(options: { lists?: string[]; today?: boolean; completed?: boolean } = {}) {
			const all = await api.listLists();
			const lists = options.lists?.length ? options.lists.map((n) => findByName(all, n, (l) => l.name, "Aufgabenliste")) : all;
			const tasks = await loadTasks(api, lists, { completed: !!options.completed, today: !!options.today });
			return tasks.map((t) => ({
				uid: t.uid,
				title: t.title,
				notes: t.notes,
				due: t.due,
				/** Due on a day without a time. */
				dueAllDay: t.dueAllDay,
				/** 0 = none, 1 = highest … 9 = lowest. */
				priority: t.priority,
				completed: t.completed,
				recurring: t.recurring,
				parentUid: t.parentUid,
				list: t.list.name,
			}));
		},

		/** Adds a task to the named list (default: the first writable one). `due`: a date, "YYYY-MM-DD" (all day) or a date with time. */
		async add(title: string, options: { list?: string; due?: Date | string } = {}) {
			const all = (await api.listLists()).filter((l) => !l.readOnly);
			const list = options.list ? findByName(all, options.list, (l) => l.name, "Aufgabenliste") : all[0];
			if (!list) throw new Error("Es gibt keine beschreibbare Aufgabenliste.");
			const dueAllDay = typeof options.due === "string" && /^\d{4}-\d\d-\d\d$/.test(options.due);
			const due = options.due ? moment(options.due).toDate() : null;
			const { uid, ics } = createTaskIcs({ title, notes: "", due, dueAllDay: !due || dueAllDay, priority: 0 });
			await api.save(`${list.path}${uid}.ics`, ics);
		},
	};
}
