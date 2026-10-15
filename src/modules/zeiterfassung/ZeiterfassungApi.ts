import { errorMessage, NextcloudClient } from "../../core/NextcloudClient";

const BASE = "/index.php/apps/zeiterfassung";

/** Durations are seconds; dates/times are local in the user's Nextcloud time zone; timestamps are Unix seconds. */
export interface Timer {
	startedAt: number;
	pausedSince: number | null;
	pauseSeconds: number;
	workSeconds: number;
	totalPauseSeconds: number;
	paused: boolean;
}

export interface Week {
	/** Monday, YYYY-MM-DD */
	start: string;
	end: string;
	isoWeek: number;
	isoYear: number;
	target: number;
	/** Without the running timer. */
	actual: number;
	diff: number;
	overLimit: boolean;
	override: { target: number; note: string } | null;
	days: number[];
	/** Balance at the end of this week without the running timer; null without a start date. */
	balance: number | null;
}

export interface Entry {
	id: number;
	date: string;
	start: string;
	end: string;
	endDate: string;
	pauseMinutes: number;
	workSeconds: number;
	inCalendar: boolean;
}

export interface TimerResponse {
	serverTime: number;
	timer: Timer | null;
	week: Week & { limit: number; today: string };
	/** Only after stop. */
	stoppedEntry?: Entry;
}

export type TimerAction = "start" | "pause" | "resume" | "stop";

/** An error answer of the app: `message` is the server's German text. */
export class ZeiterfassungError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
	}
}

/** The JSON API of the Nextcloud app "Zeiterfassung" (see its docs/API.md). */
export class ZeiterfassungApi {
	constructor(private client: NextcloudClient) {}

	getTimer(): Promise<TimerResponse> {
		return this.call("GET", "/api/timer");
	}

	timer(action: TimerAction): Promise<TimerResponse> {
		return this.call("POST", `/api/timer/${action}`);
	}

	/** If `end` is not after `start`, the server takes it as a time on the next day. */
	createEntry(entry: { date: string; start: string; end: string; pauseMinutes: number }): Promise<Entry> {
		return this.call("POST", "/api/entries", entry);
	}

	private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await this.client.request(method, BASE + path, {
			body: body === undefined ? undefined : JSON.stringify(body),
			contentType: body === undefined ? undefined : "application/json",
			throw: false,
		});
		if (res.status >= 400) {
			let message = "";
			try {
				message = res.json?.message ?? "";
			} catch {
				// Not JSON, e.g. Nextcloud's HTML page when the app is missing.
			}
			if (!message && res.status === 404) message = "Die App Zeiterfassung wurde auf der Nextcloud nicht gefunden. Ist sie installiert und aktiviert?";
			if (!message && res.status === 401) message = "Anmeldung fehlgeschlagen. Benutzername und App-Passwort prüfen.";
			throw new ZeiterfassungError(message || `HTTP ${res.status}`, res.status);
		}
		return res.json as T;
	}
}

/** The text to show the user: the server's message, or a description of a network error. */
export function messageOf(e: unknown): string {
	return e instanceof ZeiterfassungError ? e.message : errorMessage(e);
}

/** 3600 → "1:00", like the app's web interface (rounded to minutes). */
export function hm(seconds: number): string {
	const minutes = Math.round(Math.abs(seconds) / 60);
	const text = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
	return seconds < 0 && minutes > 0 ? `-${text}` : text;
}

/** Signed difference, e.g. "+1:30" or "-0:45". */
export function diff(seconds: number): string {
	const text = hm(seconds);
	return text.startsWith("-") || text === "0:00" ? text : `+${text}`;
}
