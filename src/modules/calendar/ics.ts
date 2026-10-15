import ICAL from "ical.js";
import { parseCalendar, setTimeProperty, timeLike, toIcalTime, utcNow, uuid } from "../../core/ical";
import { fromRecur, Recurrence, toRecur } from "../../core/recurrence";
import type { CalendarInfo } from "./CalDavApi";

export interface CalendarEvent {
	calendar: CalendarInfo;
	/** Path of the .ics resource that holds the event. */
	path: string;
	/** ETag of that resource when the event was loaded; used to detect changes made elsewhere. */
	etag: string;
	title: string;
	/** For all-day events: local midnight of the first day. */
	start: Date;
	/** Exclusive. For all-day events: local midnight after the last day. */
	end: Date;
	allDay: boolean;
	location: string;
	description: string;
	/** One occurrence of a recurring series. */
	recurring: boolean;
	/** Original start of this occurrence (its RECURRENCE-ID), for recurring events. */
	recurrenceId: Date | null;
}

/** What the event form edits. */
export interface EventDraft {
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location: string;
	description: string;
}

/** Which part of a recurring series a change applies to. */
export type Scope = "this" | "following" | "all";

/** A rule from the form: null = no repetition, "custom" = keep the existing rule unchanged. */
export type RuleChoice = Recurrence | "custom" | null;

/** Parses calendar-data as returned by an expanding calendar-query (times in UTC, one VEVENT per occurrence). */
export function parseEvents(data: string, calendar: CalendarInfo, path: string, etag: string): CalendarEvent[] {
	const root = new ICAL.Component(ICAL.parse(data));
	return root.getAllSubcomponents("vevent").map((vevent) => {
		const start = vevent.getFirstPropertyValue("dtstart") as ICAL.Time;
		const allDay = start.isDate;
		let end = vevent.getFirstPropertyValue("dtend") as ICAL.Time | null;
		const duration = vevent.getFirstPropertyValue("duration") as ICAL.Duration | null;
		if (!end) {
			end = start.clone();
			if (duration) end.addDuration(duration);
			else if (allDay) end.adjust(1, 0, 0, 0);
		}
		const recurrenceId = vevent.getFirstPropertyValue("recurrence-id") as ICAL.Time | null;
		return {
			calendar,
			path,
			etag,
			title: textProp(vevent, "summary"),
			start: start.toJSDate(),
			end: end.toJSDate(),
			allDay,
			location: textProp(vevent, "location"),
			description: textProp(vevent, "description"),
			recurring: !!recurrenceId,
			recurrenceId: recurrenceId ? recurrenceId.toJSDate() : null,
		};
	});
}

/**
 * The series rule of a stored event, for the form. With `from`, a COUNT is reduced to
 * the occurrences left from that occurrence on (for "this and following").
 */
export function readRecurrence(ics: string, from?: CalendarEvent): RuleChoice {
	const master = findMaster(parseCalendar(ics));
	const recur = master.getFirstPropertyValue("rrule") as ICAL.Recur | null;
	if (!recur) return null;
	const rule = fromRecur(recur);
	if (rule !== "custom" && rule.end.type === "count" && from?.recurrenceId) {
		rule.end = { type: "count", count: Math.max(1, rule.end.count - countBefore(master, recur, from.recurrenceId)) };
	}
	return rule;
}

/** A complete iCalendar object for a new event. */
export function createEventIcs(draft: EventDraft, rule: RuleChoice = null): { uid: string; ics: string } {
	const uid = uuid();
	const root = new ICAL.Component(["vcalendar", [], []]);
	root.addPropertyWithValue("prodid", "-//Obsidian Nextcloud Plugin//EN");
	root.addPropertyWithValue("version", "2.0");
	const vevent = new ICAL.Component("vevent");
	vevent.addPropertyWithValue("uid", uid);
	vevent.addPropertyWithValue("created", utcNow());
	root.addSubcomponent(vevent);
	applyFields(vevent, draft);
	setTimes(vevent, draft.start, draft.end, draft.allDay, null);
	setRule(vevent, rule, draft.allDay);
	return { uid, ics: root.toString() };
}

/**
 * Applies the form to a non-recurring event (which may become recurring through `rule`).
 * Start/end are only rewritten when they changed; alarms, attendees etc. stay.
 */
export function updateEventIcs(ics: string, draft: EventDraft, original: CalendarEvent, rule: RuleChoice = "custom"): string {
	const root = parseCalendar(ics);
	const vevent = findMaster(root);
	applyFields(vevent, draft);
	if (timesChanged(draft, original)) setTimes(vevent, draft.start, draft.end, draft.allDay, startOf(vevent));
	setRule(vevent, rule, draft.allDay);
	bumpSequence(vevent);
	return root.toString();
}

/**
 * Applies the form to one occurrence of a series, this and the following ones, or all.
 * "following" splits the series: the stored object ends before the occurrence and a new
 * object (`created`) continues from it; exceptions and EXDATEs move along.
 */
export function updateRecurringIcs(
	ics: string,
	draft: EventDraft,
	occurrence: CalendarEvent,
	scope: Scope,
	rule: RuleChoice
): { ics: string; created?: { uid: string; ics: string } } {
	const root = parseCalendar(ics);
	const master = findMaster(root);
	const recurrenceId = occurrence.recurrenceId!;
	if (scope === "following" && isFirstOccurrence(master, recurrenceId)) scope = "all";

	if (scope === "this") {
		let exception = findException(root, recurrenceId);
		if (!exception) {
			exception = new ICAL.Component(JSON.parse(JSON.stringify(master.toJSON())));
			for (const name of ["rrule", "rdate", "exdate", "recurrence-id"]) exception.removeAllProperties(name);
			setTimeProperty(exception, "recurrence-id", timeLike(recurrenceId, startOf(master), occurrence.allDay));
			root.addSubcomponent(exception);
		}
		applyFields(exception, draft);
		setTimes(exception, draft.start, draft.end, draft.allDay, startOf(master));
		bumpSequence(exception);
		return { ics: root.toString() };
	}

	const delta = draft.start.getTime() - occurrence.start.getTime();
	const duration = draft.end.getTime() - draft.start.getTime();

	if (scope === "all") {
		applyFields(master, draft);
		if (timesChanged(draft, occurrence)) {
			const start = new Date(startOf(master)!.toJSDate().getTime() + delta);
			setTimes(master, start, new Date(start.getTime() + duration), draft.allDay, startOf(master));
			shiftRecurrenceIds(root, master, delta, draft.allDay, () => true);
		}
		if (rule === null) dropExceptions(root, master, () => true);
		setRule(master, rule, draft.allDay);
		bumpSequence(master);
		return { ics: root.toString() };
	}

	// "following": end the stored series before this occurrence …
	const isLater = (time: Date) => time.getTime() >= recurrenceId.getTime();
	const oldRecur = master.getFirstPropertyValue("rrule") as ICAL.Recur | null;
	if (!oldRecur) throw new Error("Diese Serie lässt sich hier nicht teilen; bearbeite nur diesen Termin oder alle.");
	const remaining = oldRecur.count ? oldRecur.count - countBefore(master, oldRecur, recurrenceId) : null;
	endSeriesBefore(master, recurrenceId, occurrence.allDay);

	// … and continue it as a new series with a new UID.
	const uid = uuid();
	const created = new ICAL.Component(JSON.parse(JSON.stringify(root.toJSON())));
	created.removeAllSubcomponents("vevent");
	const next = new ICAL.Component(JSON.parse(JSON.stringify(master.toJSON())));
	next.updatePropertyWithValue("uid", uid);
	for (const name of ["exdate", "recurrence-id", "sequence"]) next.removeAllProperties(name);
	next.updatePropertyWithValue("created", utcNow());
	applyFields(next, draft);
	setTimes(next, draft.start, draft.end, draft.allDay, startOf(master));
	if (rule === "custom") {
		const recur = oldRecur.clone();
		recur.until = null;
		recur.count = remaining;
		if (!remaining && oldRecur.until) recur.until = oldRecur.until;
		next.updatePropertyWithValue("rrule", recur);
	} else setRule(next, rule, draft.allDay);
	created.addSubcomponent(next);

	// Exceptions and EXDATEs from the split on belong to the new series.
	for (const exdate of master.getAllProperties("exdate")) {
		const time = exdate.getFirstValue() as ICAL.Time;
		if (!isLater(time.toJSDate())) continue;
		master.removeProperty(exdate);
		if (rule !== null) setTimeProperty(next, "exdate", timeLike(new Date(time.toJSDate().getTime() + delta), startOf(next), draft.allDay), false);
	}
	for (const exception of exceptions(root)) {
		const id = (exception.getFirstPropertyValue("recurrence-id") as ICAL.Time).toJSDate();
		if (!isLater(id)) continue;
		root.removeSubcomponent(exception);
		if (rule === null) continue;
		exception.updatePropertyWithValue("uid", uid);
		setTimeProperty(exception, "recurrence-id", timeLike(new Date(id.getTime() + delta), startOf(next), draft.allDay));
		created.addSubcomponent(exception);
	}
	bumpSequence(master);
	return { ics: root.toString(), created: { uid, ics: created.toString() } };
}

/**
 * Deletes one occurrence (EXDATE), this and the following ones (ends the series), or all.
 * Returns null when the whole object should be deleted.
 */
export function deleteRecurringIcs(ics: string, occurrence: CalendarEvent, scope: Scope): string | null {
	if (scope === "all") return null;
	const root = parseCalendar(ics);
	const master = findMaster(root);
	const recurrenceId = occurrence.recurrenceId!;
	if (scope === "following") {
		if (isFirstOccurrence(master, recurrenceId)) return null;
		endSeriesBefore(master, recurrenceId, occurrence.allDay);
		dropExceptions(root, master, (time) => time.getTime() >= recurrenceId.getTime());
	} else {
		const exception = findException(root, recurrenceId);
		if (exception) root.removeSubcomponent(exception);
		setTimeProperty(master, "exdate", timeLike(recurrenceId, startOf(master), occurrence.allDay), false);
	}
	bumpSequence(master);
	return root.toString();
}

// ── helpers ──────────────────────────────────────────────────────────────────

function findMaster(root: ICAL.Component): ICAL.Component {
	const vevent = root.getAllSubcomponents("vevent").find((v) => !v.hasProperty("recurrence-id"));
	if (!vevent) throw new Error("Der Termin wurde in den Kalenderdaten nicht gefunden.");
	return vevent;
}

function exceptions(root: ICAL.Component): ICAL.Component[] {
	return root.getAllSubcomponents("vevent").filter((v) => v.hasProperty("recurrence-id"));
}

function findException(root: ICAL.Component, recurrenceId: Date): ICAL.Component | undefined {
	return exceptions(root).find((v) => (v.getFirstPropertyValue("recurrence-id") as ICAL.Time).toJSDate().getTime() === recurrenceId.getTime());
}

function startOf(vevent: ICAL.Component): ICAL.Time | null {
	return vevent.getFirstPropertyValue("dtstart") as ICAL.Time | null;
}

function isFirstOccurrence(master: ICAL.Component, recurrenceId: Date): boolean {
	return startOf(master)!.toJSDate().getTime() >= recurrenceId.getTime();
}

/** Occurrences of the series that start before `until`. */
function countBefore(master: ICAL.Component, recur: ICAL.Recur, until: Date): number {
	const iterator = recur.iterator(startOf(master)!);
	let count = 0;
	for (let next = iterator.next(); next && next.toJSDate().getTime() < until.getTime() && count < 100000; next = iterator.next()) count++;
	return count;
}

/** Lets the series end just before `recurrenceId` (UNTIL replaces COUNT). */
function endSeriesBefore(master: ICAL.Component, recurrenceId: Date, allDay: boolean) {
	const recur = (master.getFirstPropertyValue("rrule") as ICAL.Recur).clone();
	recur.count = null;
	recur.until = allDay
		? toIcalTime(new Date(recurrenceId.getFullYear(), recurrenceId.getMonth(), recurrenceId.getDate() - 1), true)
		: ICAL.Time.fromJSDate(new Date(recurrenceId.getTime() - 1000), true);
	master.updatePropertyWithValue("rrule", recur);
}

/** Moves RECURRENCE-IDs of exceptions and EXDATEs when the whole series moves. */
function shiftRecurrenceIds(root: ICAL.Component, master: ICAL.Component, delta: number, allDay: boolean, which: (time: Date) => boolean) {
	if (!delta) return;
	const like = startOf(master);
	const exdates = master.getAllProperties("exdate").map((p) => (p.getFirstValue() as ICAL.Time).toJSDate());
	master.removeAllProperties("exdate");
	for (const time of exdates) setTimeProperty(master, "exdate", timeLike(which(time) ? new Date(time.getTime() + delta) : time, like, allDay), false);
	for (const exception of exceptions(root)) {
		const id = (exception.getFirstPropertyValue("recurrence-id") as ICAL.Time).toJSDate();
		if (which(id)) setTimeProperty(exception, "recurrence-id", timeLike(new Date(id.getTime() + delta), like, allDay));
	}
}

/** Removes exceptions and EXDATEs (e.g. when a series stops repeating or ends earlier). */
function dropExceptions(root: ICAL.Component, master: ICAL.Component, which: (time: Date) => boolean) {
	for (const exdate of master.getAllProperties("exdate")) {
		if (which((exdate.getFirstValue() as ICAL.Time).toJSDate())) master.removeProperty(exdate);
	}
	for (const exception of exceptions(root)) {
		if (which((exception.getFirstPropertyValue("recurrence-id") as ICAL.Time).toJSDate())) root.removeSubcomponent(exception);
	}
}

function timesChanged(draft: EventDraft, original: { start: Date; end: Date; allDay: boolean }): boolean {
	return draft.allDay !== original.allDay || draft.start.getTime() !== original.start.getTime() || draft.end.getTime() !== original.end.getTime();
}

function applyFields(vevent: ICAL.Component, draft: EventDraft) {
	const now = utcNow();
	vevent.updatePropertyWithValue("dtstamp", now);
	vevent.updatePropertyWithValue("last-modified", now);
	vevent.updatePropertyWithValue("summary", draft.title);
	setOptionalText(vevent, "location", draft.location);
	setOptionalText(vevent, "description", draft.description);
}

/** Writes DTSTART/DTEND in the time zone of `like` (the event's or series' start). */
function setTimes(vevent: ICAL.Component, start: Date, end: Date, allDay: boolean, like: ICAL.Time | null) {
	vevent.removeAllProperties("duration");
	setTimeProperty(vevent, "dtstart", timeLike(start, like, allDay));
	setTimeProperty(vevent, "dtend", timeLike(end, like, allDay));
}

function setRule(vevent: ICAL.Component, rule: RuleChoice, allDay: boolean) {
	if (rule === "custom") return;
	if (rule === null) {
		vevent.removeAllProperties("rrule");
		vevent.removeAllProperties("exdate");
	} else vevent.updatePropertyWithValue("rrule", toRecur(rule, allDay));
}

function bumpSequence(vevent: ICAL.Component) {
	const sequence = Number(vevent.getFirstPropertyValue("sequence") ?? 0);
	vevent.updatePropertyWithValue("sequence", sequence + 1);
}

function setOptionalText(vevent: ICAL.Component, name: string, value: string) {
	if (value) vevent.updatePropertyWithValue(name, value);
	else vevent.removeAllProperties(name);
}

function textProp(vevent: ICAL.Component, name: string): string {
	const value = vevent.getFirstPropertyValue(name);
	return typeof value === "string" ? value : "";
}
