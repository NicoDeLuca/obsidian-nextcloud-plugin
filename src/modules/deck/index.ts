import { App } from "obsidian";
import { NextcloudModule } from "../../core/types";
import { DeckApi } from "./DeckApi";
import { DECK_VIEW, DeckView } from "./DeckView";

export const deckModule: NextcloudModule = {
	id: "deck",
	name: "Deck",
	description: "Kanban-Boards aus Nextcloud Deck: Karten ansehen, anlegen, bearbeiten und verschieben.",
	load(ctx) {
		const app = ctx.plugin.app;
		const api = new DeckApi(ctx.client);

		ctx.registerView(DECK_VIEW, (leaf) => new DeckView(leaf, api));
		ctx.addRibbonIcon("kanban", "Deck öffnen", () => openDeck(app));
		ctx.addCommand({
			id: "deck-open",
			name: "Deck öffnen",
			callback: () => openDeck(app),
		});
	},
};

async function openDeck(app: App) {
	const existing = app.workspace.getLeavesOfType(DECK_VIEW)[0];
	const leaf = existing ?? app.workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: DECK_VIEW, active: true });
	await app.workspace.revealLeaf(leaf);
}
