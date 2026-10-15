import { moment, Setting } from "obsidian";
import { describeRecurrence, Frequency, Recurrence, weekdayOf, WEEKDAYS } from "./recurrence";

const DAY_LABEL: Record<string, string> = { MO: "Mo", TU: "Tu", WE: "We", TH: "Th", FR: "Fr", SA: "Sa", SU: "Su" };

/**
 * "Repeat" settings for event and task forms.
 * @param value the current rule: null = no repetition, "custom" = a rule the form can't show
 * @param start start (or due) date, used for the default weekday
 */
export function renderRecurrenceSetting(
	container: HTMLElement,
	value: Recurrence | "custom" | null,
	start: () => Date,
	onChange: (value: Recurrence | "custom" | null) => void
) {
	const el = container.createDiv({ cls: "nc-recurrence" });
	let current = value;

	const render = () => {
		el.empty();
		new Setting(el).setName("Repeat").addDropdown((d) => {
			d.addOption("", "Never");
			if (current === "custom") d.addOption("custom", "Custom (kept as is)");
			d.addOptions({ DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" });
			d.setValue(current === "custom" ? "custom" : current?.freq ?? "").onChange((freq) => {
				if (!freq) current = null;
				else if (freq === "custom") current = "custom";
				else {
					const previous: Recurrence | null = current && current !== "custom" ? current : null;
					current = {
						freq: freq as Frequency,
						interval: previous?.interval ?? 1,
						byDay: freq === "WEEKLY" ? (previous?.byDay.length ? previous.byDay : [weekdayOf(start())]) : [],
						end: previous?.end ?? { type: "never" },
					};
				}
				onChange(current);
				render();
			});
		});
		if (current === "custom") {
			el.createDiv({ cls: "nc-cal-hint", text: `${describeRecurrence("custom")} — created in another app; it stays unchanged.` });
			return;
		}
		if (!current) return;
		const rule = current;
		const changed = () => onChange(rule);

		new Setting(el).setName("Every").addText((t) => {
			t.inputEl.type = "number";
			t.inputEl.min = "1";
			t.inputEl.addClass("nc-recurrence-number");
			t.setValue(String(rule.interval)).onChange((v) => {
				rule.interval = Math.max(1, parseInt(v) || 1);
				changed();
			});
			t.inputEl.insertAdjacentText("afterend", ` ${{ DAILY: "day(s)", WEEKLY: "week(s)", MONTHLY: "month(s)", YEARLY: "year(s)" }[rule.freq]}`);
		});

		if (rule.freq === "WEEKLY") {
			const days = new Setting(el).setName("On").controlEl.createDiv({ cls: "nc-recurrence-days" });
			for (const day of WEEKDAYS) {
				const chip = days.createEl("button", { text: DAY_LABEL[day], cls: "nc-recurrence-day" });
				chip.toggleClass("is-active", rule.byDay.includes(day));
				chip.addEventListener("click", (evt) => {
					evt.preventDefault();
					if (rule.byDay.includes(day)) {
						if (rule.byDay.length === 1) return; // at least one day
						rule.byDay = rule.byDay.filter((d) => d !== day);
					} else rule.byDay = [...rule.byDay, day];
					chip.toggleClass("is-active", rule.byDay.includes(day));
					changed();
				});
			}
		}

		const endSetting = new Setting(el).setName("Ends");
		endSetting.addDropdown((d) =>
			d
				.addOptions({ never: "Never", count: "After …", until: "On date" })
				.setValue(rule.end.type)
				.onChange((type) => {
					if (type === "count") rule.end = { type: "count", count: 10 };
					else if (type === "until") rule.end = { type: "until", until: moment(start()).add(1, "month").toDate() };
					else rule.end = { type: "never" };
					changed();
					render();
				})
		);
		if (rule.end.type === "count") {
			const end = rule.end;
			const input = endSetting.controlEl.createEl("input", { type: "number", cls: "nc-recurrence-number", value: String(end.count) });
			input.min = "1";
			input.addEventListener("change", () => {
				end.count = Math.max(1, parseInt(input.value) || 1);
				changed();
			});
			endSetting.controlEl.createSpan({ text: " times" });
		}
		if (rule.end.type === "until") {
			const end = rule.end;
			const input = endSetting.controlEl.createEl("input", { type: "date", value: moment(end.until).format("YYYY-MM-DD") });
			input.addEventListener("change", () => {
				const date = moment(input.value, "YYYY-MM-DD", true);
				if (date.isValid()) end.until = date.toDate();
				changed();
			});
		}
	};
	render();
}
