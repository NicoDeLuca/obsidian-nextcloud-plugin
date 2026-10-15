import { App } from "obsidian";
import { NextcloudModule } from "../../core/types";
import { timeTrackingApi } from "./api";
import { EntryModal } from "./EntryModal";
import { timeBlock } from "./TimeBlock";
import { TimeTracker } from "./TimeTracker";
import { WEEK_VIEW, weekFigures, weekSummary, WeekView } from "./WeekView";
import { ZeiterfassungApi } from "./ZeiterfassungApi";

export const zeiterfassungModule: NextcloudModule = {
	id: "zeiterfassung",
	name: "Zeiterfassung",
	description: "Timer, Wochenübersicht und Nachtragen für die Nextcloud-App „Zeiterfassung“ (muss auf der Nextcloud installiert sein).",
	// A custom app that most Nextcloud servers don't have.
	defaultEnabled: false,
	load(ctx) {
		const app = ctx.plugin.app;
		const api = new ZeiterfassungApi(ctx.client);
		const tracker = new TimeTracker(api);

		ctx.registerView(WEEK_VIEW, (leaf) => new WeekView(leaf, tracker));
		ctx.addRibbonIcon("timer", "Zeiterfassung: diese Woche", () => openWeek(app));

		ctx.addCommand({ id: "zeiterfassung-start", name: "Zeiterfassung: Start", callback: () => tracker.run("start") });
		ctx.addCommand({ id: "zeiterfassung-pause", name: "Zeiterfassung: Pause", callback: () => tracker.run("pause") });
		ctx.addCommand({ id: "zeiterfassung-resume", name: "Zeiterfassung: Weiter", callback: () => tracker.run("resume") });
		ctx.addCommand({ id: "zeiterfassung-stop", name: "Zeiterfassung: Stop", callback: () => tracker.run("stop") });
		ctx.addCommand({ id: "zeiterfassung-week", name: "Zeiterfassung: Diese Woche öffnen", callback: () => openWeek(app) });
		ctx.addCommand({
			id: "zeiterfassung-entry",
			name: "Zeiterfassung: Eintrag nachtragen",
			callback: () => new EntryModal(app, api, () => tracker.refresh()).open(),
		});
		ctx.addCommand({
			id: "zeiterfassung-summary",
			name: "Zeiterfassung: Wochenzusammenfassung einfügen",
			editorCallback: async (editor) => {
				await tracker.refresh(true);
				if (tracker.state && !tracker.error) editor.replaceSelection(weekSummary(tracker.state.week, tracker.workSeconds()));
			},
		});

		ctx.registerBlock(timeBlock(tracker));
		ctx.exposeApi("timeTracking", timeTrackingApi(tracker));

		// Status bar (desktop): "⏱ 1:23" while running, "⏸ 1:23" while paused; a click starts, pauses or resumes.
		const statusEl = ctx.addStatusBarItem();
		statusEl.addClass("mod-clickable", "nc-time-status");
		statusEl.addEventListener("click", () => tracker.toggle());
		const showStatus = () => {
			const { text, tooltip, over } = statusText(tracker);
			if (statusEl.getText() !== text) statusEl.setText(text);
			statusEl.setAttr("aria-label", tooltip);
			statusEl.toggleClass("nc-time-over", over);
		};
		ctx.register(tracker.onChange(showStatus));
		showStatus();
		const tick = window.setInterval(showStatus, 1000);
		ctx.register(() => window.clearInterval(tick));

		// The timer may be started or stopped on the phone or in the browser, so look again every minute.
		const refresh = () => ctx.client.isConfigured && tracker.refresh();
		app.workspace.onLayoutReady(refresh);
		const poll = window.setInterval(refresh, 60_000);
		ctx.register(() => window.clearInterval(poll));
	},
};

function statusText(tracker: TimeTracker): { text: string; tooltip: string; over: boolean } {
	const state = tracker.state;
	if (!state) {
		return tracker.error
			? { text: "⏱ ?", tooltip: `Zeiterfassung: ${tracker.error}`, over: false }
			: { text: "⏱ …", tooltip: "Zeiterfassung wird geladen", over: false };
	}
	const timer = state.timer;
	if (!timer) return { text: "⏱ –", tooltip: "Zeiterfassung: kein Timer – klicken zum Starten", over: false };
	const work = tracker.workSeconds();
	const minutes = Math.floor(work / 60);
	const time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
	const over = weekFigures(state.week, work).overLimit;
	return timer.paused
		? { text: `⏸ ${time}`, tooltip: "Zeiterfassung: pausiert – klicken zum Fortsetzen", over }
		: { text: `⏱ ${time}`, tooltip: "Zeiterfassung: läuft – klicken zum Pausieren", over };
}

async function openWeek(app: App) {
	const existing = app.workspace.getLeavesOfType(WEEK_VIEW)[0];
	const leaf = existing ?? app.workspace.getRightLeaf(false);
	if (!leaf) return;
	if (!existing) await leaf.setViewState({ type: WEEK_VIEW, active: true });
	await app.workspace.revealLeaf(leaf);
}
