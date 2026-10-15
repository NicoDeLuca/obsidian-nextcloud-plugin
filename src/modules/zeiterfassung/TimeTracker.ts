import { Notice } from "obsidian";
import { hm, messageOf, TimerAction, TimerResponse, ZeiterfassungApi, ZeiterfassungError } from "./ZeiterfassungApi";

const DONE: Record<Exclude<TimerAction, "stop">, string> = {
	start: "Timer gestartet.",
	pause: "Timer pausiert.",
	resume: "Timer läuft weiter.",
};

/**
 * The timer state as last loaded from the server. The timer lives on the server and may be
 * started or stopped on any device, so the state is reloaded regularly; in between, the working
 * time is counted up locally, relative to the server's clock.
 */
export class TimeTracker {
	state: TimerResponse | null = null;
	/** Message of the last failed load, until a load succeeds again. */
	error: string | null = null;
	/** Server clock minus local clock, in seconds. */
	private offset = 0;
	private listeners = new Set<() => void>();

	constructor(private api: ZeiterfassungApi) {}

	/** Current time on the server's clock (Unix seconds). */
	now(): number {
		return Date.now() / 1000 + this.offset;
	}

	/** Working time of the running timer so far; 0 without a timer. */
	workSeconds(): number {
		const t = this.state?.timer;
		if (!t) return 0;
		return Math.max(0, (t.pausedSince ?? this.now()) - t.startedAt - t.pauseSeconds);
	}

	/** Calls the listener after every change; returns a function that removes it. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Reloads the state. Failures of background loads are only reported once (not every
	 * minute while offline); `manual` loads always report them.
	 */
	async refresh(manual = false): Promise<void> {
		const failedBefore = this.error !== null;
		try {
			this.apply(await this.api.getTimer());
			this.error = null;
		} catch (e) {
			this.error = messageOf(e);
			if (manual || !failedBefore) new Notice(`Zeiterfassung: ${this.error}`, 8000);
		}
		this.notify();
	}

	async run(action: TimerAction): Promise<void> {
		try {
			const state = await this.api.timer(action);
			this.apply(state);
			this.error = null;
			this.notify();
			if (action !== "stop") new Notice(`Zeiterfassung: ${DONE[action]}`);
			else if (state.stoppedEntry) {
				const e = state.stoppedEntry;
				const calendar = e.inCalendar ? "" : "\nDer Kalendertermin fehlt – bitte in der Zeiterfassung prüfen.";
				new Notice(`Zeiterfassung: gestoppt, ${e.start}–${e.end}, ${hm(e.workSeconds)} h gearbeitet (Pause ${hm(e.pauseMinutes * 60)}).${calendar}`, 8000);
			}
		} catch (e) {
			// 409: the timer was changed on another device meanwhile (or the command didn't fit its state).
			new Notice(`Zeiterfassung: ${messageOf(e)}`, 8000);
			if (e instanceof ZeiterfassungError && e.status === 409) await this.refresh();
		}
	}

	/** Start, or pause/resume the running timer (the status bar click). */
	async toggle(): Promise<void> {
		if (!this.state) await this.refresh(true);
		if (!this.state) return;
		const t = this.state.timer;
		await this.run(!t ? "start" : t.paused ? "resume" : "pause");
	}

	private apply(state: TimerResponse): void {
		this.state = state;
		this.offset = state.serverTime - Date.now() / 1000;
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
