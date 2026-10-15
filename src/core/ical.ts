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

/** Parses an iCalendar object and registers its VTIMEZONEs, so TZID times convert correctly. */
export function parseCalendar(ics: string): ICAL.Component {
	const root = new ICAL.Component(ICAL.parse(ics));
	for (const vtimezone of root.getAllSubcomponents("vtimezone")) {
		ICAL.TimezoneService.register(new ICAL.Timezone(vtimezone));
	}
	return root;
}

/**
 * A time for `date` in the same form as `like` (same time zone, or DATE for all-day),
 * so exceptions and EXDATEs match the series they belong to.
 */
export function timeLike(date: Date, like: ICAL.Time | null, allDay: boolean): ICAL.Time {
	if (allDay) return toIcalTime(date, true);
	const zone = like && !like.isDate ? like.zone : null;
	if (zone?.tzid === "floating") return ICAL.Time.fromJSDate(date, false);
	if (zone && zone.tzid !== "UTC" && ICAL.TimezoneService.has(zone.tzid)) return ICAL.Time.fromJSDate(date, true).convertToZone(zone);
	return ICAL.Time.fromJSDate(date, true);
}

/** Sets a date/time property, adding the TZID parameter for zoned times (ical.js doesn't). */
export function setTimeProperty(component: ICAL.Component, name: string, time: ICAL.Time, replace = true) {
	if (replace) component.removeAllProperties(name);
	const prop = new ICAL.Property(name);
	prop.setValue(time);
	const tzid = time.zone?.tzid;
	if (!time.isDate && tzid && tzid !== "UTC" && tzid !== "floating") prop.setParameter("tzid", tzid);
	component.addProperty(prop);
}
