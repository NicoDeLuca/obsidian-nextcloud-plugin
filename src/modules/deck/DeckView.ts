import { ButtonComponent, DropdownComponent, ItemView, Platform, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { DeckApi, DeckBoard, DeckCard, DeckStack } from "./DeckApi";
import { DeckActions, renderAddCard, renderCard } from "./DeckBoard";

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
	private actions: DeckActions;
	/** List whose "add card" field had the focus, to restore it after the redraw. */
	private addingTo: number | null = null;

	constructor(leaf: WorkspaceLeaf, private api: DeckApi) {
		super(leaf);
		this.actions = new DeckActions(this.app, api, () => ({ board: this.board!, stacks: this.stacks }), () => this.loadBoard());
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
				this.actions.move(card, stack.id, index === -1 ? others.length : index);
			});
		}

		if (board.canEdit) {
			const add = renderAddCard(column, stack, this.actions);
			add.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") this.addingTo = stack.id;
			});
			// Keep typing in the same list after the redraw.
			if (this.addingTo === stack.id) {
				this.addingTo = null;
				window.setTimeout(() => add.focus());
			}
		}
	}

	private renderCard(parent: HTMLElement, board: DeckBoard, card: DeckCard) {
		const el = renderCard(parent, card, this.actions);
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
	}
}
