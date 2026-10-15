import { moment } from "obsidian";
import { findByName } from "../../core/blocks";
import { CalDavApi } from "./CalDavApi";
import { HiddenCalendars } from "./CalendarView";

/** `api.calendar`: read access for scripts (DataviewJS, Templater). */
export function calendarApi(api: CalDavApi, hidden: HiddenCalendars) {
	return {
		/** All calendars with events. */
		async calendars() {
			return (await api.listCalendars()).map((c) => ({ name: c.name, color: c.color, readOnly: c.readOnly }));
		},

		/**
		 * Events from `from` (default: today) for `days` days (default 7), or up to `to`.
		 * `calendars`: names; default the ones shown in the calendar view. Recurring events come as single occurrences.
		 */
		async events(options: { from?: Date | string; to?: Date | string; days?: number; calendars?: string[] } = {}) {
			const all = await api.listCalendars();
			const hiddenPaths = hidden.get();
			const calendars = options.calendars?.length
				? options.calendars.map((n) => findByName(all, n, (c) => c.name, "Kalender"))
				: all.filter((c) => !hiddenPaths.has(c.path));
			const from = moment(options.from ?? moment().startOf("day"));
			const to = options.to ? moment(options.to) : from.clone().add(options.days ?? 7, "days");
			const lists = await Promise.all(calendars.map((c) => api.getEvents(c, from.toDate(), to.toDate())));
			return lists
				.flat()
				.sort((a, b) => a.start.getTime() - b.start.getTime())
				.map((e) => ({
					title: e.title,
					start: e.start,
					/** Exclusive; for all-day events midnight after the last day. */
					end: e.end,
					allDay: e.allDay,
					location: e.location,
					description: e.description,
					recurring: e.recurring,
					calendar: e.calendar.name,
				}));
		},
	};
}
