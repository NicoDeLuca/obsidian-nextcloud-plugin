import { App, ButtonComponent, Modal, moment, Notice, Setting } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { renderRecurrenceSetting } from "../../core/RecurrenceSetting";
import type { CalendarInfo } from "./CalDavApi";
import { CalendarEvent, EventDraft, RuleChoice, Scope } from "./ics";

/** Shows one event; edit/delete are offered only where they are supported. */
export class EventDetailModal extends Modal {
	constructor(
		app: App,
		private event: CalendarEvent,
		private actions: { edit: () => void; delete: () => void }
	) {
		super(app);
	}

	onOpen() {
		const { event, contentEl } = this;
		this.titleEl.setText(event.title || "(Ohne Titel)");
		contentEl.addClass("nc-cal-detail");
		contentEl.createEl("p", { text: formatRange(event) });
		const cal = contentEl.createEl("p", { cls: "nc-cal-detail-calendar" });
		cal.createSpan({ cls: "nc-cal-dot" }).style.background = event.calendar.color;
		cal.createSpan({ text: event.calendar.name });
		if (event.location) contentEl.createEl("p", { text: `📍 ${event.location}` });
		if (event.description) contentEl.createEl("p", { text: event.description, cls: "nc-cal-detail-description" });

		if (event.calendar.readOnly) {
			contentEl.createEl("p", { text: "Dieser Kalender ist schreibgeschützt.", cls: "nc-cal-hint" });
			return;
		}
		if (event.recurring) contentEl.createEl("p", { text: "↻ Teil einer Terminserie", cls: "nc-cal-hint" });
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Löschen")
					.setWarning()
					.onClick(() => {
						this.close();
						this.actions.delete();
					})
			)
			.addButton((b) =>
				b
					.setButtonText("Bearbeiten")
					.setCta()
					.onClick(() => {
						this.close();
						this.actions.edit();
					})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Form for creating or editing an event. The modal stays open if saving fails. */
export class EventFormModal extends Modal {
	private draft: EventDraft;
	private calendar: CalendarInfo;

	constructor(
		app: App,
		private options: {
			heading: string;
			draft: EventDraft;
			calendar: CalendarInfo;
			/** Calendars to choose from; omitted when the calendar can't be changed (editing). */
			calendars?: CalendarInfo[];
			/** The series rule to edit; undefined hides the "Repeat" settings (single occurrence). */
			rule?: RuleChoice;
			save: (draft: EventDraft, calendar: CalendarInfo, rule: RuleChoice) => Promise<void>;
		}
	) {
		super(app);
		this.draft = { ...options.draft };
		this.calendar = options.calendar;
		this.rule = options.rule ?? null;
	}

	private rule: RuleChoice;

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText(this.options.heading);
		contentEl.addClass("nc-cal-form");
		const draft = this.draft;

		new Setting(contentEl).setName("Titel").addText((t) => {
			t.setValue(draft.title).onChange((v) => (draft.title = v));
			window.setTimeout(() => t.inputEl.focus());
		});

		const calendarSetting = new Setting(contentEl).setName("Kalender");
		if (this.options.calendars) {
			calendarSetting.addDropdown((d) => {
				for (const c of this.options.calendars!) d.addOption(c.path, c.name);
				d.setValue(this.calendar.path).onChange((path) => {
					this.calendar = this.options.calendars!.find((c) => c.path === path)!;
				});
			});
		} else {
			calendarSetting.setDesc(this.calendar.name);
		}

		new Setting(contentEl).setName("Ganztägig").addToggle((t) =>
			t.setValue(draft.allDay).onChange((allDay) => {
				// Keep the same days; give timed events a default slot.
				const days = dayCount(draft);
				draft.allDay = allDay;
				if (allDay) {
					draft.start = moment(draft.start).startOf("day").toDate();
					draft.end = moment(draft.start).add(days, "days").toDate();
				} else {
					draft.start = moment(draft.start).hour(9).toDate();
					draft.end = moment(draft.start).add(1, "hour").toDate();
				}
				renderTimes();
			})
		);

		const timesEl = contentEl.createDiv();
		const renderTimes = () => {
			timesEl.empty();
			// Moving the start moves the end too (keeping the duration), so the end inputs need refreshing.
			this.dateTimeSetting(timesEl, "Beginn", "start", () => end.refresh());
			const end = this.dateTimeSetting(timesEl, "Ende", "end", () => {});
		};
		renderTimes();

		if (this.options.rule !== undefined) {
			renderRecurrenceSetting(contentEl, this.rule, () => draft.start, (rule) => (this.rule = rule));
		}

		new Setting(contentEl).setName("Ort").addText((t) => t.setValue(draft.location).onChange((v) => (draft.location = v)));
		new Setting(contentEl).setName("Beschreibung").addTextArea((t) => {
			t.setValue(draft.description).onChange((v) => (draft.description = v));
			t.inputEl.rows = 4;
		});

		let saveButton: ButtonComponent;
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Abbrechen").onClick(() => this.close()))
			.addButton((b) => {
				saveButton = b;
				b.setButtonText("Speichern")
					.setCta()
					.onClick(async () => {
						const problem = validate(draft);
						if (problem) {
							new Notice(problem);
							return;
						}
						saveButton.setDisabled(true);
						try {
							await this.options.save({ ...draft, title: draft.title.trim() }, this.calendar, this.rule);
							this.close();
						} catch (e) {
							new Notice(`Termin konnte nicht gespeichert werden: ${errorMessage(e)}`, 8000);
						} finally {
							saveButton.setDisabled(false);
						}
					});
			});
	}

	onClose() {
		this.contentEl.empty();
	}

	/**
	 * Date (+ time unless all-day) inputs for start or end. For all-day events the end
	 * is shown as the last day, while the draft keeps it exclusive (the day after).
	 */
	private dateTimeSetting(container: HTMLElement, label: string, field: "start" | "end", onChange: () => void) {
		const draft = this.draft;
		const shown = () => (field === "end" && draft.allDay ? moment(draft.end).subtract(1, "day") : moment(draft[field]));
		const setting = new Setting(container).setName(label);
		const dateInput = setting.controlEl.createEl("input", { type: "date" });
		const timeInput = draft.allDay ? null : setting.controlEl.createEl("input", { type: "time" });
		const refresh = () => {
			dateInput.value = shown().format("YYYY-MM-DD");
			if (timeInput) timeInput.value = shown().format("HH:mm");
		};
		refresh();

		const update = () => {
			const date = moment(dateInput.value, "YYYY-MM-DD", true);
			const time = timeInput ? moment(timeInput.value, "HH:mm", true) : null;
			if (!date.isValid() || (time && !time.isValid())) return;
			let value = date.clone();
			if (time) value.hour(time.hour()).minute(time.minute());
			if (field === "end" && draft.allDay) value = value.add(1, "day");
			if (field === "start") {
				const duration = draft.end.getTime() - draft.start.getTime();
				draft.start = value.toDate();
				draft.end = new Date(draft.start.getTime() + duration);
			} else {
				draft.end = value.toDate();
			}
			onChange();
		};
		dateInput.addEventListener("change", update);
		timeInput?.addEventListener("change", update);
		return { refresh };
	}
}

/** Asks which part of a recurring series an edit or delete applies to; null when cancelled. */
export function chooseScope(app: App, title: string): Promise<Scope | null> {
	return new Promise((resolve) => {
		let scope: Scope | null = null;
		const modal = new Modal(app);
		modal.titleEl.setText(title);
		modal.contentEl.createEl("p", { text: "Dieser Termin gehört zu einer Serie." });
		const choices: [Scope, string][] = [
			["this", "Nur dieser Termin"],
			["following", "Dieser und alle folgenden"],
			["all", "Alle Termine der Serie"],
		];
		const buttons = modal.contentEl.createDiv({ cls: "nc-scope-choices" });
		for (const [value, label] of choices) {
			new ButtonComponent(buttons).setButtonText(label).onClick(() => {
				scope = value;
				modal.close();
			});
		}
		modal.onClose = () => resolve(scope);
		modal.open();
	});
}

export function formatRange(event: { start: Date; end: Date; allDay: boolean }): string {
	const start = moment(event.start);
	if (event.allDay) {
		const last = moment(event.end).subtract(1, "day");
		return last.isSame(start, "day") ? `${start.format("dddd, ll")} · ganztägig` : `${start.format("ll")} – ${last.format("ll")} · ganztägig`;
	}
	const end = moment(event.end);
	return end.isSame(start, "day")
		? `${start.format("dddd, ll")} · ${start.format("LT")} – ${end.format("LT")}`
		: `${start.format("ll LT")} – ${end.format("ll LT")}`;
}

function dayCount(draft: EventDraft): number {
	return Math.max(1, Math.ceil(moment(draft.end).diff(moment(draft.start).startOf("day"), "days", true)));
}

function validate(draft: EventDraft): string | null {
	if (!draft.title.trim()) return "Bitte einen Titel eingeben.";
	if (draft.allDay ? draft.end <= draft.start : draft.end < draft.start) return "Das Ende darf nicht vor dem Beginn liegen.";
	return null;
}
