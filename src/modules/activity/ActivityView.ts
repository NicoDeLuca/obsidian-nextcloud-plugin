import { ButtonComponent, DropdownComponent, ItemView, moment, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { Activity, ActivityApi, ActivityFilter } from "./ActivityApi";

export const ACTIVITY_VIEW = "nextcloud-activity";

interface ActivityViewState {
	filter?: string;
}

export class ActivityView extends ItemView {
	private filter = "all";
	private filters: ActivityFilter[] | null = null;
	private loadId = 0;
	private toolbarEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private listEl: HTMLElement | null = null;
	/** Day heading of the last rendered entry, so "Load more" continues the same group. */
	private lastDay = "";

	constructor(leaf: WorkspaceLeaf, private api: ActivityApi) {
		super(leaf);
	}

	getViewType() {
		return ACTIVITY_VIEW;
	}

	getDisplayText() {
		return "Aktivität";
	}

	getIcon() {
		return "activity";
	}

	getState(): Record<string, unknown> {
		return { filter: this.filter };
	}

	async setState(state: unknown, result: ViewStateResult) {
		const { filter } = (state ?? {}) as ActivityViewState;
		if (filter) this.filter = filter;
		await super.setState(state, result);
		await this.loadFeed();
	}

	async onOpen() {
		this.contentEl.addClass("nc-activity");
		this.toolbarEl = this.contentEl.createDiv({ cls: "nc-cal-toolbar" });
		this.bodyEl = this.contentEl.createDiv({ cls: "nc-tasks-body" });
		await this.loadFeed();
	}

	private async loadFeed() {
		if (!this.bodyEl) return; // setState can run before onOpen
		const loadId = ++this.loadId;
		this.bodyEl.empty();
		this.bodyEl.createEl("p", { text: "Wird geladen …", cls: "nc-cookbook-status" });
		try {
			// Filters are optional: older servers or a failing request just leave "All".
			if (!this.filters) this.filters = await this.api.getFilters().catch(() => []);
			if (loadId !== this.loadId) return;
			this.renderToolbar();
			const page = await this.api.getActivities(this.filter);
			if (loadId !== this.loadId) return;
			this.bodyEl.empty();
			this.lastDay = "";
			if (!page.activities.length) {
				this.bodyEl.createEl("p", { text: "Keine Aktivitäten.", cls: "nc-cookbook-status" });
				return;
			}
			this.listEl = this.bodyEl.createDiv({ cls: "nc-activity-list" });
			this.appendPage(page.activities, page.next, loadId);
		} catch (e) {
			if (loadId !== this.loadId) return;
			this.bodyEl.empty();
			this.bodyEl.createEl("p", { text: `Aktivitäten konnten nicht geladen werden: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
		}
	}

	private renderToolbar() {
		const bar = this.toolbarEl;
		bar.empty();
		const dropdown = new DropdownComponent(bar);
		const filters = this.filters?.length ? this.filters : [{ id: "all", name: "Alle Aktivitäten" }];
		for (const f of filters) dropdown.addOption(f.id, f.name);
		if (!filters.some((f) => f.id === this.filter)) this.filter = filters[0].id;
		dropdown.setValue(this.filter).onChange((filter) => {
			this.filter = filter;
			this.app.workspace.requestSaveLayout();
			this.loadFeed();
		});
		new ButtonComponent(bar.createDiv({ cls: "nc-cal-toolbar-group" }))
			.setIcon("refresh-cw")
			.setTooltip("Neu laden")
			.onClick(() => this.loadFeed());
	}

	private appendPage(activities: Activity[], next: number | null, loadId: number) {
		const list = this.listEl!;
		for (const activity of activities) {
			const day = dayLabel(activity.date);
			if (day !== this.lastDay) {
				list.createDiv({ cls: "nc-activity-day", text: day });
				this.lastDay = day;
			}
			this.renderActivity(list, activity);
		}
		if (next === null) return;

		const more = list.createDiv({ cls: "nc-activity-more" });
		new ButtonComponent(more).setButtonText("Mehr laden").onClick(async () => {
			more.empty();
			more.createSpan({ text: "Wird geladen …", cls: "nc-cookbook-status" });
			try {
				const page = await this.api.getActivities(this.filter, next);
				if (loadId !== this.loadId) return;
				more.remove();
				this.appendPage(page.activities, page.next, loadId);
			} catch (e) {
				more.empty();
				more.createSpan({ text: `Weitere konnten nicht geladen werden: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
			}
		});
	}

	private renderActivity(parent: HTMLElement, activity: Activity) {
		const row = parent.createDiv({ cls: "nc-activity-item" });
		const iconEl = row.createDiv({ cls: "nc-activity-icon" });
		if (activity.icon) iconEl.createEl("img", { attr: { src: activity.icon, alt: "" } });

		const main = row.createDiv({ cls: "nc-activity-main" });
		const subject = main.createDiv({ cls: "nc-activity-subject" });
		renderSubject(subject, activity);
		if (activity.message) main.createDiv({ cls: "nc-activity-message", text: activity.message });
		main.createDiv({ cls: "nc-task-meta", text: moment(activity.date).format("LT") });

		if (activity.link) {
			row.addClass("is-link");
			row.setAttr("title", "In Nextcloud öffnen");
			row.addEventListener("click", () => window.open(activity.link, "_blank"));
		}
	}
}

/** Renders "{user} changed {file}" with the parameters highlighted; falls back to the plain subject. */
function renderSubject(el: HTMLElement, activity: Activity) {
	const rich = activity.subjectRich;
	if (!rich) {
		el.setText(activity.subject);
		return;
	}
	for (const part of rich.text.split(/(\{[^{}]+\})/)) {
		const key = part.match(/^\{([^{}]+)\}$/)?.[1];
		const param = key ? rich.params[key] : undefined;
		if (!param) {
			if (part) el.appendText(part);
			continue;
		}
		el.createSpan({ cls: `nc-activity-param is-${param.type ?? "other"}`, text: param.name });
	}
}

function dayLabel(date: Date): string {
	const days = moment().startOf("day").diff(moment(date).startOf("day"), "days");
	if (days === 0) return "Heute";
	if (days === 1) return "Gestern";
	return moment(date).format("dddd, ll");
}
