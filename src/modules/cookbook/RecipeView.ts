import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { CookbookApi, Recipe } from "./CookbookApi";
import { formatDuration } from "./RecipeMarkdown";

export const RECIPE_VIEW = "nextcloud-cookbook-recipe";

export interface RecipeViewState {
	recipeId?: string;
	name?: string;
}

/**
 * Shows one recipe. The checkboxes are deliberately NOT persisted: their state
 * lives only in this view's DOM and is gone whenever the recipe is re-rendered.
 */
export class RecipeView extends ItemView {
	private recipeId: string | undefined;
	private title = "Recipe";
	private imageUrl: string | null = null;
	private renderId = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private api: CookbookApi,
		private onEdit: (leaf: WorkspaceLeaf, recipeId: string, name: string) => void
	) {
		super(leaf);
	}

	getViewType() {
		return RECIPE_VIEW;
	}

	getDisplayText() {
		return this.title;
	}

	getIcon() {
		return "chef-hat";
	}

	getState(): Record<string, unknown> {
		return { recipeId: this.recipeId, name: this.title };
	}

	async setState(state: unknown, result: ViewStateResult) {
		const { recipeId, name } = state as RecipeViewState;
		this.recipeId = recipeId;
		this.title = name ?? "Recipe";
		await super.setState(state, result);
		await this.render();
	}

	async onOpen() {
		this.addAction("pencil", "Edit recipe", () => {
			if (this.recipeId) this.onEdit(this.leaf, this.recipeId, this.title);
		});
	}

	async onClose() {
		this.revokeImage();
	}

	private async render() {
		const renderId = ++this.renderId;
		this.revokeImage();
		const el = this.contentEl;
		el.empty();
		el.addClass("nc-cookbook");
		if (!this.recipeId) return;

		el.createEl("p", { text: "Loading recipe…", cls: "nc-cookbook-status" });
		let recipe: Recipe;
		try {
			recipe = await this.api.getRecipe(this.recipeId);
		} catch (e) {
			if (renderId !== this.renderId) return;
			el.empty();
			el.createEl("p", { text: `Could not load recipe: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
			return;
		}
		if (renderId !== this.renderId) return; // another recipe was opened meanwhile

		el.empty();

		const article = el.createDiv({ cls: "nc-recipe" });
		article.createEl("h1", { text: recipe.name });
		const imageEl = article.createDiv({ cls: "nc-recipe-image" });
		if (recipe.description) article.createEl("p", { text: recipe.description, cls: "nc-recipe-description" });

		const meta = [
			recipe.recipeYield ? `Servings: ${recipe.recipeYield}` : null,
			labelled("Prep", formatDuration(recipe.prepTime)),
			labelled("Cook", formatDuration(recipe.cookTime)),
			labelled("Total", formatDuration(recipe.totalTime)),
		].filter((m): m is string => !!m);
		if (meta.length) article.createEl("p", { text: meta.join(" · "), cls: "nc-recipe-meta" });

		if (recipe.recipeIngredient.length) {
			article.createEl("h2", { text: "Ingredients" });
			renderChecklist(article.createEl("ul", { cls: "nc-recipe-checklist" }), recipe.recipeIngredient);
		}
		if (recipe.recipeInstructions.length) {
			article.createEl("h2", { text: "Instructions" });
			renderChecklist(article.createEl("ol", { cls: "nc-recipe-checklist" }), recipe.recipeInstructions);
		}

		try {
			const blob = await this.api.getImage(this.recipeId, "full");
			if (renderId !== this.renderId) return;
			this.imageUrl = URL.createObjectURL(blob);
			imageEl.createEl("img", { attr: { src: this.imageUrl, alt: recipe.name } });
		} catch {
			// The recipe is usable without its image.
		}
	}

	private revokeImage() {
		if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
		this.imageUrl = null;
	}
}

function renderChecklist(listEl: HTMLElement, items: string[]) {
	for (const text of items) {
		// Cookbook treats ingredients starting with "## " as section headings.
		if (text.startsWith("## ")) {
			listEl.createEl("li", { text: text.slice(3), cls: "nc-recipe-section" });
			continue;
		}
		const li = listEl.createEl("li");
		const label = li.createEl("label");
		const checkbox = label.createEl("input", { type: "checkbox" });
		label.createSpan({ text });
		checkbox.addEventListener("change", () => li.toggleClass("is-checked", checkbox.checked));
	}
}

function labelled(label: string, duration: string): string | null {
	return duration ? `${label}: ${duration}` : null;
}
