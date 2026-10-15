import { NextcloudClient } from "./NextcloudClient";

/** A calendar collection: holds events (VEVENT), tasks (VTODO) or both. */
export interface DavCalendar {
	/** Path of the collection, usable with NextcloudClient.request(). */
	path: string;
	name: string;
	color: string;
	readOnly: boolean;
}

/** One stored iCalendar object (an .ics resource). */
export interface DavObject {
	path: string;
	etag: string;
	data: string;
}

const NS = {
	dav: "DAV:",
	caldav: "urn:ietf:params:xml:ns:caldav",
	apple: "http://apple.com/ns/ical/",
};

/** CalDAV access shared by the modules for calendars and tasks. */
export class CalDav {
	constructor(private client: NextcloudClient) {}

	/** The user's calendar collections that can hold the given component type. */
	async listCalendars(component: "VEVENT" | "VTODO"): Promise<DavCalendar[]> {
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

		const calendars: DavCalendar[] = [];
		for (const response of responses(res.text)) {
			const prop = okProp(response);
			if (!prop?.getElementsByTagNameNS(NS.caldav, "calendar").length) continue;
			const components = Array.from(prop.getElementsByTagNameNS(NS.caldav, "comp")).map((c) => c.getAttribute("name"));
			if (components.length && !components.includes(component)) continue;
			calendars.push({
				path: this.client.hrefToPath(text(response, NS.dav, "href")),
				name: text(prop, NS.dav, "displayname") || (component === "VTODO" ? "Tasks" : "Calendar"),
				color: text(prop, NS.apple, "calendar-color") || "var(--interactive-accent)",
				readOnly: !["write", "write-content", "all"].some((p) => prop.getElementsByTagNameNS(NS.dav, p).length),
			});
		}
		return calendars;
	}

	/**
	 * A calendar-query REPORT on one collection.
	 * @param calendarData the <c:calendar-data> element (e.g. with <c:expand>)
	 * @param filter the content of the VCALENDAR comp-filter
	 */
	async query(calendar: DavCalendar, calendarData: string, filter: string): Promise<DavObject[]> {
		const res = await this.client.request("REPORT", calendar.path, {
			headers: { Depth: "1", Accept: "application/xml" },
			contentType: "application/xml; charset=utf-8",
			body: `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
	<d:prop>
		<d:getetag/>
		${calendarData}
	</d:prop>
	<c:filter>
		<c:comp-filter name="VCALENDAR">${filter}</c:comp-filter>
	</c:filter>
</c:calendar-query>`,
		});

		const objects: DavObject[] = [];
		for (const response of responses(res.text)) {
			const prop = okProp(response);
			const data = prop && text(prop, NS.caldav, "calendar-data");
			if (!data) continue;
			objects.push({
				path: this.client.hrefToPath(text(response, NS.dav, "href")),
				etag: text(prop, NS.dav, "getetag"),
				data,
			});
		}
		return objects;
	}

	/** The stored iCalendar object, for editing. */
	async getObject(path: string): Promise<{ ics: string; etag: string }> {
		const res = await this.client.request("GET", path, { headers: { Accept: "text/calendar" } });
		return { ics: res.text, etag: header(res.headers, "etag") };
	}

	/** Creates (no etag) or updates (with etag) an object. Updating fails with HTTP 412 if it changed meanwhile. */
	async saveObject(path: string, ics: string, etag?: string): Promise<void> {
		await this.client.request("PUT", path, {
			body: ics,
			contentType: "text/calendar; charset=utf-8",
			headers: etag ? { "If-Match": etag } : { "If-None-Match": "*" },
		});
	}

	async deleteObject(path: string, etag: string): Promise<void> {
		await this.client.request("DELETE", path, { headers: { "If-Match": etag } });
	}
}

/** 2026-10-14T08:00:00.000Z → 20261014T080000Z */
export function utc(date: Date): string {
	return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** True for the HTTP 412 a save/delete gets when the object changed since it was loaded. */
export function isConflict(e: unknown): boolean {
	return !!e && typeof e === "object" && "status" in e && (e as { status: number }).status === 412;
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
