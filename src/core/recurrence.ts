import ICAL from "ical.js";
import { moment } from "obsidian";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/** The recurrence rules the forms can show and edit. */
export interface Recurrence {
	freq: Frequency;
	/** Every N days/weeks/months/years. */
	interval: number;
	/** Weekdays for weekly rules (MO … SU); empty means the weekday of the start. */
	byDay: string[];
	end: { type: "never" } | { type: "count"; count: number } | { type: "until"; until: Date };
}

/**
 * Reads an RRULE. Rules with parts the form can't represent (BYMONTHDAY, BYSETPOS, …)
 * come back as "custom" and are kept unchanged on save.
 */
export function fromRecur(recur: ICAL.Recur): Recurrence | "custom" {
	const freq = recur.freq as string;
	if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return "custom";
	const parts = Object.entries(recur.parts ?? {}).filter(([, v]) => v && (v as unknown[]).length);
	const byDay = (recur.parts?.BYDAY ?? []) as string[];
	const simple = parts.every(([k]) => k === "BYDAY") && (byDay.length === 0 || (freq === "WEEKLY" && byDay.every((d) => (WEEKDAYS as readonly string[]).includes(d))));
	if (!simple) return "custom";
	return {
		freq: freq as Frequency,
		interval: recur.interval || 1,
		byDay: [...byDay],
		end: recur.count ? { type: "count", count: recur.count } : recur.until ? { type: "until", until: recur.until.toJSDate() } : { type: "never" },
	};
}

/** Builds an RRULE. UNTIL is the end of the chosen day (a DATE for all-day series, UTC otherwise). */
export function toRecur(rule: Recurrence, allDay: boolean): ICAL.Recur {
	const data: ConstructorParameters<typeof ICAL.Recur>[0] = { freq: rule.freq, interval: Math.max(1, rule.interval) };
	if (rule.end.type === "count") data.count = Math.max(1, rule.end.count);
	if (rule.end.type === "until") {
		const day = rule.end.until;
		data.until = allDay
			? ICAL.Time.fromData({ year: day.getFullYear(), month: day.getMonth() + 1, day: day.getDate(), isDate: true })
			: ICAL.Time.fromJSDate(moment(day).endOf("day").toDate(), true);
	}
	const recur = new ICAL.Recur(data);
	if (rule.freq === "WEEKLY" && rule.byDay.length) recur.setComponent("BYDAY", sortWeekdays(rule.byDay));
	return recur;
}

const EVERY_ONE: Record<Frequency, string> = { DAILY: "Täglich", WEEKLY: "Wöchentlich", MONTHLY: "Monatlich", YEARLY: "Jährlich" };
const EVERY_N: Record<Frequency, string> = { DAILY: "Tage", WEEKLY: "Wochen", MONTHLY: "Monate", YEARLY: "Jahre" };
const SHORT_DAY: Record<string, string> = { MO: "Mo", TU: "Di", WE: "Mi", TH: "Do", FR: "Fr", SA: "Sa", SU: "So" };

/** "Alle 2 Wochen am Mo, Mi, bis 31. Dez. 2026" */
export function describeRecurrence(rule: Recurrence | "custom"): string {
	if (rule === "custom") return "Wiederholt sich (eigene Regel)";
	let text = rule.interval > 1 ? `Alle ${rule.interval} ${EVERY_N[rule.freq]}` : EVERY_ONE[rule.freq];
	if (rule.freq === "WEEKLY" && rule.byDay.length) text += ` am ${sortWeekdays(rule.byDay).map((d) => SHORT_DAY[d]).join(", ")}`;
	if (rule.end.type === "count") text += `, ${rule.end.count}-mal`;
	if (rule.end.type === "until") text += `, bis ${moment(rule.end.until).format("ll")}`;
	return text;
}

function sortWeekdays(days: string[]): string[] {
	return [...new Set(days)].sort((a, b) => WEEKDAYS.indexOf(a as never) - WEEKDAYS.indexOf(b as never));
}

/** The two-letter iCalendar weekday of a date. */
export function weekdayOf(date: Date): string {
	return WEEKDAYS[(date.getDay() + 6) % 7];
}
