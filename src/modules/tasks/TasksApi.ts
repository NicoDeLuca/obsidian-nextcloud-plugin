import { CalDav, DavCalendar } from "../../core/CalDav";
import { NextcloudClient } from "../../core/NextcloudClient";
import { parseTasks, Task } from "./vtodo";

/** Task-specific CalDAV access on top of the shared core CalDav. */
export class TasksApi {
	private dav: CalDav;

	constructor(client: NextcloudClient) {
		this.dav = new CalDav(client);
	}

	/** The user's task lists (calendar collections that can hold VTODOs). */
	listLists(): Promise<DavCalendar[]> {
		return this.dav.listCalendars("VTODO");
	}

	/** Tasks of one list; completed ones are filtered out on the server unless requested. */
	async getTasks(list: DavCalendar, includeCompleted: boolean): Promise<Task[]> {
		const filter = includeCompleted
			? `<c:comp-filter name="VTODO"/>`
			: `<c:comp-filter name="VTODO"><c:prop-filter name="COMPLETED"><c:is-not-defined/></c:prop-filter></c:comp-filter>`;
		const objects = await this.dav.query(list, "<c:calendar-data/>", filter);
		const tasks = objects.flatMap((o) => parseTasks(o.data, list, o.path, o.etag));
		return includeCompleted ? tasks : tasks.filter((t) => !t.completed);
	}

	getSource(path: string): Promise<{ ics: string; etag: string }> {
		return this.dav.getObject(path);
	}

	save(path: string, ics: string, etag?: string): Promise<void> {
		return this.dav.saveObject(path, ics, etag);
	}

	delete(path: string, etag: string): Promise<void> {
		return this.dav.deleteObject(path, etag);
	}
}
