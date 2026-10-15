import { ButtonComponent, ItemView, moment, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { errorMessage } from "../../core/NextcloudClient";
import { confirmModal } from "../../core/ui";
import { CookbookApi, normalizeRecipe, RawRecipe } from "./CookbookApi";
import { EMPTY_RECIPE, markdownToRecipe, RecipeFormatError, recipeToMarkdown } from "./RecipeMarkdown";

export const RECIPE_EDIT_VIEW = "nextcloud-cookbook-edit";

/** Unsaved editor content, kept per recipe ("new" for a new one) so it survives closing Obsidian. */
export interface Draft {
	markdown: string;
	savedAt: number;
}

export interface DraftStore {
	get(key: string): Draft | undefined;
	set(key: string, draft: Draft | null): Promise<void>;
}

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
	/** The Markdown as loaded from the server; anything else in the editor is unsaved. */
	private initial = "";
	private draftTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private api: CookbookApi,
		private drafts: DraftStore,
		/** Called after saving or cancelling; recipeId is undefined when a new recipe was cancelled. */
		private onDone: (leaf: WorkspaceLeaf, recipeId: string | undefined, name: string, saved: boolean) => void
	) {
		super(leaf);
	}

	getViewType() {
		return RECIPE_EDIT_VIEW;
	}

	getDisplayText() {
		return this.recipeId ? `Bearbeiten: ${this.name}` : "Neues Rezept";
	}

	getIcon() {
		return "pencil";
	}

	getState(): Record<string, unknown> {
		return { recipeId: this.recipeId, name: this.name };
	}

	async setState(state: unknown, result: ViewStateResult) {
		const { recipeId, name } = state as RecipeEditViewState;
		this.flushDraft(); // keep pending edits of the previous recipe before switching
		this.recipeId = recipeId;
		this.name = name ?? "";
		await super.setState(state, result);
		await this.render();
	}

	async onClose() {
		// Closing the tab keeps the draft; write a pending one right away.
		this.flushDraft();
	}

	private get draftKey(): string {
		return this.recipeId ?? "new";
	}

	private get dirty(): boolean {
		return !!this.textarea && this.textarea.value !== this.initial;
	}

	/** Saves the editor content as a draft shortly after typing stops. */
	private scheduleDraft() {
		if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
		this.draftTimer = window.setTimeout(() => this.flushDraft(), 1000);
	}

	private flushDraft() {
		if (this.draftTimer === null) return;
		window.clearTimeout(this.draftTimer);
		this.draftTimer = null;
		void this.drafts.set(this.draftKey, this.dirty ? { markdown: this.textarea!.value, savedAt: Date.now() } : null);
	}

	private async discardDraft() {
		if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
		this.draftTimer = null;
		await this.drafts.set(this.draftKey, null);
	}

	private async cancel() {
		if (this.dirty) {
			const discard = await confirmModal(this.app, "Änderungen verwerfen?", "Die Änderungen an diesem Rezept wurden noch nicht gespeichert.", "Verwerfen");
			if (!discard) return;
		}
		await this.discardDraft();
		this.onDone(this.leaf, this.recipeId, this.name, false);
	}

	private async render() {
		const renderId = ++this.renderId;
		const el = this.contentEl;
		el.empty();
		el.addClass("nc-cookbook", "nc-recipe-edit");
		this.loaded = null;
		this.textarea = null;
		if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
		this.draftTimer = null;

		let markdown: string;
		if (this.recipeId) {
			el.createEl("p", { text: "Rezept wird geladen …", cls: "nc-cookbook-status" });
			try {
				this.loaded = await this.api.getRawRecipe(this.recipeId);
			} catch (e) {
				if (renderId !== this.renderId) return;
				el.empty();
				el.createEl("p", { text: `Rezept konnte nicht geladen werden: ${errorMessage(e)}`, cls: "nc-cookbook-status" });
				return;
			}
			if (renderId !== this.renderId) return;
			markdown = recipeToMarkdown(normalizeRecipe(this.loaded));
		} else {
			markdown = recipeToMarkdown(EMPTY_RECIPE);
		}

		el.empty();
		const toolbar = el.createDiv({ cls: "nc-recipe-edit-toolbar" });
		new ButtonComponent(toolbar).setButtonText("Abbrechen").onClick(() => this.cancel());
		this.saveButton = new ButtonComponent(toolbar)
			.setButtonText("Speichern")
			.setCta()
			.onClick(() => this.save());

		const draft = this.drafts.get(this.draftKey);
		this.initial = markdown;
		const textarea = el.createEl("textarea", { cls: "nc-recipe-edit-text" });
		this.textarea = textarea;
		textarea.value = markdown;
		textarea.spellcheck = true;
		textarea.addEventListener("input", () => this.scheduleDraft());

		if (draft && draft.markdown !== markdown) {
			const banner = el.createDiv({ cls: "nc-recipe-draft" });
			el.insertBefore(banner, textarea);
			banner.createSpan({ text: `Ungespeicherter Entwurf vom ${moment(draft.savedAt).format("lll")}.` });
			new ButtonComponent(banner)
				.setButtonText("Wiederherstellen")
				.setCta()
				.onClick(() => {
					textarea.value = draft.markdown;
					banner.remove();
				});
			new ButtonComponent(banner).setButtonText("Verwerfen").onClick(async () => {
				await this.discardDraft();
				banner.remove();
			});
		}
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
						"Rezept wurde woanders geändert",
						"Dieses Rezept wurde woanders geändert, nachdem du es geöffnet hast. Speichern überschreibt diese Änderungen.",
						"Überschreiben"
					);
					if (!overwrite) return;
				}
				await this.api.updateRecipe({ ...current, ...edited, id: recipeId });
			} else {
				recipeId = await this.api.createRecipe(edited);
			}
			await this.discardDraft();
			new Notice("Rezept gespeichert.");
			this.onDone(this.leaf, recipeId, edited.name, true);
		} catch (e) {
			new Notice(`Rezept konnte nicht gespeichert werden: ${saveErrorMessage(e)}`, 8000);
		} finally {
			this.saveButton.setDisabled(false);
		}
	}
}

function saveErrorMessage(e: unknown): string {
	const status = e && typeof e === "object" && "status" in e ? (e as { status: number }).status : 0;
	if (status === 409) return "Es gibt schon ein Rezept mit diesem Namen.";
	return errorMessage(e);
}
