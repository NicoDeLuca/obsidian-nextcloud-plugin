import ICAL from "ical.js";
import type { DavCalendar } from "../../core/CalDav";
import { toIcalTime, utcNow, uuid } from "../../core/ical";

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
	const root = new ICAL.Component(ICAL.parse(data));
	// Nextcloud stores DUE with a TZID; registering the object's VTIMEZONEs lets ical.js convert it correctly.
	for (const vtimezone of root.getAllSubcomponents("vtimezone")) {
		ICAL.TimezoneService.register(new ICAL.Timezone(vtimezone));
	}
	return root
		.getAllSubcomponents("vtodo")
		.filter((vtodo) => !vtodo.hasProperty("recurrence-id"))
		.map((vtodo) => {
			const due = vtodo.getFirstPropertyValue("due") as ICAL.Time | null;
			const parent = vtodo
				.getAllProperties("related-to")
				.find((p) => (p.getParameter("reltype") ?? "PARENT").toString().toUpperCase() === "PARENT");
			const status = textProp(vtodo, "status").toUpperCase();
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
				recurring: vtodo.hasProperty("rrule"),
			};
		});
}

/** A complete iCalendar object for a new task. */
export function createTaskIcs(draft: TaskDraft): { uid: string; ics: string } {
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
	return { uid, ics: root.toString() };
}

/**
 * Applies the form values to a stored task. DUE is only rewritten when it changed,
 * so its time zone is kept otherwise; all other properties stay as they are.
 */
export function updateTaskIcs(ics: string, draft: TaskDraft, original: Task): string {
	return modify(ics, (vtodo) => {
		const dueChanged = draft.dueAllDay !== original.dueAllDay || draft.due?.getTime() !== original.due?.getTime();
		applyDraft(vtodo, draft, dueChanged);
	});
}

/** Marks a task as done or not done. */
export function setCompletedIcs(ics: string, completed: boolean): string {
	return modify(ics, (vtodo) => {
		if (completed) {
			vtodo.updatePropertyWithValue("status", "COMPLETED");
			vtodo.updatePropertyWithValue("completed", utcNow());
			vtodo.updatePropertyWithValue("percent-complete", 100);
		} else {
			vtodo.updatePropertyWithValue("status", "NEEDS-ACTION");
			vtodo.removeAllProperties("completed");
			vtodo.updatePropertyWithValue("percent-complete", 0);
		}
	});
}

function modify(ics: string, change: (vtodo: ICAL.Component) => void): string {
	const root = new ICAL.Component(ICAL.parse(ics));
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
		vtodo.removeAllProperties("due");
		if (draft.due) vtodo.addPropertyWithValue("due", toIcalTime(draft.due, draft.dueAllDay));
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
