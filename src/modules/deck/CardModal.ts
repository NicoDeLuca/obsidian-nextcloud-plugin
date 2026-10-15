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
			if (card.duedate) contentEl.createEl("p", { text: `Fällig: ${formatDue(card.duedate)}` });
			if (card.assignees.length) contentEl.createEl("p", { text: `Zugewiesen: ${card.assignees.join(", ")}` });
			if (card.description) contentEl.createEl("p", { text: card.description, cls: "nc-cal-detail-description" });
			contentEl.createEl("p", { text: "Karten auf diesem Board kannst du nicht bearbeiten.", cls: "nc-cal-hint" });
			return;
		}

		this.titleEl.setText("Karte bearbeiten");
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

		new Setting(contentEl).setName("Titel").addText((t) => t.setValue(changes.title).onChange((v) => (changes.title = v)));

		new Setting(contentEl).setName("Liste").addDropdown((d) => {
			for (const stack of this.stacks) d.addOption(String(stack.id), stack.title);
			d.setValue(String(card.stackId)).onChange((v) => (edit.stackId = Number(v)));
		});

		if (changes.done !== undefined) {
			new Setting(contentEl).setName("Erledigt").addToggle((t) => t.setValue(!!changes.done).onChange((v) => (changes.done = v)));
		}

		const dueSetting = new Setting(contentEl).setName("Fällig").setDesc("Ohne Uhrzeit gilt das Ende des Tages.");
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
				.setTooltip("Kein Fälligkeitsdatum")
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

		if (card.assignees.length) new Setting(contentEl).setName("Zugewiesen").setDesc(card.assignees.join(", "));

		new Setting(contentEl).setName("Beschreibung").addTextArea((t) => {
			t.setValue(changes.description).onChange((v) => (changes.description = v));
			t.inputEl.rows = 6;
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
			.addButton((b) =>
				b.setButtonText("Archivieren").onClick(() => {
					this.close();
					this.actions.archive();
				})
			)
			.addButton((b) => b.setButtonText("Abbrechen").onClick(() => this.close()))
			.addButton((b) => {
				saveButton = b;
				b.setButtonText("Speichern")
					.setCta()
					.onClick(async () => {
						if (!changes.title.trim()) {
							new Notice("Bitte einen Titel eingeben.");
							return;
						}
						saveButton.setDisabled(true);
						try {
							await this.actions.save({ ...edit, changes: { ...changes, title: changes.title.trim() } });
							this.close();
						} catch (e) {
							new Notice(`Karte konnte nicht gespeichert werden: ${errorMessage(e)}`, 8000);
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

/** "Heute 14:00", "Morgen 23:59" oder Datum und Uhrzeit. */
export function formatDue(date: Date): string {
	const due = moment(date);
	const days = due.clone().startOf("day").diff(moment().startOf("day"), "days");
	const day = days === 0 ? "Heute" : days === 1 ? "Morgen" : days === -1 ? "Gestern" : due.format("ll");
	return `${day} ${due.format("LT")}`;
}
