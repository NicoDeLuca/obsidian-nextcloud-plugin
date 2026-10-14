import { CalDav, DavCalendar, utc } from "../../core/CalDav";
import { NextcloudClient } from "../../core/NextcloudClient";
import { CalendarEvent, parseEvents } from "./ics";

export type CalendarInfo = DavCalendar;

/** Event-specific CalDAV access on top of the shared core CalDav. */
export class CalDavApi {
	private dav: CalDav;

	constructor(client: NextcloudClient) {
		this.dav = new CalDav(client);
	}

	/** All calendars of the user that can hold events (task-only lists are skipped). */
	listCalendars(): Promise<CalendarInfo[]> {
		return this.dav.listCalendars("VEVENT");
	}

	/** Events overlapping [start, end); recurring events are expanded into single occurrences by the server. */
	async getEvents(calendar: CalendarInfo, start: Date, end: Date): Promise<CalendarEvent[]> {
		const range = `start="${utc(start)}" end="${utc(end)}"`;
		const objects = await this.dav.query(
			calendar,
			`<c:calendar-data><c:expand ${range}/></c:calendar-data>`,
			`<c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter>`
		);
		return objects.flatMap((o) => parseEvents(o.data, calendar, o.path, o.etag));
	}

	/** The stored iCalendar object of an event, for editing. */
	getEventSource(path: string): Promise<{ ics: string; etag: string }> {
		return this.dav.getObject(path);
	}

	/** Creates (no etag) or updates (with etag) an event. Updating fails with HTTP 412 if it changed meanwhile. */
	saveEvent(path: string, ics: string, etag?: string): Promise<void> {
		return this.dav.saveObject(path, ics, etag);
	}

	deleteEvent(path: string, etag: string): Promise<void> {
		return this.dav.deleteObject(path, etag);
	}
}
