import { ButtonComponent, DropdownComponent, ItemView, Notice, Platform, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { confirmModal } from "../../core/ui";
import { CardEdit, CardModal, formatDue, renderLabels } from "./CardModal";
import { DeckApi, DeckBoard, DeckCard, DeckStack } from "./DeckApi";

export const DECK_VIEW = "nextcloud-deck";

interface DeckViewState {
	boardId?: number;
}

export class DeckView extends ItemView {
	private boardId: number | null = null;
	private boards: DeckBoard[] | null = null;
	private board: DeckBoard | null = null;
	private stacks: DeckStack[] = [];
	private loadId = 0;
	private dragged: DeckCard | null = null;
	private toolbarEl!: HTMLElement;
	private bodyEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private api: DeckApi) {
		super(leaf);
	}

	getViewType() {
		return DECK_VIEW;
	}

	getDisplayText() {
		return "Deck";
	}

	getIcon() {
		return "kanban";
	}

	getState(): Record<string, unknown> {
		return { boardId: this.boardId ?? undefined };
	}

	async setState(state: unknown, result: ViewStateResult) {
		const { boardId } = (state ?? {}) as DeckViewState;
		if (boardId) this.boardId = boardId;
		await super.setState(state, result);
		await this.loadBoard();
	}

	async onOpen() {
		this.contentEl.addClass("nc-deck");
		this.toolbarEl = this.contentEl.createDiv({ cls: "nc-cal-toolbar" });
		this.bodyEl = this.contentEl.createDiv({ cls: "nc-deck-body" });
		await this.loadBoard();
	}

	async reload() {
		this.boards = null;
		await this.loadBoard();
	}

	private async loadBoard() {
		if (!this.bodyEl) return; // setState can run before onOpen
		const loadId = ++this.loadId;
		this.bodyEl.empty();
		this.bodyEl.createEl("p", { text: "Wird geladen …", cls: "nc-cookbook-status" });
		try {
			if (!this.boards) this.boards = await this.api.listBoards();
			if (loadId !== this.loadId) return;
			if (!this.boards.some((b) => b.id === this.boardId)) this.boardId = this.boards[0]?.id ?? null;
			this.renderToolbar();
			if (this.boardId === null) {
				this.bodyEl.empty();
				this.bodyEl.createEl("p", { text: "Keine Boards gefunden.", cls: "nc-cookbook-status" });
				return;
			}
			const [board, stacks] = await Promise.all([this.api.getBoard(this.boardId), this.api.getStacks(this.boardId)]);
			if (loadId !== this.loadId) return;
			this.board = board;
			this.stacks = stacks;
		} catch (e) {
			if (loadId !== this.loadId) return;
			this.bodyEl.empty();
			this.bodyEl.createEl("p", { text: `Deck konnte nicht geladen werden: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
			return;
		}
		this.renderBoard();
	}

	private renderToolbar() {
		const bar = this.toolbarEl;
		bar.empty();
		const dropdown = new DropdownComponent(bar);
		for (const board of this.boards ?? []) dropdown.addOption(String(board.id), board.title);
		dropdown.setValue(String(this.boardId ?? "")).onChange((id) => {
			this.boardId = Number(id);
			this.app.workspace.requestSaveLayout();
			this.loadBoard();
		});
		new ButtonComponent(bar.createDiv({ cls: "nc-cal-toolbar-group" }))
			.setIcon("refresh-cw")
			.setTooltip("Neu laden")
			.onClick(() => this.reload());
	}

	private renderBoard() {
		const board = this.board!;
		this.bodyEl.empty();
		const columns = this.bodyEl.createDiv({ cls: "nc-deck-columns" });
		columns.style.setProperty("--nc-deck-board", board.color);
		if (!this.stacks.length) {
			columns.createEl("p", { text: "Dieses Board hat noch keine Listen.", cls: "nc-cookbook-status" });
			return;
		}
		for (const stack of this.stacks) this.renderStack(columns, board, stack);
	}

	private renderStack(parent: HTMLElement, board: DeckBoard, stack: DeckStack) {
		const column = parent.createDiv({ cls: "nc-deck-stack" });
		const head = column.createDiv({ cls: "nc-deck-stack-head" });
		head.createSpan({ text: stack.title, cls: "nc-deck-stack-title" });
		head.createSpan({ text: String(stack.cards.length), cls: "nc-deck-stack-count" });

		const list = column.createDiv({ cls: "nc-deck-cards" });
		for (const card of stack.cards) this.renderCard(list, board, card);

		// Drag and drop between and within lists (desktop; on mobile, "List" in the card form moves cards).
		if (board.canEdit && !Platform.isMobile) {
			list.addEventListener("dragover", (evt) => {
				if (!this.dragged) return;
				evt.preventDefault();
				list.addClass("is-drop-target");
			});
			list.addEventListener("dragleave", () => list.removeClass("is-drop-target"));
			list.addEventListener("drop", (evt) => {
				evt.preventDefault();
				list.removeClass("is-drop-target");
				const card = this.dragged;
				this.dragged = null;
				if (!card) return;
				// Position among the other cards, by where the card was dropped.
				const others = Array.from(list.querySelectorAll<HTMLElement>(".nc-deck-card")).filter((el) => el.dataset.cardId !== String(card.id));
				const index = others.findIndex((el) => {
					const rect = el.getBoundingClientRect();
					return evt.clientY < rect.top + rect.height / 2;
				});
				this.moveCard(card, stack.id, index === -1 ? others.length : index);
			});
		}

		if (board.canEdit) {
			const add = column.createEl("input", {
				type: "text",
				cls: "nc-deck-add",
				attr: { placeholder: "Karte hinzufügen …", enterkeyhint: "done" },
			});
			add.addEventListener("keydown", async (evt) => {
				if (evt.key !== "Enter" || evt.isComposing || !add.value.trim()) return;
				const title = add.value.trim();
				add.value = "";
				try {
					await this.api.createCard(board.id, stack.id, title, stack.cards.length);
				} catch (e) {
					new Notice(`Karte konnte nicht angelegt werden: ${errorMessage(e)}`, 8000);
				}
				await this.loadBoard();
				// Keep typing in the same list after the redraw.
				const index = this.stacks.findIndex((s) => s.id === stack.id);
				this.bodyEl.querySelectorAll<HTMLInputElement>(".nc-deck-add")[index]?.focus();
			});
		}
	}

	private renderCard(parent: HTMLElement, board: DeckBoard, card: DeckCard) {
		const el = parent.createDiv({ cls: "nc-deck-card" });
		el.dataset.cardId = String(card.id);
		el.toggleClass("is-done", !!card.done);
		if (board.canEdit && !Platform.isMobile) {
			el.draggable = true;
			el.addEventListener("dragstart", (evt) => {
				this.dragged = card;
				evt.dataTransfer?.setData("text/plain", card.title);
				el.addClass("is-dragging");
			});
			el.addEventListener("dragend", () => {
				el.removeClass("is-dragging");
				this.dragged = null;
			});
		}

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

		el.addEventListener("click", () =>
			new CardModal(this.app, board, this.stacks, card, {
				save: (edit) => this.saveCard(card, edit),
				archive: () => this.archiveCard(card),
				delete: () => this.deleteCard(card),
			}).open()
		);
	}

	private async moveCard(card: DeckCard, stackId: number, order: number) {
		try {
			await this.api.moveCard(this.board!.id, card, stackId, order);
		} catch (e) {
			new Notice(`Karte konnte nicht verschoben werden: ${errorMessage(e)}`, 8000);
		}
		this.loadBoard();
	}

	private async saveCard(card: DeckCard, edit: CardEdit) {
		const boardId = this.board!.id;
		// Deck has no ETags for writes; compare the modification time instead.
		const current = await this.api.getCard(boardId, card.stackId, card.id);
		if (current.lastModified !== card.lastModified) {
			const overwrite = await confirmModal(
				this.app,
				"Karte wurde woanders geändert",
				"Diese Karte wurde woanders geändert, nachdem das Board geladen wurde. Speichern überschreibt diese Änderungen.",
				"Überschreiben"
			);
			if (!overwrite) throw new Error("abgebrochen, weil die Karte woanders geändert wurde");
		}
		await this.api.updateCard(boardId, current, edit.changes);
		const before = new Set(current.labels.map((l) => l.id));
		for (const label of this.board!.labels) {
			const wanted = edit.labelIds.has(label.id);
			if (wanted !== before.has(label.id)) await this.api.setLabel(boardId, current, label.id, wanted);
		}
		if (edit.stackId !== current.stackId) {
			const target = this.stacks.find((s) => s.id === edit.stackId);
			await this.api.moveCard(boardId, current, edit.stackId, target?.cards.length ?? 0);
		}
		new Notice("Karte gespeichert.");
		this.loadBoard();
	}

	private async archiveCard(card: DeckCard) {
		try {
			await this.api.archiveCard(this.board!.id, card);
			new Notice("Karte archiviert.");
		} catch (e) {
			new Notice(`Karte konnte nicht archiviert werden: ${errorMessage(e)}`, 8000);
		}
		this.loadBoard();
	}

	private async deleteCard(card: DeckCard) {
		const confirmed = await confirmModal(this.app, "Karte löschen", `"${card.title}" löschen?`, "Löschen");
		if (!confirmed) return;
		try {
			await this.api.deleteCard(this.board!.id, card);
			new Notice("Karte gelöscht.");
		} catch (e) {
			new Notice(`Karte konnte nicht gelöscht werden: ${errorMessage(e)}`, 8000);
		}
		this.loadBoard();
	}
}
