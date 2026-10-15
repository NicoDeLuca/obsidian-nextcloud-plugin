import { App, ButtonComponent } from "obsidian";
import { BlockDefinition, BlockError, BlockWidget, findByName, Options } from "../../core/blocks";
import { CookbookApi } from "./CookbookApi";
import { renderRecipe } from "./RecipeView";

/**
 * ```nextcloud-rezept
 * rezept: Pfannkuchen   # Name (oder Anfang davon) oder ID
 * bild: ja
 * ```
 */
export function recipeBlock(api: CookbookApi, open: (id: string, name: string) => void): BlockDefinition {
	return {
		language: "nextcloud-rezept",
		title: "Rezept",
		template: "rezept: ",
		keys: ["titel", "rezept", "bild"],
		create: (el, options, host) => new RecipeBlock(el, host.app, options, api, open),
	};
}

/** A recipe with temporary checkboxes; not reloaded automatically, so ticked items stay ticked. */
class RecipeBlock extends BlockWidget {
	private imageUrl: string | null = null;
	private recipe: { id: string; name: string } | null = null;

	constructor(el: HTMLElement, app: App, options: Options, private api: CookbookApi, private open: (id: string, name: string) => void) {
		super(el, app, options, "", 0);
		if (!options.string("rezept")) throw new BlockError("Bitte mit „rezept: Name“ angeben, welches Rezept gezeigt werden soll.");
	}

	onload() {
		super.onload();
		this.register(() => this.revokeImage());
	}

	protected renderActions(actions: HTMLElement) {
		new ButtonComponent(actions)
			.setIcon("chef-hat")
			.setTooltip("Im Kochbuch öffnen")
			.onClick(() => this.recipe && this.open(this.recipe.id, this.recipe.name));
	}

	protected async update(body: HTMLElement, isCurrent: () => boolean) {
		const wanted = this.options.string("rezept");
		const stubs = await this.api.listRecipes();
		const stub = stubs.find((r) => r.id === wanted) ?? findByName(stubs, wanted, (r) => r.name, "Rezept");
		const recipe = await this.api.getRecipe(stub.id);
		if (!isCurrent()) return;
		this.recipe = { id: stub.id, name: recipe.name };
		const imageEl = renderRecipe(body, recipe, 3);
		if (!this.options.boolean("bild", true)) {
			imageEl.remove();
			return;
		}
		try {
			const blob = await this.api.getImage(stub.id, "full");
			if (!isCurrent()) return;
			this.revokeImage();
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
