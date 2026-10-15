import { App } from "obsidian";
import { BlockDefinition, BlockWidget, findByName, Options } from "../../core/blocks";
import { ActivityApi } from "./ActivityApi";
import { dayLabel, renderActivity } from "./ActivityView";

/**
 * ```nextcloud-aktivitaet
 * filter: Dateien   # Name oder Kennung eines Filters der Aktivitäten-App (Standard: alle)
 * max: 10
 * ```
 */
export function activityBlock(api: ActivityApi): BlockDefinition {
	return {
		language: "nextcloud-aktivitaet",
		title: "Aktivitäten",
		template: "max: 10",
		keys: ["titel", "filter", "max"],
		create: (el, options, host) => new ActivityBlock(el, host.app, options, api),
	};
}

class ActivityBlock extends BlockWidget {
	constructor(el: HTMLElement, app: App, options: Options, private api: ActivityApi) {
		super(el, app, options, ["Aktivitäten", options.string("filter")].filter(Boolean).join(" · "));
	}

	protected async update(body: HTMLElement, isCurrent: () => boolean) {
		const max = this.options.number("max", 10, 1, 50);
		let filter = "all";
		const wanted = this.options.string("filter");
		if (wanted) {
			const filters = await this.api.getFilters();
			filter = (filters.find((f) => f.id === wanted) ?? findByName(filters, wanted, (f) => f.name, "Filter")).id;
		}
		const page = await this.api.getActivities(filter);
		if (!isCurrent()) return;
		const activities = page.activities.slice(0, max);
		if (!activities.length) {
			body.createEl("p", { text: "Keine Aktivitäten.", cls: "nc-cookbook-status" });
			return;
		}
		const list = body.createDiv({ cls: "nc-activity-list" });
		let lastDay = "";
		for (const activity of activities) {
			const day = dayLabel(activity.date);
			if (day !== lastDay) list.createDiv({ cls: "nc-activity-day", text: day });
			lastDay = day;
			renderActivity(list, activity);
		}
	}
}
