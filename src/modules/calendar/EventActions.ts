import { App, moment, Notice } from "obsidian";
import { isConflict } from "../../core/CalDav";
import { errorMessage } from "../../core/NextcloudClient";
import { confirmModal } from "../../core/ui";
import { CalDavApi, CalendarInfo } from "./CalDavApi";
import { chooseScope, EventDetailModal, EventFormModal } from "./EventModals";
import { CalendarEvent, createEventIcs, deleteRecurringIcs, EventDraft, readRecurrence, Scope, updateEventIcs, updateRecurringIcs } from "./ics";

/** Showing, creating, editing and deleting events (incl. recurring ones). Calls `changed` afterwards. */
export class EventActions {
	constructor(
		private app: App,
		private api: CalDavApi,
		/** Calendars a new event can go to, preferred first. */
		private writableCalendars: () => CalendarInfo[],
		private changed: () => void
	) {}

	/** The details of an event, with buttons to edit or delete it. */
	open(event: CalendarEvent) {
		new EventDetailModal(this.app, event, {
			edit: () => this.edit(event),
			delete: () => this.delete(event),
		}).open();
	}

	create(start: moment.Moment) {
		const calendars = this.writableCalendars();
		if (!calendars.length) {
			new Notice("Es gibt keinen beschreibbaren Kalender.");
			return;
		}
		const draft: EventDraft = {
			title: "",
			start: start.toDate(),
			end: start.clone().add(1, "hour").toDate(),
			allDay: false,
			location: "",
			description: "",
		};
		new EventFormModal(this.app, {
			heading: "Neuer Termin",
			draft,
			calendar: calendars[0],
			calendars,
			rule: null,
			save: async (draft, calendar, rule) => {
				const { uid, ics } = createEventIcs(draft, rule);
				await this.api.saveEvent(`${calendar.path}${uid}.ics`, ics);
				new Notice("Termin angelegt.");
				this.changed();
			},
		}).open();
	}

	private async edit(event: CalendarEvent) {
		const scope = event.recurring ? await chooseScope(this.app, "Wiederkehrenden Termin bearbeiten") : null;
		if (event.recurring && !scope) return;
		let source: { ics: string; etag: string };
		try {
			source = await this.api.getEventSource(event.path);
		} catch (e) {
			new Notice(`Termin konnte nicht geladen werden: ${errorMessage(e)}`, 8000);
			return;
		}
		// "This event" edits a single occurrence, so its form has no "Repeat" settings.
		const rule = scope === "this" ? undefined : readRecurrence(source.ics, scope === "following" ? event : undefined);

		new EventFormModal(this.app, {
			heading: scope === "this" ? "Diesen Termin bearbeiten" : scope === "following" ? "Diesen und folgende bearbeiten" : scope === "all" ? "Alle Termine bearbeiten" : "Termin bearbeiten",
			draft: { title: event.title, start: event.start, end: event.end, allDay: event.allDay, location: event.location, description: event.description },
			calendar: event.calendar,
			rule,
			save: async (draft, _calendar, rule) => {
				const latest = await this.latestSource(event);
				if (!scope) {
					await this.api.saveEvent(event.path, updateEventIcs(latest.ics, draft, event, rule), latest.etag);
				} else {
					const result = updateRecurringIcs(latest.ics, draft, event, scope, rule);
					await this.api.saveEvent(event.path, result.ics, latest.etag);
					if (result.created) await this.api.saveEvent(`${event.calendar.path}${result.created.uid}.ics`, result.created.ics);
				}
				new Notice("Termin gespeichert.");
				this.changed();
			},
		}).open();
	}

	/** The stored event, after asking whether to overwrite if it changed since the calendar was loaded. */
	private async latestSource(event: CalendarEvent): Promise<{ ics: string; etag: string }> {
		const source = await this.api.getEventSource(event.path);
		if (source.etag !== event.etag) {
			const overwrite = await confirmModal(
				this.app,
				"Termin wurde woanders geändert",
				"Dieser Termin wurde woanders geändert, nachdem der Kalender geladen wurde. Speichern überschreibt diese Änderungen.",
				"Überschreiben"
			);
			if (!overwrite) throw new Error("abgebrochen, weil der Termin woanders geändert wurde");
		}
		return source;
	}

	private async delete(event: CalendarEvent) {
		let scope: Scope | null = null;
		if (event.recurring) {
			scope = await chooseScope(this.app, "Wiederkehrenden Termin löschen");
			if (!scope) return;
		} else {
			const confirmed = await confirmModal(this.app, "Termin löschen", `"${event.title || "(Ohne Titel)"}" löschen?`, "Löschen");
			if (!confirmed) return;
		}
		try {
			if (!scope || scope === "all") {
				await this.api.deleteEvent(event.path, event.etag);
			} else {
				const latest = await this.latestSource(event);
				const ics = deleteRecurringIcs(latest.ics, event, scope);
				if (ics === null) await this.api.deleteEvent(event.path, latest.etag);
				else await this.api.saveEvent(event.path, ics, latest.etag);
			}
			new Notice("Termin gelöscht.");
		} catch (e) {
			new Notice(isConflict(e) ? "Der Termin wurde woanders geändert. Bitte neu laden und erneut versuchen." : `Termin konnte nicht gelöscht werden: ${errorMessage(e)}`, 8000);
		}
		this.changed();
	}
}

/** Whether the event takes place (at least partly) on the given day. */
export function overlapsDay(event: CalendarEvent, day: moment.Moment): boolean {
	const start = day.valueOf();
	const end = day.clone().add(1, "day").valueOf();
	const eventEnd = Math.max(event.end.getTime(), event.start.getTime() + 1); // zero-length events still show
	return event.start.getTime() < end && eventEnd > start;
}
