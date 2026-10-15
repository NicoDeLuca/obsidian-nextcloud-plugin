import { App, Notice } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { confirmModal } from "../../core/ui";
import { CardEdit, CardModal, formatDue, renderLabels } from "./CardModal";
import { DeckApi, DeckBoard, DeckCard, DeckStack } from "./DeckApi";

/** What can be done with cards of the currently shown board. Calls `changed` afterwards. */
export class DeckActions {
	constructor(
		private app: App,
		private api: DeckApi,
		/** The board and its lists as currently shown. */
		private current: () => { board: DeckBoard; stacks: DeckStack[] },
		private changed: () => void | Promise<void>
	) {}

	open(card: DeckCard) {
		const { board, stacks } = this.current();
		new CardModal(this.app, board, stacks, card, {
			save: (edit) => this.save(card, edit),
			archive: () => this.archive(card),
			delete: () => this.delete(card),
		}).open();
	}

	async create(stack: DeckStack, title: string) {
		try {
			await this.api.createCard(this.current().board.id, stack.id, title, stack.cards.length);
		} catch (e) {
			new Notice(`Karte konnte nicht angelegt werden: ${errorMessage(e)}`, 8000);
		}
		await this.changed();
	}

	async move(card: DeckCard, stackId: number, order: number) {
		try {
			await this.api.moveCard(this.current().board.id, card, stackId, order);
		} catch (e) {
			new Notice(`Karte konnte nicht verschoben werden: ${errorMessage(e)}`, 8000);
		}
		await this.changed();
	}

	private async save(card: DeckCard, edit: CardEdit) {
		const { board, stacks } = this.current();
		// Deck has no ETags for writes; compare the modification time instead.
		const current = await this.api.getCard(board.id, card.stackId, card.id);
		if (current.lastModified !== card.lastModified) {
			const overwrite = await confirmModal(
				this.app,
				"Karte wurde woanders geändert",
				"Diese Karte wurde woanders geändert, nachdem das Board geladen wurde. Speichern überschreibt diese Änderungen.",
				"Überschreiben"
			);
			if (!overwrite) throw new Error("abgebrochen, weil die Karte woanders geändert wurde");
		}
		await this.api.updateCard(board.id, current, edit.changes);
		const before = new Set(current.labels.map((l) => l.id));
		for (const label of board.labels) {
			const wanted = edit.labelIds.has(label.id);
			if (wanted !== before.has(label.id)) await this.api.setLabel(board.id, current, label.id, wanted);
		}
		if (edit.stackId !== current.stackId) {
			const target = stacks.find((s) => s.id === edit.stackId);
			await this.api.moveCard(board.id, current, edit.stackId, target?.cards.length ?? 0);
		}
		new Notice("Karte gespeichert.");
		await this.changed();
	}

	private async archive(card: DeckCard) {
		try {
			await this.api.archiveCard(this.current().board.id, card);
			new Notice("Karte archiviert.");
		} catch (e) {
			new Notice(`Karte konnte nicht archiviert werden: ${errorMessage(e)}`, 8000);
		}
		await this.changed();
	}

	private async delete(card: DeckCard) {
		const confirmed = await confirmModal(this.app, "Karte löschen", `"${card.title}" löschen?`, "Löschen");
		if (!confirmed) return;
		try {
			await this.api.deleteCard(this.current().board.id, card);
			new Notice("Karte gelöscht.");
		} catch (e) {
			new Notice(`Karte konnte nicht gelöscht werden: ${errorMessage(e)}`, 8000);
		}
		await this.changed();
	}
}

/** One card with labels, title, done state, due date and assignees; a click opens it. */
export function renderCard(parent: HTMLElement, card: DeckCard, actions: DeckActions): HTMLElement {
	const el = parent.createDiv({ cls: "nc-deck-card" });
	el.dataset.cardId = String(card.id);
	el.toggleClass("is-done", !!card.done);
	renderLabels(el, card.labels);
	el.createDiv({ cls: "nc-deck-card-title", text: card.title });
	const meta = el.createDiv({ cls: "nc-task-meta" });
	if (card.done) meta.createSpan({ text: "✓ Erledigt", cls: "nc-deck-done" });
	if (card.duedate) {
		const overdue = !card.done && card.duedate.getTime() < Date.now();
		meta.createSpan({ text: formatDue(card.duedate), cls: overdue ? "nc-task-due is-overdue" : "nc-task-due" });
	}
	if (card.description) meta.createSpan({ text: "¶", attr: { title: "Hat eine Beschreibung" } });
	if (card.assignees.length) meta.createSpan({ text: card.assignees.join(", "), cls: "nc-deck-assignees" });
	el.addEventListener("click", () => actions.open(card));
	return el;
}

/** A text field that adds a card to the list on Enter. */
export function renderAddCard(parent: HTMLElement, stack: DeckStack, actions: DeckActions): HTMLInputElement {
	const add = parent.createEl("input", {
		type: "text",
		cls: "nc-deck-add",
		attr: { placeholder: "Karte hinzufügen …", enterkeyhint: "done" },
	});
	add.dataset.stackId = String(stack.id);
	add.addEventListener("keydown", (evt) => {
		if (evt.key !== "Enter" || evt.isComposing || !add.value.trim()) return;
		const title = add.value.trim();
		add.value = "";
		actions.create(stack, title);
	});
	return add;
}
