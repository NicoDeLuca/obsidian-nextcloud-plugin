import { NextcloudClient } from "../../core/NextcloudClient";

const BASE = "/ocs/v2.php/apps/activity/api/v2/activity";
const PAGE_SIZE = 50;

export interface ActivityFilter {
	id: string;
	name: string;
}

/** A rich-text parameter, e.g. a user or a file mentioned in the subject. */
export interface RichParameter {
	type?: string;
	name: string;
	link?: string;
}

export interface Activity {
	id: number;
	date: Date;
	/** Plain subject, used when there is no rich subject. */
	subject: string;
	/** Subject with {placeholders} and their values, if the server sends one. */
	subjectRich: { text: string; params: Record<string, RichParameter> } | null;
	message: string;
	icon: string;
	link: string;
}

export class ActivityApi {
	constructor(private client: NextcloudClient) {}

	async getFilters(): Promise<ActivityFilter[]> {
		const res = await this.client.get(`${BASE}/filters?format=json`);
		return (res.json.ocs.data as Array<{ id: string; name: string; priority?: number }>)
			.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
			.map((f) => ({ id: f.id, name: f.name }));
	}

	/**
	 * One page of the stream, newest first. `next` is the value to pass as `since`
	 * for the following page, or null at the end.
	 */
	async getActivities(filter: string, since?: number): Promise<{ activities: Activity[]; next: number | null }> {
		const params = `format=json&limit=${PAGE_SIZE}${since ? `&since=${since}` : ""}`;
		const res = await this.client.get(`${BASE}/${encodeURIComponent(filter)}?${params}`);
		// 204: the user switched all activities off; 304: nothing (more) to show.
		if (res.status === 204 || res.status === 304 || !res.text) return { activities: [], next: null };
		const activities = (res.json.ocs.data as Array<Record<string, any>>).map(toActivity);
		const lastGiven = Number(header(res.headers, "x-activity-last-given"));
		const next = activities.length === PAGE_SIZE && lastGiven ? lastGiven : null;
		return { activities, next };
	}
}

function toActivity(a: Record<string, any>): Activity {
	const rich = a.subject_rich;
	const richText = rich?.[0];
	return {
		id: a.activity_id,
		date: new Date(a.datetime),
		subject: a.subject ?? "",
		subjectRich: typeof richText === "string" && richText ? { text: richText, params: rich[1] && !Array.isArray(rich[1]) ? rich[1] : {} } : null,
		message: a.message ?? "",
		icon: a.icon ?? "",
		link: a.link ?? "",
	};
}

function header(headers: Record<string, string>, name: string): string {
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
	return key ? headers[key] : "";
}
