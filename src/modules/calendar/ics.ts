import ICAL from "ical.js";
import { toIcalTime, utcNow, uuid } from "../../core/ical";
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
			recurring: vevent.hasProperty("recurrence-id"),
		};
	});
}

/** A complete iCalendar object for a new event. */
export function createEventIcs(draft: EventDraft): { uid: string; ics: string } {
	const uid = uuid();
	const root = new ICAL.Component(["vcalendar", [], []]);
	root.addPropertyWithValue("prodid", "-//Obsidian Nextcloud Plugin//EN");
	root.addPropertyWithValue("version", "2.0");
	const vevent = new ICAL.Component("vevent");
	vevent.addPropertyWithValue("uid", uid);
	vevent.addPropertyWithValue("created", utcNow());
	root.addSubcomponent(vevent);
	applyDraft(vevent, draft, true);
	return { uid, ics: root.toString() };
}

/**
 * Applies the form values to a stored event and returns the new iCalendar text.
 * Start/end are only rewritten when they changed, so time zones of untouched events are kept.
 * Other properties (alarms, attendees, …) stay as they are.
 */
export function updateEventIcs(ics: string, draft: EventDraft, original: CalendarEvent): string {
	const root = new ICAL.Component(ICAL.parse(ics));
	const vevent = root.getAllSubcomponents("vevent").find((v) => !v.hasProperty("recurrence-id"));
	if (!vevent) throw new Error("The event could not be found in the calendar data.");
	const timesChanged =
		draft.allDay !== original.allDay ||
		draft.start.getTime() !== original.start.getTime() ||
		draft.end.getTime() !== original.end.getTime();
	applyDraft(vevent, draft, timesChanged);
	const sequence = Number(vevent.getFirstPropertyValue("sequence") ?? 0);
	vevent.updatePropertyWithValue("sequence", sequence + 1);
	return root.toString();
}

function applyDraft(vevent: ICAL.Component, draft: EventDraft, setTimes: boolean) {
	const now = utcNow();
	vevent.updatePropertyWithValue("dtstamp", now);
	vevent.updatePropertyWithValue("last-modified", now);
	vevent.updatePropertyWithValue("summary", draft.title);
	setOptionalText(vevent, "location", draft.location);
	setOptionalText(vevent, "description", draft.description);
	if (setTimes) {
		vevent.removeAllProperties("dtstart");
		vevent.removeAllProperties("dtend");
		vevent.removeAllProperties("duration");
		vevent.addPropertyWithValue("dtstart", toIcalTime(draft.start, draft.allDay));
		vevent.addPropertyWithValue("dtend", toIcalTime(draft.end, draft.allDay));
	}
}

function setOptionalText(vevent: ICAL.Component, name: string, value: string) {
	if (value) vevent.updatePropertyWithValue(name, value);
	else vevent.removeAllProperties(name);
}

function textProp(vevent: ICAL.Component, name: string): string {
	const value = vevent.getFirstPropertyValue(name);
	return typeof value === "string" ? value : "";
}
