import { App } from "obsidian";
import { NextcloudModule } from "../../core/types";
import { CalDavApi } from "./CalDavApi";
import { CALENDAR_VIEW, CalendarView, HiddenCalendars } from "./CalendarView";

interface CalendarData {
	hiddenCalendars?: string[];
}

export const calendarModule: NextcloudModule = {
	id: "calendar",
	name: "Calendar",
	description: "View and edit events from Nextcloud Calendar (CalDAV).",
	load(ctx) {
		const app = ctx.plugin.app;
		const api = new CalDavApi(ctx.client);
		const hidden: HiddenCalendars = {
			get: () => new Set(ctx.loadData<CalendarData>()?.hiddenCalendars ?? []),
			set: (paths) => ctx.saveData({ ...ctx.loadData<CalendarData>(), hiddenCalendars: [...paths] }),
		};

		ctx.registerView(CALENDAR_VIEW, (leaf) => new CalendarView(leaf, api, hidden));
		ctx.addRibbonIcon("calendar-days", "Open calendar", () => openCalendar(app));
		ctx.addCommand({
			id: "calendar-open",
			name: "Open calendar",
			callback: () => openCalendar(app),
		});
	},
};

async function openCalendar(app: App) {
	const existing = app.workspace.getLeavesOfType(CALENDAR_VIEW)[0];
	const leaf = existing ?? app.workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: CALENDAR_VIEW, active: true });
	await app.workspace.revealLeaf(leaf);
}
