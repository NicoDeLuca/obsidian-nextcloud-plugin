import { TimeTracker } from "./TimeTracker";
import { weekFigures, weekSummary } from "./WeekView";

/** `api.timeTracking`: the timer and the current week for scripts. Durations are in seconds. */
export function timeTrackingApi(tracker: TimeTracker) {
	const load = async () => {
		await tracker.refresh();
		if (!tracker.state) throw new Error(tracker.error ?? "Zeiterfassung nicht erreichbar");
		return tracker.state;
	};
	/** Throws with the server's message (e.g. "Es läuft bereits ein Timer.") if the action isn't possible. */
	const run = async (action: "start" | "pause" | "resume" | "stop") => {
		const error = await tracker.run(action);
		if (error) throw new Error(error);
	};
	return {
		/** Current timer and week; like the web interface, the week's figures include the running timer. */
		async state() {
			const state = await load();
			const work = tracker.workSeconds();
			const f = weekFigures(state.week, work);
			return {
				running: !!state.timer && !state.timer.paused,
				paused: !!state.timer?.paused,
				workSeconds: state.timer ? work : 0,
				startedAt: state.timer ? new Date(state.timer.startedAt * 1000) : null,
				week: { isoWeek: state.week.isoWeek, start: state.week.start, ...f, limit: state.week.limit, overrideNote: state.week.override?.note ?? null },
			};
		},
		/** "KW 42: 31:30 h von 20:00 h (+11:30 h), Saldo +4:15 h" */
		async summary() {
			const state = await load();
			return weekSummary(state.week, tracker.workSeconds());
		},
		start: () => run("start"),
		pause: () => run("pause"),
		resume: () => run("resume"),
		stop: () => run("stop"),
	};
}
