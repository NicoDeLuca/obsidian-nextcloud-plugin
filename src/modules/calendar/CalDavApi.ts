import { NextcloudClient } from "../../core/NextcloudClient";
import { CalendarEvent, parseEvents } from "./ics";

export interface CalendarInfo {
	/** Path of the calendar collection, usable with NextcloudClient.request(). */
	path: string;
	name: string;
	color: string;
	readOnly: boolean;
}

const NS = {
	dav: "DAV:",
	caldav: "urn:ietf:params:xml:ns:caldav",
	apple: "http://apple.com/ns/ical/",
};

export class CalDavApi {
	constructor(private client: NextcloudClient) {}

	/** All calendars of the user that can hold events (task-only lists are skipped). */
	async listCalendars(): Promise<CalendarInfo[]> {
		const { id } = await this.client.getCurrentUser();
		const res = await this.client.request("PROPFIND", `/remote.php/dav/calendars/${encodeURIComponent(id)}/`, {
			headers: { Depth: "1", Accept: "application/xml" },
			contentType: "application/xml; charset=utf-8",
			body: `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
	<d:prop>
		<d:resourcetype/>
		<d:displayname/>
		<a:calendar-color/>
		<c:supported-calendar-component-set/>
		<d:current-user-privilege-set/>
	</d:prop>
</d:propfind>`,
		});

		const calendars: CalendarInfo[] = [];
		for (const response of responses(res.text)) {
			const prop = okProp(response);
			if (!prop?.getElementsByTagNameNS(NS.caldav, "calendar").length) continue;
			const components = Array.from(prop.getElementsByTagNameNS(NS.caldav, "comp")).map((c) => c.getAttribute("name"));
			if (components.length && !components.includes("VEVENT")) continue;
			calendars.push({
				path: this.client.hrefToPath(text(response, NS.dav, "href")),
				name: text(prop, NS.dav, "displayname") || "Calendar",
				color: text(prop, NS.apple, "calendar-color") || "var(--interactive-accent)",
				readOnly: !["write", "write-content", "all"].some((p) => prop.getElementsByTagNameNS(NS.dav, p).length),
			});
		}
		return calendars;
	}

	/** Events overlapping [start, end); recurring events are expanded into single occurrences by the server. */
	async getEvents(calendar: CalendarInfo, start: Date, end: Date): Promise<CalendarEvent[]> {
		const range = `start="${utc(start)}" end="${utc(end)}"`;
		const res = await this.client.request("REPORT", calendar.path, {
			headers: { Depth: "1", Accept: "application/xml" },
			contentType: "application/xml; charset=utf-8",
			body: `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:prop>
		<d:getetag/>
		<c:calendar-data><c:expand ${range}/></c:calendar-data>
	</d:prop>
	<c:filter>
		<c:comp-filter name="VCALENDAR">
			<c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter>
		</c:comp-filter>
	</c:filter>
</c:calendar-query>`,
		});

		const events: CalendarEvent[] = [];
		for (const response of responses(res.text)) {
			const prop = okProp(response);
			const data = prop && text(prop, NS.caldav, "calendar-data");
			if (!data) continue;
			const path = this.client.hrefToPath(text(response, NS.dav, "href"));
			events.push(...parseEvents(data, calendar, path, text(prop, NS.dav, "getetag")));
		}
		return events;
	}

	/** The stored iCalendar object of an event, for editing. */
	async getEventSource(path: string): Promise<{ ics: string; etag: string }> {
		const res = await this.client.request("GET", path, { headers: { Accept: "text/calendar" } });
		return { ics: res.text, etag: header(res.headers, "etag") };
	}

	/** Creates (no etag) or updates (with etag) an event. Updating fails with HTTP 412 if it changed meanwhile. */
	async saveEvent(path: string, ics: string, etag?: string): Promise<void> {
		await this.client.request("PUT", path, {
			body: ics,
			contentType: "text/calendar; charset=utf-8",
			headers: etag ? { "If-Match": etag } : { "If-None-Match": "*" },
		});
	}

	async deleteEvent(path: string, etag: string): Promise<void> {
		await this.client.request("DELETE", path, { headers: { "If-Match": etag } });
	}
}

function responses(xml: string): Element[] {
	const doc = new DOMParser().parseFromString(xml, "application/xml");
	return Array.from(doc.getElementsByTagNameNS(NS.dav, "response"));
}

/** The <prop> of the propstat with status 200 (properties the server doesn't have come in a separate 404 propstat). */
function okProp(response: Element): Element | null {
	for (const propstat of Array.from(response.getElementsByTagNameNS(NS.dav, "propstat"))) {
		if (/\s200\s/.test(text(propstat, NS.dav, "status"))) return propstat.getElementsByTagNameNS(NS.dav, "prop")[0] ?? null;
	}
	return null;
}

function text(el: Element, ns: string, name: string): string {
	return el.getElementsByTagNameNS(ns, name)[0]?.textContent?.trim() ?? "";
}

function header(headers: Record<string, string>, name: string): string {
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
	return key ? headers[key] : "";
}

/** 2026-10-14T08:00:00.000Z → 20261014T080000Z */
function utc(date: Date): string {
	return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
