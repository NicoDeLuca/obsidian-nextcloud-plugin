import { App } from "obsidian";
import { BlockDefinition, BlockWidget, findByName, Options } from "../../core/blocks";
import { DavCalendar } from "../../core/CalDav";
import { loadTasks, renderQuickAdd, renderTasks, TaskActions } from "./TaskList";
import { TasksApi } from "./TasksApi";

/**
 * ```nextcloud-aufgaben
 * ansicht: heute        # heute | alle
 * liste: Einkauf        # eine oder mehrere Listen (Standard: alle)
 * erledigte: nein
 * max: 10
 * hinzufuegen: ja
 * ```
 */
export function tasksBlock(api: TasksApi): BlockDefinition {
	return {
		language: "nextcloud-aufgaben",
		title: "Aufgaben",
		template: "ansicht: heute",
		keys: ["titel", "ansicht", "liste", "erledigte", "max", "hinzufuegen"],
		create: (el, options, host) => new TasksBlock(el, host.app, options, api),
	};
}

class TasksBlock extends BlockWidget {
	private actions: TaskActions;
	private quickAddList: DavCalendar | null = null;
	private listNames: string[];
	private today: boolean;

	constructor(el: HTMLElement, app: App, options: Options, private api: TasksApi) {
		const listNames = options.list("liste");
		// With lists named, "all tasks of these lists" is the natural default.
		const today = options.choice("ansicht", ["heute", "alle"], listNames.length ? "alle" : "heute") === "heute";
		super(el, app, options, `Aufgaben · ${today ? "Heute" : listNames.join(", ") || "Alle"}`);
		this.listNames = listNames;
		this.today = today;
		this.actions = new TaskActions(app, api, () => this.refresh());
	}

	protected async update(body: HTMLElement, isCurrent: () => boolean) {
		const all = await this.api.listLists();
		const lists = this.listNames.length ? this.listNames.map((name) => findByName(all, name, (l) => l.name, "Aufgabenliste")) : all;
		const tasks = await loadTasks(this.api, lists, { completed: this.options.boolean("erledigte", false), today: this.today }, isCurrent);
		if (!isCurrent()) return;
		renderTasks(body, tasks, this.actions, {
			showList: lists.length > 1,
			empty: this.today ? "Heute ist nichts fällig." : "Keine Aufgaben.",
			max: this.options.number("max", 0, 0, 500),
		});
		this.renderQuickAdd(lists.find((l) => !l.readOnly) ?? null);
	}

	/** Drawn once (outside the redrawn body), so it keeps its focus for adding several tasks. */
	private renderQuickAdd(list: DavCalendar | null) {
		if (!this.options.boolean("hinzufuegen", true) || !list || list.path === this.quickAddList?.path) return;
		this.quickAddList = list;
		this.footerEl.empty();
		renderQuickAdd(this.footerEl, list, (title) => this.actions.create(list, title, this.today));
	}
}
