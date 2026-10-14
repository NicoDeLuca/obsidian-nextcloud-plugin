import { App } from "obsidian";
import { NextcloudModule } from "../../core/types";
import { CookbookApi } from "./CookbookApi";
import { RECIPE_LIST_VIEW, RecipeListView } from "./RecipeListView";
import { RECIPE_VIEW, RecipeView, RecipeViewState } from "./RecipeView";

export const cookbookModule: NextcloudModule = {
	id: "cookbook",
	name: "Cookbook",
	description: "Browse recipes from Nextcloud Cookbook.",
	load(ctx) {
		const app = ctx.plugin.app;
		const api = new CookbookApi(ctx.client);

		ctx.registerView(RECIPE_LIST_VIEW, (leaf) => new RecipeListView(leaf, api, (id, name) => openRecipe(app, id, name)));
		ctx.registerView(RECIPE_VIEW, (leaf) => new RecipeView(leaf, api));

		ctx.addRibbonIcon("chef-hat", "Open recipes", () => openRecipeList(app));
		ctx.addCommand({
			id: "cookbook-open-recipes",
			name: "Open Cookbook recipes",
			callback: () => openRecipeList(app),
		});
	},
};

async function openRecipeList(app: App) {
	const existing = app.workspace.getLeavesOfType(RECIPE_LIST_VIEW)[0];
	const leaf = existing ?? app.workspace.getLeaf("tab");
	if (!existing) await leaf.setViewState({ type: RECIPE_LIST_VIEW, active: true });
	await app.workspace.revealLeaf(leaf);
}

// Reuses one recipe tab, so opening another recipe (or the same one again) starts with fresh checkboxes.
async function openRecipe(app: App, recipeId: string, name: string) {
	const leaf = app.workspace.getLeavesOfType(RECIPE_VIEW)[0] ?? app.workspace.getLeaf("tab");
	const state: RecipeViewState = { recipeId, name };
	await leaf.setViewState({ type: RECIPE_VIEW, active: true, state: { ...state } });
	await app.workspace.revealLeaf(leaf);
}
