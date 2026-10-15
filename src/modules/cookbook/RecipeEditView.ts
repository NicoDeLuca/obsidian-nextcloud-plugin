import { ButtonComponent, ItemView, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { confirmModal } from "../../core/ui";
import { CookbookApi, normalizeRecipe, RawRecipe } from "./CookbookApi";
import { EMPTY_RECIPE, markdownToRecipe, RecipeFormatError, recipeToMarkdown } from "./RecipeMarkdown";

export const RECIPE_EDIT_VIEW = "nextcloud-cookbook-edit";

export interface RecipeEditViewState {
	/** Missing for a new recipe. */
	recipeId?: string;
	name?: string;
}

/** Edits a recipe as Markdown and saves it back to Cookbook (PUT, or POST for a new recipe). */
export class RecipeEditView extends ItemView {
	private recipeId: string | undefined;
	private name = "";
	/** The recipe as loaded; fields not shown in the Markdown (image, nutrition, …) are kept from the server copy. */
	private loaded: RawRecipe | null = null;
	private textarea: HTMLTextAreaElement | null = null;
	private saveButton: ButtonComponent | null = null;
	private renderId = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private api: CookbookApi,
		/** Called after saving or cancelling; recipeId is undefined when a new recipe was cancelled. */
		private onDone: (leaf: WorkspaceLeaf, recipeId: string | undefined, name: string, saved: boolean) => void
	) {
		super(leaf);
	}

	getViewType() {
		return RECIPE_EDIT_VIEW;
	}

	getDisplayText() {
		return this.recipeId ? `Edit: ${this.name}` : "New recipe";
	}

	getIcon() {
		return "pencil";
	}

	getState(): Record<string, unknown> {
		return { recipeId: this.recipeId, name: this.name };
	}

	async setState(state: unknown, result: ViewStateResult) {
		const { recipeId, name } = state as RecipeEditViewState;
		this.recipeId = recipeId;
		this.name = name ?? "";
		await super.setState(state, result);
		await this.render();
	}

	private async render() {
		const renderId = ++this.renderId;
		const el = this.contentEl;
		el.empty();
		el.addClass("nc-cookbook", "nc-recipe-edit");
		this.loaded = null;
		this.textarea = null;

		let markdown: string;
		if (this.recipeId) {
			el.createEl("p", { text: "Loading recipe…", cls: "nc-cookbook-status" });
			try {
				this.loaded = await this.api.getRawRecipe(this.recipeId);
			} catch (e) {
				if (renderId !== this.renderId) return;
				el.empty();
				el.createEl("p", { text: `Could not load recipe: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
				return;
			}
			if (renderId !== this.renderId) return;
			markdown = recipeToMarkdown(normalizeRecipe(this.loaded));
		} else {
			markdown = recipeToMarkdown(EMPTY_RECIPE);
		}

		el.empty();
		const toolbar = el.createDiv({ cls: "nc-recipe-edit-toolbar" });
		new ButtonComponent(toolbar).setButtonText("Cancel").onClick(() => this.onDone(this.leaf, this.recipeId, this.name, false));
		this.saveButton = new ButtonComponent(toolbar)
			.setButtonText("Save")
			.setCta()
			.onClick(() => this.save());

		this.textarea = el.createEl("textarea", { cls: "nc-recipe-edit-text" });
		this.textarea.value = markdown;
		this.textarea.spellcheck = true;
	}

	private async save() {
		if (!this.textarea || !this.saveButton) return;
		let edited;
		try {
			edited = markdownToRecipe(this.textarea.value);
		} catch (e) {
			if (e instanceof RecipeFormatError) {
				new Notice(e.message, 8000);
				return;
			}
			throw e;
		}

		this.saveButton.setDisabled(true);
		try {
			let recipeId = this.recipeId;
			if (recipeId && this.loaded) {
				const current = await this.api.getRawRecipe(recipeId);
				if (current.dateModified !== this.loaded.dateModified) {
					const overwrite = await confirmModal(
						this.app,
						"Recipe changed elsewhere",
						"This recipe was changed somewhere else after you opened it. Saving overwrites those changes.",
						"Overwrite"
					);
					if (!overwrite) return;
				}
				await this.api.updateRecipe({ ...current, ...edited, id: recipeId });
			} else {
				recipeId = await this.api.createRecipe(edited);
			}
			new Notice("Recipe saved.");
			this.onDone(this.leaf, recipeId, edited.name, true);
		} catch (e) {
			new Notice(`Could not save recipe: ${saveErrorMessage(e)}`, 8000);
		} finally {
			this.saveButton.setDisabled(false);
		}
	}
}

function saveErrorMessage(e: unknown): string {
	const status = e && typeof e === "object" && "status" in e ? (e as { status: number }).status : 0;
	if (status === 409) return "another recipe with this name already exists.";
	return errorMessage(e);
}
