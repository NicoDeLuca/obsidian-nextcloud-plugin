import ICAL from "ical.js";
import type { DavCalendar } from "../../core/CalDav";
import { parseCalendar, setTimeProperty, timeLike, utcNow, uuid } from "../../core/ical";
import { fromRecur, Recurrence, toRecur } from "../../core/recurrence";

/** A rule from the form: null = no repetition, "custom" = keep the existing rule unchanged. */
export type RuleChoice = Recurrence | "custom" | null;

export interface Task {
	list: DavCalendar;
	/** Path of the .ics resource that holds the task. */
	path: string;
	/** ETag when the task was loaded; used to detect changes made elsewhere. */
	etag: string;
	uid: string;
	title: string;
	notes: string;
	due: Date | null;
	/** Due on a day without a time. */
	dueAllDay: boolean;
	/** iCalendar priority: 0 = none, 1 = highest … 9 = lowest. */
	priority: number;
	completed: boolean;
	/** UID of the parent task, for subtasks. */
	parentUid: string | null;
	recurring: boolean;
	/** The repeat rule, for the form. */
	rule: RuleChoice;
}

/** What the task form edits. */
export interface TaskDraft {
	title: string;
	notes: string;
	due: Date | null;
	dueAllDay: boolean;
	priority: number;
}

export function parseTasks(data: string, list: DavCalendar, path: string, etag: string): Task[] {
	// Nextcloud stores DUE with a TZID; parseCalendar registers the VTIMEZONEs so it converts correctly.
	const root = parseCalendar(data);
	return root
		.getAllSubcomponents("vtodo")
		.filter((vtodo) => !vtodo.hasProperty("recurrence-id"))
		.map((vtodo) => {
			const due = vtodo.getFirstPropertyValue("due") as ICAL.Time | null;
			const parent = vtodo
				.getAllProperties("related-to")
				.find((p) => (p.getParameter("reltype") ?? "PARENT").toString().toUpperCase() === "PARENT");
			const status = textProp(vtodo, "status").toUpperCase();
			const recur = vtodo.getFirstPropertyValue("rrule") as ICAL.Recur | null;
			return {
				list,
				path,
				etag,
				uid: textProp(vtodo, "uid"),
				title: textProp(vtodo, "summary"),
				notes: textProp(vtodo, "description"),
				due: due ? due.toJSDate() : null,
				dueAllDay: due?.isDate ?? false,
				priority: Number(vtodo.getFirstPropertyValue("priority") ?? 0) || 0,
				// Cancelled tasks count as done, so they are hidden together with completed ones.
				completed: status === "COMPLETED" || status === "CANCELLED" || vtodo.hasProperty("completed"),
				parentUid: parent ? String(parent.getFirstValue()) : null,
				recurring: !!recur,
				rule: recur ? fromRecur(recur) : null,
			};
		});
}

/** A complete iCalendar object for a new task. */
export function createTaskIcs(draft: TaskDraft, rule: RuleChoice = null): { uid: string; ics: string } {
	const uid = uuid();
	const root = new ICAL.Component(["vcalendar", [], []]);
	root.addPropertyWithValue("prodid", "-//Obsidian Nextcloud Plugin//EN");
	root.addPropertyWithValue("version", "2.0");
	const vtodo = new ICAL.Component("vtodo");
	const now = utcNow();
	vtodo.addPropertyWithValue("uid", uid);
	vtodo.addPropertyWithValue("created", now);
	vtodo.addPropertyWithValue("dtstamp", now);
	vtodo.addPropertyWithValue("last-modified", now);
	vtodo.addPropertyWithValue("status", "NEEDS-ACTION");
	root.addSubcomponent(vtodo);
	applyDraft(vtodo, draft, true);
	setRule(vtodo, rule);
	return { uid, ics: root.toString() };
}

/**
 * Applies the form values to a stored task. DUE is only rewritten when it changed,
 * so its time zone is kept otherwise; all other properties stay as they are.
 */
export function updateTaskIcs(ics: string, draft: TaskDraft, original: Task, rule: RuleChoice = "custom"): string {
	return modify(ics, (vtodo) => {
		const dueChanged = draft.dueAllDay !== original.dueAllDay || draft.due?.getTime() !== original.due?.getTime();
		// A start date moves along with the due date, so a repeating task keeps its rhythm.
		const start = vtodo.getFirstPropertyValue("dtstart") as ICAL.Time | null;
		if (dueChanged && start && original.due && draft.due) {
			const shifted = new Date(start.toJSDate().getTime() + draft.due.getTime() - original.due.getTime());
			setTimeProperty(vtodo, "dtstart", timeLike(shifted, start, start.isDate));
		}
		applyDraft(vtodo, draft, dueChanged);
		setRule(vtodo, rule);
	});
}

/**
 * Checks off one round of a repeating task: DUE (and DTSTART) move to the next occurrence
 * after now, skipping missed ones. When the series has ended, the task is completed instead.
 * Returns the new due date, or null if the task was completed.
 */
export function completeRecurringIcs(ics: string, now = new Date()): { ics: string; nextDue: Date | null } {
	let nextDue: Date | null = null;
	const result = modify(ics, (vtodo) => {
		const recur = vtodo.getFirstPropertyValue("rrule") as ICAL.Recur | null;
		const due = vtodo.getFirstPropertyValue("due") as ICAL.Time | null;
		const start = vtodo.getFirstPropertyValue("dtstart") as ICAL.Time | null;
		const anchor = start ?? due;
		const next = recur && anchor ? nextOccurrence(recur, anchor, Math.max(anchor.toJSDate().getTime(), now.getTime())) : null;
		if (!recur || !anchor || !next) {
			markCompleted(vtodo, true);
			return;
		}
		const shift = (time: ICAL.Time) => {
			if (time.isDate) {
				const days = Math.round((next.toJSDate().getTime() - anchor.toJSDate().getTime()) / 86400000);
				const moved = time.clone();
				moved.adjust(days, 0, 0, 0);
				return moved;
			}
			return timeLike(new Date(time.toJSDate().getTime() + next.toJSDate().getTime() - anchor.toJSDate().getTime()), time, false);
		};
		if (due) setTimeProperty(vtodo, "due", shift(due));
		if (start) setTimeProperty(vtodo, "dtstart", shift(start));
		nextDue = due ? (vtodo.getFirstPropertyValue("due") as ICAL.Time).toJSDate() : null;
		if (recur.count) {
			// COUNT counts from DTSTART, which just moved by the skipped occurrences.
			const skipped = countBetween(recur, anchor, next);
			const updated = recur.clone();
			updated.count = recur.count - skipped;
			vtodo.updatePropertyWithValue("rrule", updated);
		}
		// Reset progress in case the task was partly done.
		vtodo.removeAllProperties("completed");
		vtodo.updatePropertyWithValue("status", "NEEDS-ACTION");
		vtodo.removeAllProperties("percent-complete");
	});
	return { ics: result, nextDue };
}

/** Marks a task as done or not done. */
export function setCompletedIcs(ics: string, completed: boolean): string {
	return modify(ics, (vtodo) => markCompleted(vtodo, completed));
}

function markCompleted(vtodo: ICAL.Component, completed: boolean) {
	if (completed) {
		vtodo.updatePropertyWithValue("status", "COMPLETED");
		vtodo.updatePropertyWithValue("completed", utcNow());
		vtodo.updatePropertyWithValue("percent-complete", 100);
	} else {
		vtodo.updatePropertyWithValue("status", "NEEDS-ACTION");
		vtodo.removeAllProperties("completed");
		vtodo.updatePropertyWithValue("percent-complete", 0);
	}
}

/** The first occurrence of the rule (anchored at `anchor`) that lies after `after` (ms). */
function nextOccurrence(recur: ICAL.Recur, anchor: ICAL.Time, after: number): ICAL.Time | null {
	const iterator = recur.iterator(anchor);
	for (let next = iterator.next(), i = 0; next && i < 100000; next = iterator.next(), i++) {
		if (next.toJSDate().getTime() > after) return next;
	}
	return null;
}

/** Occurrences from `anchor` (inclusive) up to `next` (exclusive). */
function countBetween(recur: ICAL.Recur, anchor: ICAL.Time, next: ICAL.Time): number {
	const iterator = recur.iterator(anchor);
	let count = 0;
	for (let t = iterator.next(); t && t.toJSDate().getTime() < next.toJSDate().getTime() && count < 100000; t = iterator.next()) count++;
	return count;
}

function setRule(vtodo: ICAL.Component, rule: RuleChoice) {
	if (rule === "custom") return;
	if (rule === null) {
		vtodo.removeAllProperties("rrule");
		return;
	}
	const anchor = (vtodo.getFirstPropertyValue("dtstart") ?? vtodo.getFirstPropertyValue("due")) as ICAL.Time | null;
	vtodo.updatePropertyWithValue("rrule", toRecur(rule, anchor?.isDate ?? true));
}

function modify(ics: string, change: (vtodo: ICAL.Component) => void): string {
	const root = parseCalendar(ics);
	const vtodo = root.getAllSubcomponents("vtodo").find((v) => !v.hasProperty("recurrence-id"));
	if (!vtodo) throw new Error("The task could not be found in the calendar data.");
	change(vtodo);
	const now = utcNow();
	vtodo.updatePropertyWithValue("dtstamp", now);
	vtodo.updatePropertyWithValue("last-modified", now);
	return root.toString();
}

function applyDraft(vtodo: ICAL.Component, draft: TaskDraft, setDue: boolean) {
	vtodo.updatePropertyWithValue("summary", draft.title);
	setOptional(vtodo, "description", draft.notes);
	setOptional(vtodo, "priority", draft.priority || null);
	if (setDue) {
		const previous = vtodo.getFirstPropertyValue("due") as ICAL.Time | null;
		vtodo.removeAllProperties("due");
		if (draft.due) setTimeProperty(vtodo, "due", timeLike(draft.due, previous, draft.dueAllDay));
	}
}

function setOptional(vtodo: ICAL.Component, name: string, value: string | number | null) {
	if (value) vtodo.updatePropertyWithValue(name, value);
	else vtodo.removeAllProperties(name);
}

function textProp(component: ICAL.Component, name: string): string {
	const value = component.getFirstPropertyValue(name);
	return typeof value === "string" ? value : "";
}
