import ICAL from "ical.js";

/** Current time as a UTC date-time, for DTSTAMP, CREATED, LAST-MODIFIED and COMPLETED. */
export function utcNow(): ICAL.Time {
	return ICAL.Time.fromJSDate(new Date(), true);
}

/** Random UID. crypto.randomUUID needs a secure context, which isn't guaranteed on mobile. */
export function uuid(): string {
	const b = crypto.getRandomValues(new Uint8Array(16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** All-day → DATE from the local calendar day; otherwise a UTC date-time. */
export function toIcalTime(date: Date, allDay: boolean): ICAL.Time {
	if (allDay) {
		return ICAL.Time.fromData({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), isDate: true });
	}
	return ICAL.Time.fromJSDate(date, true);
}
