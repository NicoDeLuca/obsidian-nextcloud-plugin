import { App, ButtonComponent, Modal, moment, Notice, Setting } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { CardChanges, DeckBoard, DeckCard, DeckStack } from "./DeckApi";

/** Everything the card form can change; the view applies it via the API. */
export interface CardEdit {
	changes: CardChanges;
	labelIds: Set<number>;
	stackId: number;
}

/** Shows a card; on editable boards it is a form with move, archive and delete. */
export class CardModal extends Modal {
	constructor(
		app: App,
		private board: DeckBoard,
		private stacks: DeckStack[],
		private card: DeckCard,
		private actions: { save: (edit: CardEdit) => Promise<void>; archive: () => void; delete: () => void }
	) {
		super(app);
	}

	onOpen() {
		const { card, board, contentEl } = this;
		contentEl.addClass("nc-deck-modal");

		if (!board.canEdit) {
			this.titleEl.setText(card.title);
			renderLabels(contentEl, card.labels);
			if (card.duedate) contentEl.createEl("p", { text: `Due: ${formatDue(card.duedate)}` });
			if (card.assignees.length) contentEl.createEl("p", { text: `Assigned: ${card.assignees.join(", ")}` });
			if (card.description) contentEl.createEl("p", { text: card.description, cls: "nc-cal-detail-description" });
			contentEl.createEl("p", { text: "You can't edit cards on this board.", cls: "nc-cal-hint" });
			return;
		}

		this.titleEl.setText("Edit card");
		const edit: CardEdit = {
			changes: {
				title: card.title,
				description: card.description,
				duedate: card.duedate,
				done: card.done === undefined ? undefined : !!card.done,
			},
			labelIds: new Set(card.labels.map((l) => l.id)),
			stackId: card.stackId,
		};
		const changes = edit.changes;

		new Setting(contentEl).setName("Title").addText((t) => t.setValue(changes.title).onChange((v) => (changes.title = v)));

		new Setting(contentEl).setName("List").addDropdown((d) => {
			for (const stack of this.stacks) d.addOption(String(stack.id), stack.title);
			d.setValue(String(card.stackId)).onChange((v) => (edit.stackId = Number(v)));
		});

		if (changes.done !== undefined) {
			new Setting(contentEl).setName("Done").addToggle((t) => t.setValue(!!changes.done).onChange((v) => (changes.done = v)));
		}

		const dueSetting = new Setting(contentEl).setName("Due").setDesc("Leave the time empty for the end of the day.");
		const dateInput = dueSetting.controlEl.createEl("input", { type: "date" });
		const timeInput = dueSetting.controlEl.createEl("input", { type: "time" });
		if (changes.duedate) {
			dateInput.value = moment(changes.duedate).format("YYYY-MM-DD");
			timeInput.value = moment(changes.duedate).format("HH:mm");
		}
		const updateDue = () => {
			const date = moment(dateInput.value, "YYYY-MM-DD", true);
			if (!date.isValid()) {
				changes.duedate = null;
				return;
			}
			// Deck due dates always have a time; without one, use the end of the day.
			const time = moment(timeInput.value, "HH:mm", true);
			changes.duedate = (time.isValid() ? date.hour(time.hour()).minute(time.minute()) : date.hour(23).minute(59)).toDate();
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

		if (board.labels.length) {
			const labelSetting = new Setting(contentEl).setName("Labels");
			const chips = labelSetting.controlEl.createDiv({ cls: "nc-deck-labels is-editable" });
			for (const label of board.labels) {
				const chip = chips.createSpan({ cls: "nc-deck-label", text: label.title });
				chip.style.setProperty("--nc-deck-label", `#${label.color}`);
				chip.toggleClass("is-off", !edit.labelIds.has(label.id));
				chip.addEventListener("click", () => {
					if (edit.labelIds.has(label.id)) edit.labelIds.delete(label.id);
					else edit.labelIds.add(label.id);
					chip.toggleClass("is-off", !edit.labelIds.has(label.id));
				});
			}
		}

		if (card.assignees.length) new Setting(contentEl).setName("Assigned").setDesc(card.assignees.join(", "));

		new Setting(contentEl).setName("Description").addTextArea((t) => {
			t.setValue(changes.description).onChange((v) => (changes.description = v));
			t.inputEl.rows = 6;
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
			.addButton((b) =>
				b.setButtonText("Archive").onClick(() => {
					this.close();
					this.actions.archive();
				})
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => {
				saveButton = b;
				b.setButtonText("Save")
					.setCta()
					.onClick(async () => {
						if (!changes.title.trim()) {
							new Notice("Please enter a title.");
							return;
						}
						saveButton.setDisabled(true);
						try {
							await this.actions.save({ ...edit, changes: { ...changes, title: changes.title.trim() } });
							this.close();
						} catch (e) {
							new Notice(`Could not save card: ${errorMessage(e)}`, 8000);
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

export function renderLabels(parent: HTMLElement, labels: { title: string; color: string }[]) {
	if (!labels.length) return;
	const row = parent.createDiv({ cls: "nc-deck-labels" });
	for (const label of labels) {
		const chip = row.createSpan({ cls: "nc-deck-label", text: label.title });
		chip.style.setProperty("--nc-deck-label", `#${label.color}`);
	}
}

/** "Today 14:00", "Tomorrow 23:59", or a date and time. */
export function formatDue(date: Date): string {
	const due = moment(date);
	const days = due.clone().startOf("day").diff(moment().startOf("day"), "days");
	const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : due.format("ll");
	return `${day} ${due.format("LT")}`;
}
