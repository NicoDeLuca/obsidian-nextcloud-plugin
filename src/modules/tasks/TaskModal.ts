import { App, ButtonComponent, Modal, moment, Notice, Setting } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { describeRecurrence } from "../../core/recurrence";
import { renderRecurrenceSetting } from "../../core/RecurrenceSetting";
import { RuleChoice, Task, TaskDraft } from "./vtodo";

export const PRIORITIES: Record<string, string> = { "0": "None", "1": "High", "5": "Medium", "9": "Low" };

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
			this.titleEl.setText(task.title || "(No title)");
			if (task.due) contentEl.createEl("p", { text: `Due: ${formatDue(task)}` });
			if (task.rule) contentEl.createEl("p", { text: `↻ ${describeRecurrence(task.rule)}` });
			if (task.notes) contentEl.createEl("p", { text: task.notes, cls: "nc-cal-detail-description" });
			contentEl.createEl("p", { text: "This list is read-only.", cls: "nc-cal-hint" });
			return;
		}

		this.titleEl.setText("Edit task");
		const draft = this.draft;
		new Setting(contentEl).setName("Title").addText((t) => t.setValue(draft.title).onChange((v) => (draft.title = v)));

		const dueSetting = new Setting(contentEl).setName("Due").setDesc("Leave the time empty for a whole day.");
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
				.setTooltip("No due date")
				.onClick(() => {
					dateInput.value = "";
					timeInput.value = "";
					updateDue();
				})
		);

		renderRecurrenceSetting(contentEl, this.rule, () => draft.due ?? new Date(), (rule) => (this.rule = rule));

		new Setting(contentEl).setName("Priority").addDropdown((d) =>
			d
				.addOptions(PRIORITIES)
				.setValue(String(draft.priority))
				.onChange((v) => (draft.priority = Number(v)))
		);
		new Setting(contentEl).setName("Notes").addTextArea((t) => {
			t.setValue(draft.notes).onChange((v) => (draft.notes = v));
			t.inputEl.rows = 4;
		});

		let saveButton: ButtonComponent;
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Delete")
					.setWarning()
					.onClick(() => {
						this.close();
						this.actions.delete();
					})
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => {
				saveButton = b;
				b.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						if (!draft.title.trim()) {
							new Notice("Please enter a title.");
							return;
						}
						if (this.rule && !draft.due) {
							new Notice("A repeating task needs a due date.");
							return;
						}
						saveButton.setDisabled(true);
						try {
							// Keep an in-between priority (e.g. 3) unless a different choice was made.
							const priority = draft.priority === priorityBucket(task.priority) ? task.priority : draft.priority;
							await this.actions.save({ ...draft, title: draft.title.trim(), priority }, this.rule);
							this.close();
						} catch (e) {
							new Notice(`Could not save task: ${errorMessage(e)}`, 8000);
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

/** "Today", "Tomorrow 14:00", "Yesterday", or a date. */
export function formatDue(task: { due: Date | null; dueAllDay: boolean }): string {
	if (!task.due) return "";
	const due = moment(task.due);
	const today = moment().startOf("day");
	const days = due.clone().startOf("day").diff(today, "days");
	const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : due.format("ll");
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
