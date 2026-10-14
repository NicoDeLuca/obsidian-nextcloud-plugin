import { App, WorkspaceLeaf } from "obsidian";
import { NextcloudModule } from "../../core/types";
import { CookbookApi } from "./CookbookApi";
import { RECIPE_EDIT_VIEW, RecipeEditView, RecipeEditViewState } from "./RecipeEditView";
import { RECIPE_LIST_VIEW, RecipeListView } from "./RecipeListView";
import { RECIPE_VIEW, RecipeView, RecipeViewState } from "./RecipeView";

export const cookbookModule: NextcloudModule = {
	id: "cookbook",
	name: "Cookbook",
	description: "Browse and edit recipes from Nextcloud Cookbook.",
	load(ctx) {
		const app = ctx.plugin.app;
		const api = new CookbookApi(ctx.client);

		ctx.registerView(
			RECIPE_LIST_VIEW,
			(leaf) =>
				new RecipeListView(
					leaf,
					api,
					(id, name) => openRecipe(app, id, name),
					() => editRecipe(app.workspace.getLeaf("tab"))
				)
		);
		ctx.registerView(RECIPE_VIEW, (leaf) => new RecipeView(leaf, api, (leaf, id, name) => editRecipe(leaf, id, name)));
		ctx.registerView(
			RECIPE_EDIT_VIEW,
			(leaf) => new RecipeEditView(leaf, api, (leaf, id, name, saved) => finishEditing(app, leaf, id, name, saved))
		);

		ctx.addRibbonIcon("chef-hat", "Open recipes", () => openRecipeList(app));
		ctx.addCommand({
			id: "cookbook-open-recipes",
			name: "Open Cookbook recipes",
			callback: () => openRecipeList(app),
		});
		ctx.addCommand({
			id: "cookbook-new-recipe",
			name: "New Cookbook recipe",
			callback: () => editRecipe(app.workspace.getLeaf("tab")),
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
	await showRecipe(leaf, recipeId, name);
	await app.workspace.revealLeaf(leaf);
}

async function showRecipe(leaf: WorkspaceLeaf, recipeId: string, name: string) {
	const state: RecipeViewState = { recipeId, name };
	await leaf.setViewState({ type: RECIPE_VIEW, active: true, state: { ...state } });
}

/** Opens the editor in the given leaf; without a recipeId it creates a new recipe. */
async function editRecipe(leaf: WorkspaceLeaf, recipeId?: string, name?: string) {
	const state: RecipeEditViewState = { recipeId, name };
	await leaf.setViewState({ type: RECIPE_EDIT_VIEW, active: true, state: { ...state } });
}

async function finishEditing(app: App, leaf: WorkspaceLeaf, recipeId: string | undefined, name: string, saved: boolean) {
	if (recipeId) await showRecipe(leaf, recipeId, name);
	else leaf.detach();
	if (saved) {
		for (const listLeaf of app.workspace.getLeavesOfType(RECIPE_LIST_VIEW)) {
			if (listLeaf.view instanceof RecipeListView) listLeaf.view.render();
		}
	}
}
