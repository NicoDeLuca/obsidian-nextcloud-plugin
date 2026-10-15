import { App, ButtonComponent, Modal, moment, Notice, Setting } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { describeRecurrence } from "../../core/recurrence";
import { renderRecurrenceSetting } from "../../core/RecurrenceSetting";
import { RuleChoice, Task, TaskDraft } from "./vtodo";

export const PRIORITIES: Record<string, string> = { "0": "Keine", "1": "Hoch", "5": "Mittel", "9": "Niedrig" };

/** Details of a task; editable unless it is in a read-only list. */
export class TaskModal extends Modal {
	private draft: TaskDraft;
	private rule: RuleChoice;

	constructor(
		app: App,
		private task: Task,
		private actions: { save: (draft: TaskDraft, rule: RuleChoice) => Promise<void>; delete: () => void }
	) {
		super(app);
		this.draft = { title: task.title, notes: task.notes, due: task.due, dueAllDay: task.dueAllDay, priority: priorityBucket(task.priority) };
		this.rule = task.rule;
	}

	onOpen() {
		const { task, contentEl } = this;
		contentEl.addClass("nc-task-modal");
		const listEl = contentEl.createEl("p", { cls: "nc-task-modal-list" });
		listEl.createSpan({ cls: "nc-cal-dot" }).style.background = task.list.color;
		listEl.createSpan({ text: task.list.name });

		if (task.list.readOnly) {
			this.titleEl.setText(task.title || "(Ohne Titel)");
			if (task.due) contentEl.createEl("p", { text: `Fällig: ${formatDue(task)}` });
			if (task.rule) contentEl.createEl("p", { text: `↻ ${describeRecurrence(task.rule)}` });
			if (task.notes) contentEl.createEl("p", { text: task.notes, cls: "nc-cal-detail-description" });
			contentEl.createEl("p", { text: "Diese Liste ist schreibgeschützt.", cls: "nc-cal-hint" });
			return;
		}

		this.titleEl.setText("Aufgabe bearbeiten");
		const draft = this.draft;
		new Setting(contentEl).setName("Titel").addText((t) => t.setValue(draft.title).onChange((v) => (draft.title = v)));

		const dueSetting = new Setting(contentEl).setName("Fällig").setDesc("Ohne Uhrzeit gilt der ganze Tag.");
		const dateInput = dueSetting.controlEl.createEl("input", { type: "date" });
		const timeInput = dueSetting.controlEl.createEl("input", { type: "time" });
		if (draft.due) {
			dateInput.value = moment(draft.due).format("YYYY-MM-DD");
			if (!draft.dueAllDay) timeInput.value = moment(draft.due).format("HH:mm");
		}
		const updateDue = () => {
			const date = moment(dateInput.value, "YYYY-MM-DD", true);
			if (!date.isValid()) {
				draft.due = null;
				return;
			}
			const time = moment(timeInput.value, "HH:mm", true);
			draft.dueAllDay = !time.isValid();
			draft.due = (time.isValid() ? date.hour(time.hour()).minute(time.minute()) : date).toDate();
		};
		dateInput.addEventListener("change", updateDue);
		timeInput.addEventListener("change", updateDue);
		dueSetting.addExtraButton((b) =>
			b
				.setIcon("x")
				.setTooltip("Kein Fälligkeitsdatum")
				.onClick(() => {
					dateInput.value = "";
					timeInput.value = "";
					updateDue();
				})
		);

		renderRecurrenceSetting(contentEl, this.rule, () => draft.due ?? new Date(), (rule) => (this.rule = rule));

		new Setting(contentEl).setName("Priorität").addDropdown((d) =>
			d
				.addOptions(PRIORITIES)
				.setValue(String(draft.priority))
				.onChange((v) => (draft.priority = Number(v)))
		);
		new Setting(contentEl).setName("Notizen").addTextArea((t) => {
			t.setValue(draft.notes).onChange((v) => (draft.notes = v));
			t.inputEl.rows = 4;
		});

		let saveButton: ButtonComponent;
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
			.addButton((b) => b.setButtonText("Abbrechen").onClick(() => this.close()))
			.addButton((b) => {
				saveButton = b;
				b.setButtonText("Speichern")
					.setCta()
					.onClick(async () => {
						if (!draft.title.trim()) {
							new Notice("Bitte einen Titel eingeben.");
							return;
						}
						if (this.rule && !draft.due) {
							new Notice("Eine wiederkehrende Aufgabe braucht ein Fälligkeitsdatum.");
							return;
						}
						saveButton.setDisabled(true);
						try {
							// Keep an in-between priority (e.g. 3) unless a different choice was made.
							const priority = draft.priority === priorityBucket(task.priority) ? task.priority : draft.priority;
							await this.actions.save({ ...draft, title: draft.title.trim(), priority }, this.rule);
							this.close();
						} catch (e) {
							new Notice(`Aufgabe konnte nicht gespeichert werden: ${errorMessage(e)}`, 8000);
						} finally {
							saveButton.setDisabled(false);
						}
					});
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** "Heute", "Morgen 14:00", "Gestern" oder ein Datum. */
export function formatDue(task: { due: Date | null; dueAllDay: boolean }): string {
	if (!task.due) return "";
	const due = moment(task.due);
	const today = moment().startOf("day");
	const days = due.clone().startOf("day").diff(today, "days");
	const day = days === 0 ? "Heute" : days === 1 ? "Morgen" : days === -1 ? "Gestern" : due.format("ll");
	return task.dueAllDay ? day : `${day} ${due.format("LT")}`;
}

export function isOverdue(task: Task): boolean {
	if (!task.due || task.completed) return false;
	return task.dueAllDay ? moment(task.due).isBefore(moment(), "day") : task.due.getTime() < Date.now();
}

/** Maps any iCalendar priority (1–9) onto the three choices of the form, like Nextcloud Tasks does. */
export function priorityBucket(priority: number): number {
	if (!priority) return 0;
	return priority < 5 ? 1 : priority === 5 ? 5 : 9;
}
