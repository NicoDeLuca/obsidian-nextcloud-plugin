import { findByName } from "../../core/blocks";
import { DeckApi } from "./DeckApi";

/** `api.deck`: read boards and cards from scripts. */
export function deckApi(api: DeckApi) {
	return {
		async boards() {
			return (await api.listBoards()).map((b) => ({ id: b.id, title: b.title }));
		},

		/** Cards of a board (name; default the first board), optionally only of the named lists. Archived cards are not included. */
		async cards(options: { board?: string; lists?: string[] } = {}) {
			const boards = await api.listBoards();
			if (!boards.length) return [];
			const board = options.board ? findByName(boards, options.board, (b) => b.title, "Board") : boards[0];
			const stacks = await api.getStacks(board.id);
			const shown = options.lists?.length ? options.lists.map((n) => findByName(stacks, n, (s) => s.title, "Liste")) : stacks;
			return shown.flatMap((stack) =>
				stack.cards.map((c) => ({
					title: c.title,
					description: c.description,
					list: stack.title,
					board: board.title,
					due: c.duedate,
					done: !!c.done,
					labels: c.labels.map((l) => l.title),
					assignees: c.assignees,
				}))
			);
		},
	};
}
