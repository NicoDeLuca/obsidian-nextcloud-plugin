import { ActivityApi } from "./ActivityApi";

/** `api.activity`: the activity stream for scripts. */
export function activityApi(api: ActivityApi) {
	return {
		/** Available filters (id and name). */
		filters: () => api.getFilters(),

		/** Newest first; `filter` is a filter id (default "all"), `limit` at most 50. */
		async activities(options: { filter?: string; limit?: number } = {}) {
			const page = await api.getActivities(options.filter ?? "all");
			return page.activities.slice(0, Math.min(options.limit ?? 50, 50)).map((a) => ({
				date: a.date,
				subject: a.subjectRich ? a.subjectRich.text.replace(/\{([^{}]+)\}/g, (m, key) => a.subjectRich!.params[key]?.name ?? m) : a.subject,
				message: a.message,
				link: a.link,
			}));
		},
	};
}
