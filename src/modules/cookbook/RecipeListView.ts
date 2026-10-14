import { ItemView, WorkspaceLeaf } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { CookbookApi } from "./CookbookApi";

export const RECIPE_LIST_VIEW = "nextcloud-cookbook-list";

export class RecipeListView extends ItemView {
	private imageUrls: string[] = [];
	private observer: IntersectionObserver | null = null;
	private renderId = 0;

	constructor(leaf: WorkspaceLeaf, private api: CookbookApi, private openRecipe: (id: string, name: string) => void) {
		super(leaf);
	}

	getViewType() {
		return RECIPE_LIST_VIEW;
	}

	getDisplayText() {
		return "Recipes";
	}

	getIcon() {
		return "chef-hat";
	}

	async onOpen() {
		this.addAction("refresh-cw", "Reload", () => this.render());
		await this.render();
	}

	async onClose() {
		this.cleanup();
	}

	private async render() {
		const renderId = ++this.renderId;
		this.cleanup();
		const el = this.contentEl;
		el.empty();
		el.addClass("nc-cookbook");
		el.createEl("p", { text: "Loading recipes…", cls: "nc-cookbook-status" });

		let recipes;
		try {
			recipes = await this.api.listRecipes();
		} catch (e) {
			if (renderId !== this.renderId) return;
			el.empty();
			el.createEl("p", { text: `Could not load recipes: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
			return;
		}

		if (renderId !== this.renderId) return; // a newer reload took over
		el.empty();
		if (recipes.length === 0) {
			el.createEl("p", { text: "No recipes found.", cls: "nc-cookbook-status" });
			return;
		}

		recipes.sort((a, b) => a.name.localeCompare(b.name));
		// Thumbnails need auth, so they are fetched only once a card scrolls into view.
		this.observer = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				this.observer?.unobserve(entry.target);
				this.loadThumb(entry.target as HTMLElement);
			}
		});

		const list = el.createDiv({ cls: "nc-cookbook-list" });
		for (const recipe of recipes) {
			const card = list.createDiv({ cls: "nc-cookbook-card" });
			card.dataset.recipeId = recipe.id;
			card.createDiv({ cls: "nc-cookbook-thumb" });
			card.createDiv({ text: recipe.name, cls: "nc-cookbook-card-name" });
			card.addEventListener("click", () => this.openRecipe(recipe.id, recipe.name));
			this.observer.observe(card);
		}
	}

	private async loadThumb(card: HTMLElement) {
		try {
			const blob = await this.api.getImage(card.dataset.recipeId!, "thumb");
			if (!card.isConnected) return; // list was reloaded or closed meanwhile
			const url = URL.createObjectURL(blob);
			this.imageUrls.push(url);
			card.querySelector(".nc-cookbook-thumb")?.createEl("img", { attr: { src: url, alt: "" } });
		} catch {
			// No thumbnail is fine; the card still works.
		}
	}

	private cleanup() {
		this.observer?.disconnect();
		this.observer = null;
		this.imageUrls.forEach((url) => URL.revokeObjectURL(url));
		this.imageUrls = [];
	}
}
