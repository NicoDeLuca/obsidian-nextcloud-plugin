import { App } from "obsidian";
import { BlockDefinition, BlockError, BlockWidget, findByName, Options } from "../../core/blocks";
import { DeckApi, DeckBoard, DeckStack } from "./DeckApi";
import { DeckActions, renderAddCard, renderCard } from "./DeckBoard";

/**
 * ```nextcloud-deck
 * board: Projekte       # Standard: das erste Board
 * liste: In Arbeit      # eine oder mehrere Listen (Standard: alle)
 * erledigte: ja
 * max: 10               # Karten pro Liste
 * hinzufuegen: ja
 * ```
 */
export function deckBlock(api: DeckApi): BlockDefinition {
	return {
		language: "nextcloud-deck",
		title: "Deck-Board",
		template: "board: \nliste: ",
		keys: ["titel", "board", "liste", "erledigte", "max", "hinzufuegen"],
		create: (el, options, host) => new DeckBlock(el, host.app, options, api),
	};
}

class DeckBlock extends BlockWidget {
	private actions: DeckActions;
	private board: DeckBoard | null = null;
	private stacks: DeckStack[] = [];
	/** List whose "add card" field had the focus, to restore it after the redraw. */
	private addingTo: number | null = null;

	constructor(el: HTMLElement, app: App, options: Options, private api: DeckApi) {
		super(el, app, options, ["Deck", options.string("board"), options.list("liste").join(", ")].filter(Boolean).join(" · "));
		this.actions = new DeckActions(app, api, () => ({ board: this.board!, stacks: this.stacks }), () => this.refresh());
	}

	protected async update(body: HTMLElement, isCurrent: () => boolean) {
		const boards = await this.api.listBoards();
		if (!boards.length) throw new BlockError("Keine Deck-Boards gefunden.");
		const name = this.options.string("board");
		const stub = name ? findByName(boards, name, (b) => b.title, "Board") : boards[0];
		const [board, allStacks] = await Promise.all([this.api.getBoard(stub.id), this.api.getStacks(stub.id)]);
		if (!isCurrent()) return;
		const names = this.options.list("liste");
		const shown = names.length ? names.map((n) => findByName(allStacks, n, (s) => s.title, "Liste")) : allStacks;
		this.board = board;
		this.stacks = allStacks;
		this.setTitle(["Deck", board.title, names.length ? shown.map((s) => s.title).join(", ") : ""].filter(Boolean).join(" · "));

		const withDone = this.options.boolean("erledigte", true);
		const max = this.options.number("max", 0, 0, 500);
		const canAdd = board.canEdit && this.options.boolean("hinzufuegen", true);
		const columns = body.createDiv({ cls: "nc-deck-columns nc-block-deck" });
		columns.style.setProperty("--nc-deck-board", board.color);
		columns.toggleClass("is-single", shown.length === 1);
		if (!shown.length) columns.createEl("p", { text: "Dieses Board hat noch keine Listen.", cls: "nc-cookbook-status" });

		for (const stack of shown) {
			const cards = stack.cards.filter((c) => withDone || !c.done);
			const column = columns.createDiv({ cls: "nc-deck-stack" });
			const head = column.createDiv({ cls: "nc-deck-stack-head" });
			head.createSpan({ text: stack.title, cls: "nc-deck-stack-title" });
			head.createSpan({ text: String(cards.length), cls: "nc-deck-stack-count" });
			const list = column.createDiv({ cls: "nc-deck-cards" });
			for (const card of max ? cards.slice(0, max) : cards) renderCard(list, card, this.actions);
			if (max && cards.length > max) list.createEl("p", { text: `… und ${cards.length - max} weitere`, cls: "nc-cookbook-status" });
			if (canAdd) {
				const add = renderAddCard(column, stack, this.actions);
				add.addEventListener("keydown", (evt) => {
					if (evt.key === "Enter") this.addingTo = stack.id;
				});
				if (this.addingTo === stack.id) {
					this.addingTo = null;
					window.setTimeout(() => add.focus());
				}
			}
		}
	}
}
