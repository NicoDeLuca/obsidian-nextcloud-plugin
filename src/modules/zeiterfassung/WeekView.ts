import { ItemView, moment, WorkspaceLeaf } from "obsidian";
import { TimeTracker } from "./TimeTracker";
import { diff, hm, TimerResponse } from "./ZeiterfassungApi";

export const WEEK_VIEW = "nextcloud-zeiterfassung-week";

/**
 * The current week including the running timer. The server's `actual` and `balance` leave the
 * running timer out; like the app's web interface, it is added here.
 */
export function weekFigures(week: TimerResponse["week"], work: number) {
	const actual = week.actual + work;
	return {
		actual,
		target: week.target,
		diff: actual - week.target,
		balance: week.balance === null ? null : week.balance + work,
		overLimit: week.overLimit || actual > week.limit,
	};
}

/** "KW 42: 31:30 h von 20:00 h (+11:30 h), Saldo +4:15 h" */
export function weekSummary(week: TimerResponse["week"], work: number): string {
	const f = weekFigures(week, work);
	const balance = f.balance === null ? "" : `, Saldo ${diff(f.balance)} h`;
	return `KW ${week.isoWeek}: ${hm(f.actual)} h von ${hm(f.target)} h (${diff(f.diff)} h)${balance}`;
}

/** Small sidebar view: actual/target/difference of the current week and the balance. */
export class WeekView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private tracker: TimeTracker) {
		super(leaf);
	}

	getViewType() {
		return WEEK_VIEW;
	}

	getDisplayText() {
		return "Zeiterfassung";
	}

	getIcon() {
		return "timer";
	}

	async onOpen() {
		this.contentEl.addClass("nc-time");
		this.addAction("refresh-cw", "Aktualisieren", () => this.tracker.refresh(true));
		this.register(this.tracker.onChange(() => this.render()));
		// The running timer changes the figures; minutes are enough.
		this.registerInterval(window.setInterval(() => this.render(), 15_000));
		this.render();
		if (!this.tracker.state) await this.tracker.refresh(true);
	}

	private render() {
		const el = this.contentEl;
		el.empty();
		renderWeek(el, this.tracker);
	}
}

/** Actual/target/difference/limit/balance of the current week, the timer state, and the limit warning. */
export function renderWeek(el: HTMLElement, tracker: TimeTracker, showTimer = true) {
	const state = tracker.state;
	if (!state) {
		el.createEl("p", { cls: "nc-cookbook-status", text: tracker.error ? `Konnte nicht geladen werden: ${tracker.error}` : "Wird geladen …" });
		return;
	}
	const { week, timer } = state;
	const work = tracker.workSeconds();
	const f = weekFigures(week, work);

	el.createEl("h4", { text: `KW ${week.isoWeek} · ${moment(week.start).format("DD.MM.")}–${moment(week.end).format("DD.MM.YYYY")}` });
	if (f.overLimit) {
		el.createDiv({ cls: "nc-time-warning", text: `Wochenlimit überschritten: ${hm(f.actual)} h – das Limit liegt bei ${hm(week.limit)} h.` });
	}

	const table = el.createEl("table", { cls: "nc-time-table" });
	const row = (label: string, value: string, cls = "") => {
		const tr = table.createEl("tr");
		tr.createEl("td", { text: label });
		tr.createEl("td", { text: value, cls });
	};
	const sign = (seconds: number) => (seconds < 0 ? "nc-time-minus" : "nc-time-plus");
	row("Ist", `${hm(f.actual)} h`);
	row("Soll", `${hm(f.target)} h${week.override?.note ? ` (${week.override.note})` : ""}`);
	row("Differenz", `${diff(f.diff)} h`, sign(f.diff));
	row("Wochenlimit", `${hm(week.limit)} h`);
	if (f.balance === null) row("Saldo", "Startdatum fehlt", "nc-time-muted");
	else row("Saldo", `${diff(f.balance)} h`, sign(f.balance));

	const status = !timer
		? "Kein Timer aktiv."
		: `Timer ${timer.paused ? "pausiert" : "läuft"} seit ${moment.unix(timer.paused ? timer.pausedSince! : timer.startedAt).format("HH:mm")}, ${hm(work)} h gearbeitet.`;
	if (showTimer) el.createEl("p", { cls: "nc-time-muted", text: status });
	if (timer) el.createEl("p", { cls: "nc-time-muted", text: "Der laufende Timer ist in Ist und Saldo enthalten." });
	if (tracker.error) el.createEl("p", { cls: "nc-time-muted", text: `Letzte Aktualisierung fehlgeschlagen: ${tracker.error}` });
}
