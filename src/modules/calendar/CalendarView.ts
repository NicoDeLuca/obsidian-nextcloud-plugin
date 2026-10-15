import { ButtonComponent, DropdownComponent, ItemView, Menu, moment, Notice, Platform, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { isConflict } from "../../core/CalDav";
import { errorMessage } from "../../core/NextcloudClient";
import { CalDavApi, CalendarInfo } from "./CalDavApi";
import { confirmModal } from "../../core/ui";
import { chooseScope, EventDetailModal, EventFormModal } from "./EventModals";
import { CalendarEvent, createEventIcs, deleteRecurringIcs, EventDraft, readRecurrence, Scope, updateEventIcs, updateRecurringIcs } from "./ics";
import { layoutDay } from "./layout";

export const CALENDAR_VIEW = "nextcloud-calendar";

type Mode = "day" | "3days" | "5days" | "week" | "month";
const MODES: Record<Mode, string> = { day: "Tag", "3days": "3 Tage", "5days": "5 Tage", week: "Woche", month: "Monat" };
const DAYS: Record<Exclude<Mode, "month">, number> = { day: 1, "3days": 3, "5days": 5, week: 7 };

const HOUR_PX = 48;
const MONTH_CHIPS = 3;

interface CalendarViewState {
	mode?: Mode;
	/** YYYY-MM-DD of the day the view is anchored on. */
	date?: string;
}

/** Remembers which calendars are hidden (module data, so it survives restarts). */
export interface HiddenCalendars {
	get(): Set<string>;
	set(paths: Set<string>): Promise<void>;
}

export class CalendarView extends ItemView {
	private mode: Mode = Platform.isPhone ? "day" : "week";
	private date = moment().startOf("day");
	private calendars: CalendarInfo[] | null = null;
	private loadId = 0;
	private toolbarEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private nowLine: { el: HTMLElement; day: moment.Moment } | null = null;

	constructor(leaf: WorkspaceLeaf, private api: CalDavApi, private hidden: HiddenCalendars) {
		super(leaf);
	}

	getViewType() {
		return CALENDAR_VIEW;
	}

	getDisplayText() {
		return "Kalender";
	}

	getIcon() {
		return "calendar-days";
	}

	getState(): Record<string, unknown> {
		return { mode: this.mode, date: this.date.format("YYYY-MM-DD") };
	}

	async setState(state: unknown, result: ViewStateResult) {
		const { mode, date } = (state ?? {}) as CalendarViewState;
		if (mode && mode in MODES) this.mode = mode;
		if (date && moment(date, "YYYY-MM-DD", true).isValid()) this.date = moment(date, "YYYY-MM-DD");
		await super.setState(state, result);
		await this.loadEvents();
	}

	async onOpen() {
		this.contentEl.addClass("nc-cal");
		this.toolbarEl = this.contentEl.createDiv({ cls: "nc-cal-toolbar" });
		this.bodyEl = this.contentEl.createDiv({ cls: "nc-cal-body" });
		this.registerInterval(window.setInterval(() => this.positionNowLine(), 60_000));
		await this.loadEvents();
	}

	/** Re-fetches calendars and events for the visible range and redraws. */
	async reload() {
		this.calendars = null;
		await this.loadEvents();
	}

	private navigate(step: number) {
		if (this.mode === "month") this.date = this.date.clone().add(step, "month");
		else this.date = this.date.clone().add(step * DAYS[this.mode], "days");
		this.changed();
	}

	private changed() {
		this.app.workspace.requestSaveLayout();
		this.loadEvents();
	}

	/** First visible day and the day after the last visible one. */
	private range(): [moment.Moment, moment.Moment] {
		if (this.mode === "month") {
			const start = this.date.clone().startOf("month").startOf("isoWeek");
			const end = this.date.clone().endOf("month").endOf("isoWeek").add(1, "ms");
			return [start, end];
		}
		const start = this.mode === "week" ? this.date.clone().startOf("isoWeek") : this.date.clone();
		return [start, start.clone().add(DAYS[this.mode], "days")];
	}

	private async loadEvents() {
		if (!this.bodyEl) return; // setState can run before onOpen
		const loadId = ++this.loadId;
		const [start, end] = this.range();
		this.renderToolbar(start, end);
		this.bodyEl.empty();
		this.bodyEl.createEl("p", { text: "Wird geladen …", cls: "nc-cookbook-status" });

		let events: CalendarEvent[] = [];
		try {
			if (!this.calendars) this.calendars = await this.api.listCalendars();
			const hidden = this.hidden.get();
			const visible = this.calendars.filter((c) => !hidden.has(c.path));
			const results = await Promise.allSettled(visible.map((c) => this.api.getEvents(c, start.toDate(), end.toDate())));
			results.forEach((r, i) => {
				if (r.status === "fulfilled") events.push(...r.value);
				else if (loadId === this.loadId) new Notice(`"${visible[i].name}" konnte nicht geladen werden: ${errorMessage(r.reason)}`);
			});
		} catch (e) {
			if (loadId !== this.loadId) return;
			this.bodyEl.empty();
			this.bodyEl.createEl("p", { text: `Kalender konnten nicht geladen werden: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
			return;
		}
		if (loadId !== this.loadId) return;

		events = events.sort((a, b) => a.start.getTime() - b.start.getTime());
		this.bodyEl.empty();
		this.nowLine = null;
		if (this.mode === "month") this.renderMonth(start, end, events);
		else this.renderDays(start, DAYS[this.mode], events);
	}

	private renderToolbar(start: moment.Moment, end: moment.Moment) {
		const bar = this.toolbarEl;
		bar.empty();
		const nav = bar.createDiv({ cls: "nc-cal-toolbar-group" });
		new ButtonComponent(nav).setButtonText("Heute").onClick(() => {
			this.date = moment().startOf("day");
			this.changed();
		});
		new ButtonComponent(nav).setIcon("chevron-left").setTooltip("Zurück").onClick(() => this.navigate(-1));
		new ButtonComponent(nav).setIcon("chevron-right").setTooltip("Weiter").onClick(() => this.navigate(1));

		const last = end.clone().subtract(1, "day");
		let title: string;
		if (this.mode === "month") title = this.date.format("MMMM YYYY");
		else if (this.mode === "day") title = start.format("dddd, ll");
		else title = `${start.format("ll")} – ${last.format("ll")}`;
		bar.createDiv({ text: title, cls: "nc-cal-title" });

		const actions = bar.createDiv({ cls: "nc-cal-toolbar-group" });
		new DropdownComponent(actions)
			.addOptions(MODES)
			.setValue(this.mode)
			.onChange((mode) => {
				this.mode = mode as Mode;
				this.changed();
			});
		new ButtonComponent(actions)
			.setIcon("layers")
			.setTooltip("Kalender")
			.onClick((evt) => this.showCalendarMenu(evt));
		new ButtonComponent(actions).setIcon("refresh-cw").setTooltip("Neu laden").onClick(() => this.reload());
		new ButtonComponent(actions)
			.setIcon("plus")
			.setTooltip("Neuer Termin")
			.setCta()
			.onClick(() => this.newEvent(this.defaultStart()));
	}

	private showCalendarMenu(evt: MouseEvent) {
		const menu = new Menu();
		const hidden = this.hidden.get();
		for (const calendar of this.calendars ?? []) {
			menu.addItem((item) =>
				item
					.setTitle(calendar.name)
					.setChecked(!hidden.has(calendar.path))
					.onClick(async () => {
						if (hidden.has(calendar.path)) hidden.delete(calendar.path);
						else hidden.add(calendar.path);
						await this.hidden.set(hidden);
						this.loadEvents();
					})
			);
		}
		menu.showAtMouseEvent(evt);
	}

	// ── Day / multi-day time grid ──────────────────────────────────────────────

	private renderDays(start: moment.Moment, count: number, events: CalendarEvent[]) {
		const days = Array.from({ length: count }, (_, i) => start.clone().add(i, "days"));
		const grid = this.bodyEl.createDiv({ cls: "nc-cal-days" });
		grid.style.setProperty("--nc-cal-columns", String(count));

		const head = grid.createDiv({ cls: "nc-cal-row nc-cal-head" });
		head.createDiv({ cls: "nc-cal-gutter" });
		for (const day of days) {
			const cell = head.createDiv({ cls: "nc-cal-day-head", text: day.format("dd D") });
			if (day.isSame(moment(), "day")) cell.addClass("is-today");
			cell.addEventListener("click", () => this.openDay(day));
		}

		const allDay = events.filter((e) => e.allDay);
		if (allDay.length) {
			const row = grid.createDiv({ cls: "nc-cal-row nc-cal-allday" });
			row.createDiv({ cls: "nc-cal-gutter" });
			for (const day of days) {
				const cell = row.createDiv({ cls: "nc-cal-allday-cell" });
				for (const event of allDay.filter((e) => overlapsDay(e, day))) this.chip(cell, event, false);
			}
		}

		const scroll = grid.createDiv({ cls: "nc-cal-scroll" });
		const body = scroll.createDiv({ cls: "nc-cal-row nc-cal-timegrid" });
		body.style.height = `${24 * HOUR_PX}px`;
		const gutter = body.createDiv({ cls: "nc-cal-gutter" });
		for (let h = 1; h < 24; h++) {
			gutter.createDiv({ cls: "nc-cal-hour-label", text: moment().hour(h).minute(0).format("LT") }).style.top = `${h * HOUR_PX}px`;
		}

		for (const day of days) {
			const col = body.createDiv({ cls: "nc-cal-col" });
			col.addEventListener("click", (evt) => {
				if (evt.target !== col) return;
				const minutes = Math.floor(evt.offsetY / HOUR_PX / 0.5) * 30;
				this.newEvent(day.clone().add(minutes, "minutes"));
			});

			const dayStart = day.valueOf();
			const timed = events
				.filter((e) => !e.allDay && overlapsDay(e, day))
				.map((e) => ({
					item: e,
					start: Math.max(0, (e.start.getTime() - dayStart) / 60_000),
					end: Math.min(24 * 60, (e.end.getTime() - dayStart) / 60_000),
				}));
			for (const p of layoutDay(timed)) {
				const el = this.chip(col, p.item, true);
				el.addClass("nc-cal-timed");
				el.style.top = `${(p.start / 60) * HOUR_PX}px`;
				el.style.height = `${Math.max(((p.end - p.start) / 60) * HOUR_PX, 18)}px`;
				el.style.left = `${(p.column / p.columns) * 100}%`;
				el.style.width = `${100 / p.columns}%`;
			}

			if (day.isSame(moment(), "day")) {
				this.nowLine = { el: col.createDiv({ cls: "nc-cal-now" }), day };
				this.positionNowLine();
			}
		}

		const focusHour = this.nowLine ? Math.max(0, moment().hour() - 1) : 7;
		scroll.scrollTop = focusHour * HOUR_PX;
	}

	private positionNowLine() {
		if (!this.nowLine) return;
		const minutes = moment().diff(this.nowLine.day, "minutes");
		this.nowLine.el.toggle(minutes >= 0 && minutes < 24 * 60);
		this.nowLine.el.style.top = `${(minutes / 60) * HOUR_PX}px`;
	}

	// ── Month grid ─────────────────────────────────────────────────────────────

	private renderMonth(start: moment.Moment, end: moment.Moment, events: CalendarEvent[]) {
		const month = this.bodyEl.createDiv({ cls: "nc-cal-month" });
		const head = month.createDiv({ cls: "nc-cal-month-head" });
		for (let i = 0; i < 7; i++) head.createDiv({ text: start.clone().add(i, "days").format("dd") });

		const grid = month.createDiv({ cls: "nc-cal-month-grid" });
		for (const day = start.clone(); day.isBefore(end); day.add(1, "day")) {
			const date = day.clone();
			const cell = grid.createDiv({ cls: "nc-cal-month-cell" });
			if (!date.isSame(this.date, "month")) cell.addClass("is-other-month");
			if (date.isSame(moment(), "day")) cell.addClass("is-today");
			cell.createDiv({ cls: "nc-cal-month-date", text: date.format("D") });
			cell.addEventListener("click", (evt) => {
				if (evt.target === cell || (evt.target as HTMLElement).hasClass("nc-cal-month-date")) this.openDay(date);
			});

			const dayEvents = events
				.filter((e) => overlapsDay(e, date))
				.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
			for (const event of dayEvents.slice(0, MONTH_CHIPS)) this.chip(cell, event, !event.allDay);
			if (dayEvents.length > MONTH_CHIPS) {
				const more = cell.createDiv({ cls: "nc-cal-more", text: `+${dayEvents.length - MONTH_CHIPS} weitere` });
				more.addEventListener("click", () => this.openDay(date));
			}
		}
	}

	private openDay(day: moment.Moment) {
		this.mode = "day";
		this.date = day.clone().startOf("day");
		this.changed();
	}

	// ── Events ─────────────────────────────────────────────────────────────────

	private chip(parent: HTMLElement, event: CalendarEvent, withTime: boolean): HTMLElement {
		const el = parent.createDiv({ cls: "nc-cal-event" });
		el.style.setProperty("--nc-cal-color", event.calendar.color);
		if (withTime) el.createSpan({ cls: "nc-cal-event-time", text: moment(event.start).format("LT") });
		el.createSpan({ cls: "nc-cal-event-title", text: event.title || "(Ohne Titel)" });
		el.setAttr("title", event.title);
		el.addEventListener("click", (evt) => {
			evt.stopPropagation();
			new EventDetailModal(this.app, event, {
				edit: () => this.editEvent(event),
				delete: () => this.deleteEvent(event),
			}).open();
		});
		return el;
	}

	private defaultStart(): moment.Moment {
		const now = moment();
		const [start, end] = this.range();
		const day = now.isBetween(start, end, undefined, "[)") ? now.clone().startOf("day") : this.date.clone();
		return day.hour(Math.min(now.hour() + 1, 23));
	}

	private writableCalendars(): CalendarInfo[] {
		const hidden = this.hidden.get();
		const writable = (this.calendars ?? []).filter((c) => !c.readOnly);
		// Prefer visible calendars, but allow all writable ones.
		return [...writable.filter((c) => !hidden.has(c.path)), ...writable.filter((c) => hidden.has(c.path))];
	}

	private newEvent(start: moment.Moment) {
		const calendars = this.writableCalendars();
		if (!calendars.length) {
			new Notice("Es gibt keinen beschreibbaren Kalender.");
			return;
		}
		const draft: EventDraft = {
			title: "",
			start: start.toDate(),
			end: start.clone().add(1, "hour").toDate(),
			allDay: false,
			location: "",
			description: "",
		};
		new EventFormModal(this.app, {
			heading: "Neuer Termin",
			draft,
			calendar: calendars[0],
			calendars,
			rule: null,
			save: async (draft, calendar, rule) => {
				const { uid, ics } = createEventIcs(draft, rule);
				await this.api.saveEvent(`${calendar.path}${uid}.ics`, ics);
				new Notice("Termin angelegt.");
				this.loadEvents();
			},
		}).open();
	}

	private async editEvent(event: CalendarEvent) {
		const scope = event.recurring ? await chooseScope(this.app, "Wiederkehrenden Termin bearbeiten") : null;
		if (event.recurring && !scope) return;
		let source: { ics: string; etag: string };
		try {
			source = await this.api.getEventSource(event.path);
		} catch (e) {
			new Notice(`Termin konnte nicht geladen werden: ${errorMessage(e)}`, 8000);
			return;
		}
		// "This event" edits a single occurrence, so its form has no "Repeat" settings.
		const rule = scope === "this" ? undefined : readRecurrence(source.ics, scope === "following" ? event : undefined);

		new EventFormModal(this.app, {
			heading: scope === "this" ? "Diesen Termin bearbeiten" : scope === "following" ? "Diesen und folgende bearbeiten" : scope === "all" ? "Alle Termine bearbeiten" : "Termin bearbeiten",
			draft: { title: event.title, start: event.start, end: event.end, allDay: event.allDay, location: event.location, description: event.description },
			calendar: event.calendar,
			rule,
			save: async (draft, _calendar, rule) => {
				const latest = await this.latestSource(event);
				if (!scope) {
					await this.api.saveEvent(event.path, updateEventIcs(latest.ics, draft, event, rule), latest.etag);
				} else {
					const result = updateRecurringIcs(latest.ics, draft, event, scope, rule);
					await this.api.saveEvent(event.path, result.ics, latest.etag);
					if (result.created) await this.api.saveEvent(`${event.calendar.path}${result.created.uid}.ics`, result.created.ics);
				}
				new Notice("Termin gespeichert.");
				this.loadEvents();
			},
		}).open();
	}

	/** The stored event, after asking whether to overwrite if it changed since the calendar was loaded. */
	private async latestSource(event: CalendarEvent): Promise<{ ics: string; etag: string }> {
		const source = await this.api.getEventSource(event.path);
		if (source.etag !== event.etag) {
			const overwrite = await confirmModal(
				this.app,
				"Termin wurde woanders geändert",
				"Dieser Termin wurde woanders geändert, nachdem der Kalender geladen wurde. Speichern überschreibt diese Änderungen.",
				"Überschreiben"
			);
			if (!overwrite) throw new Error("abgebrochen, weil der Termin woanders geändert wurde");
		}
		return source;
	}

	private async deleteEvent(event: CalendarEvent) {
		let scope: Scope | null = null;
		if (event.recurring) {
			scope = await chooseScope(this.app, "Wiederkehrenden Termin löschen");
			if (!scope) return;
		} else {
			const confirmed = await confirmModal(this.app, "Termin löschen", `"${event.title || "(Ohne Titel)"}" löschen?`, "Löschen");
			if (!confirmed) return;
		}
		try {
			if (!scope || scope === "all") {
				await this.api.deleteEvent(event.path, event.etag);
			} else {
				const latest = await this.latestSource(event);
				const ics = deleteRecurringIcs(latest.ics, event, scope);
				if (ics === null) await this.api.deleteEvent(event.path, latest.etag);
				else await this.api.saveEvent(event.path, ics, latest.etag);
			}
			new Notice("Termin gelöscht.");
		} catch (e) {
			new Notice(isConflict(e) ? "Der Termin wurde woanders geändert. Bitte neu laden und erneut versuchen." : `Termin konnte nicht gelöscht werden: ${errorMessage(e)}`, 8000);
		}
		this.loadEvents();
	}
}

function overlapsDay(event: CalendarEvent, day: moment.Moment): boolean {
	const start = day.valueOf();
	const end = day.clone().add(1, "day").valueOf();
	const eventEnd = Math.max(event.end.getTime(), event.start.getTime() + 1); // zero-length events still show
	return event.start.getTime() < end && eventEnd > start;
}
