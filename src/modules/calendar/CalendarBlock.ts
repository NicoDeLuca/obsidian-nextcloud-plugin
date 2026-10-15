import { App, ButtonComponent, moment, Notice } from "obsidian";
import { BlockDefinition, BlockWidget, findByName, Options } from "../../core/blocks";
import { errorMessage } from "../../core/NextcloudClient";
import { CalDavApi, CalendarInfo } from "./CalDavApi";
import { HiddenCalendars } from "./CalendarView";
import { EventActions, overlapsDay } from "./EventActions";
import { CalendarEvent } from "./ics";

/**
 * ```nextcloud-kalender
 * tage: 7               # ab heute; 1 = nur heute
 * kalender: Persönlich  # eine oder mehrere (Standard: die in der Kalenderansicht eingeblendeten)
 * vergangene: nein      # heute schon vorbei
 * max: 20
 * hinzufuegen: ja
 * ```
 */
export function calendarBlock(api: CalDavApi, hidden: HiddenCalendars): BlockDefinition {
	return {
		language: "nextcloud-kalender",
		title: "Termine (Agenda)",
		template: "tage: 7",
		keys: ["titel", "tage", "kalender", "vergangene", "max", "hinzufuegen"],
		create: (el, options, host) => new CalendarBlock(el, host.app, options, api, hidden),
	};
}

class CalendarBlock extends BlockWidget {
	private actions: EventActions;
	private calendars: CalendarInfo[] = [];
	private days: number;

	constructor(el: HTMLElement, app: App, options: Options, private api: CalDavApi, private hidden: HiddenCalendars) {
		const days = options.number("tage", 7, 1, 62);
		super(el, app, options, days === 1 ? "Termine · Heute" : `Termine · ${days} Tage`);
		this.days = days;
		this.actions = new EventActions(app, api, () => this.calendars.filter((c) => !c.readOnly), () => this.refresh());
	}

	protected renderActions(actions: HTMLElement) {
		if (!this.options.boolean("hinzufuegen", true)) return;
		new ButtonComponent(actions)
			.setIcon("plus")
			.setTooltip("Neuer Termin")
			.onClick(() => this.actions.create(moment().add(1, "hour").startOf("hour")));
	}

	protected async update(body: HTMLElement, isCurrent: () => boolean) {
		const all = await this.api.listCalendars();
		const names = this.options.list("kalender");
		const hidden = this.hidden.get();
		this.calendars = names.length ? names.map((n) => findByName(all, n, (c) => c.name, "Kalender")) : all.filter((c) => !hidden.has(c.path));

		const start = moment().startOf("day");
		const end = start.clone().add(this.days, "days");
		const events: CalendarEvent[] = [];
		const results = await Promise.allSettled(this.calendars.map((c) => this.api.getEvents(c, start.toDate(), end.toDate())));
		results.forEach((r, i) => {
			if (r.status === "fulfilled") events.push(...r.value);
			else if (isCurrent()) new Notice(`"${this.calendars[i].name}" konnte nicht geladen werden: ${errorMessage(r.reason)}`);
		});
		if (!isCurrent()) return;
		events.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());

		const past = this.options.boolean("vergangene", false);
		const max = this.options.number("max", 0, 0, 500);
		let shown = 0;
		let hiddenCount = 0;
		const list = body.createDiv({ cls: "nc-agenda" });
		for (let day = start.clone(); day.isBefore(end); day.add(1, "day")) {
			const today = day.isSame(moment(), "day");
			const dayEvents = events.filter((e) => overlapsDay(e, day) && (past || !today || e.allDay || e.end.getTime() > Date.now()));
			if (!dayEvents.length) continue;
			list.createDiv({ cls: "nc-agenda-day", text: dayLabel(day) });
			for (const event of dayEvents) {
				if (max && shown >= max) {
					hiddenCount++;
					continue;
				}
				shown++;
				this.renderEvent(list, event, day);
			}
		}
		if (!shown) body.createEl("p", { cls: "nc-cookbook-status", text: this.days === 1 ? "Heute keine Termine." : "Keine Termine." });
		if (hiddenCount) body.createEl("p", { cls: "nc-cookbook-status", text: `… und ${hiddenCount} weitere` });
	}

	private renderEvent(parent: HTMLElement, event: CalendarEvent, day: moment.Moment) {
		const row = parent.createDiv({ cls: "nc-agenda-event" });
		row.style.setProperty("--nc-cal-color", event.calendar.color);
		row.createSpan({ cls: "nc-agenda-time", text: timeLabel(event, day) });
		const main = row.createDiv({ cls: "nc-agenda-main" });
		main.createDiv({ cls: "nc-agenda-title", text: event.title || "(Ohne Titel)" });
		if (event.location) main.createDiv({ cls: "nc-task-meta", text: event.location });
		row.addEventListener("click", () => this.actions.open(event));
	}
}

function dayLabel(day: moment.Moment): string {
	const diff = day.diff(moment().startOf("day"), "days");
	return diff === 0 ? "Heute" : diff === 1 ? "Morgen" : day.format("dddd, DD.MM.");
}

/** "09:00–10:30", "ganztägig", or "bis 10:00" / "ab 22:00" for events reaching into other days. */
function timeLabel(event: CalendarEvent, day: moment.Moment): string {
	if (event.allDay) return "ganztägig";
	const startsBefore = event.start.getTime() < day.valueOf();
	const endsAfter = event.end.getTime() > day.clone().add(1, "day").valueOf();
	if (startsBefore && endsAfter) return "ganztägig";
	if (startsBefore) return `bis ${moment(event.end).format("LT")}`;
	if (endsAfter) return `ab ${moment(event.start).format("LT")}`;
	return `${moment(event.start).format("LT")}–${moment(event.end).format("LT")}`;
}
