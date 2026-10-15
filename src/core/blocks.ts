import { App, ButtonComponent, FuzzySuggestModal, MarkdownRenderChild, parseYaml } from "obsidian";
import { errorMessage } from "./NextcloudClient";

/** Where a block is shown: a code block in a note, or an element of another plugin (e.g. DataviewJS). */
export interface BlockHost {
	app: App;
	/** Ties the widget's lifetime (timers, listeners) to the note or the caller's component. */
	addChild(child: MarkdownRenderChild): void;
}

/** A block a module offers for notes, e.g. ```nextcloud-aufgaben. */
export interface BlockDefinition {
	/** Code block language, e.g. "nextcloud-aufgaben". */
	language: string;
	/** Name in the "insert block" list. */
	title: string;
	/** Example options inserted by the "insert block" command (YAML, may be empty). */
	template: string;
	/** Option keys the block understands (normalized, see Options); others are reported as unknown. */
	keys: string[];
	create(el: HTMLElement, options: Options, host: BlockHost): MarkdownRenderChild;
}

/** Wrong options; shown inside the block instead of the content. */
export class BlockError extends Error {}

/**
 * The options of a block, written as YAML ("ansicht: heute"). Keys are compared without case
 * and with umlauts spelled out, so "hinzufügen" and "hinzufuegen" both work.
 */
export class Options {
	private values = new Map<string, unknown>();

	constructor(raw: unknown) {
		if (raw === null || raw === undefined || raw === "") return;
		if (typeof raw !== "object" || Array.isArray(raw)) throw new BlockError("Optionen bitte zeilenweise als „name: wert“ angeben.");
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) this.values.set(normalizeKey(key), value);
	}

	/** Parses the text of a code block. */
	static parse(source: string): Options {
		let raw: unknown;
		try {
			raw = source.trim() ? parseYaml(source) : null;
		} catch (e) {
			throw new BlockError(`Die Optionen sind kein gültiges YAML: ${errorMessage(e)}`);
		}
		return new Options(raw);
	}

	unknownKeys(known: string[]): string[] {
		return [...this.values.keys()].filter((k) => !known.includes(k));
	}

	has(key: string): boolean {
		return this.values.has(key) && this.values.get(key) !== null;
	}

	string(key: string, fallback = ""): string {
		const value = this.values.get(key);
		if (value === undefined || value === null) return fallback;
		if (typeof value === "object") throw new BlockError(`„${key}“ erwartet einen einzelnen Wert.`);
		return String(value).trim();
	}

	/** One of the allowed values (case-insensitive). */
	choice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
		if (!this.has(key)) return fallback;
		const value = this.string(key).toLowerCase();
		const match = allowed.find((a) => a.toLowerCase() === value);
		if (!match) throw new BlockError(`Ungültiger Wert für „${key}“: ${value}. Möglich: ${allowed.join(", ")}.`);
		return match;
	}

	number(key: string, fallback: number, min: number, max: number): number {
		if (!this.has(key)) return fallback;
		const value = Number(this.values.get(key));
		if (!Number.isFinite(value) || value < min || value > max) throw new BlockError(`„${key}“ muss eine Zahl von ${min} bis ${max} sein.`);
		return Math.round(value);
	}

	boolean(key: string, fallback: boolean): boolean {
		if (!this.has(key)) return fallback;
		const value = this.values.get(key);
		if (typeof value === "boolean") return value;
		const text = String(value).trim().toLowerCase();
		if (["ja", "true", "an", "1"].includes(text)) return true;
		if (["nein", "false", "aus", "0"].includes(text)) return false;
		throw new BlockError(`„${key}“ erwartet ja oder nein.`);
	}

	/** A YAML list or a comma-separated text. */
	list(key: string): string[] {
		const value = this.values.get(key);
		if (value === undefined || value === null) return [];
		const items = Array.isArray(value) ? value : String(value).split(",");
		return items.map((v) => String(v).trim()).filter(Boolean);
	}
}

export function normalizeKey(key: string): string {
	return key.trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

/** Finds an item by its name: exact (ignoring case) first, then by the beginning of the name. */
export function findByName<T>(items: T[], name: string, nameOf: (item: T) => string, what: string): T {
	const wanted = name.trim().toLowerCase();
	const found = items.find((i) => nameOf(i).toLowerCase() === wanted) ?? items.find((i) => nameOf(i).toLowerCase().startsWith(wanted));
	if (!found) {
		const names = items.map(nameOf).slice(0, 10).join(", ");
		throw new BlockError(`${what} „${name}“ nicht gefunden.${names ? ` Vorhanden: ${names}.` : ""}`);
	}
	return found;
}

/**
 * Frame of a block: a header with title and refresh button, a body that is redrawn on every
 * update, and a footer for inputs that should keep their focus across updates (e.g. quick add).
 * Reloads by itself every few minutes while the note is open.
 */
export abstract class BlockWidget extends MarkdownRenderChild {
	protected bodyEl!: HTMLElement;
	protected footerEl!: HTMLElement;
	private headerEl!: HTMLElement;
	private titleEl: HTMLElement | null = null;
	private updateId = 0;
	private alive = false;

	constructor(
		containerEl: HTMLElement,
		protected app: App,
		protected options: Options,
		private defaultTitle: string,
		private refreshMinutes = 5
	) {
		super(containerEl);
	}

	/** Loads data and draws it into `body`; `isCurrent()` turns false when a newer update started. */
	protected abstract update(body: HTMLElement, isCurrent: () => boolean): Promise<void>;

	/** Replaces the default title once the real names are known (unless the note sets its own "titel"). */
	protected setTitle(title: string): void {
		if (this.titleEl && !this.options.has("titel")) this.titleEl.setText(title);
	}

	/** Extra header buttons (e.g. "new event"). */
	protected renderActions(_actions: HTMLElement): void {}

	onload() {
		this.alive = true;
		const el = this.containerEl;
		el.empty();
		el.addClass("nc-block");
		this.headerEl = el.createDiv({ cls: "nc-block-header" });
		const title = this.options.string("titel", this.defaultTitle);
		if (title) this.titleEl = this.headerEl.createSpan({ cls: "nc-block-title", text: title });
		const actions = this.headerEl.createDiv({ cls: "nc-block-actions" });
		this.renderActions(actions);
		new ButtonComponent(actions)
			.setIcon("refresh-cw")
			.setTooltip("Neu laden")
			.onClick(() => this.reload());
		this.bodyEl = el.createDiv({ cls: "nc-block-body" });
		this.bodyEl.createEl("p", { cls: "nc-cookbook-status", text: "Wird geladen …" });
		this.footerEl = el.createDiv({ cls: "nc-block-footer" });
		if (this.refreshMinutes > 0) this.registerInterval(window.setInterval(() => this.refresh(), this.refreshMinutes * 60_000));
		this.refresh();
	}

	onunload() {
		this.alive = false;
	}

	/** The refresh button; blocks that show shared, already loaded state fetch it again here. */
	protected reload(): void {
		this.refresh();
	}

	/** Reloads; the old content stays visible until the new one is ready. */
	async refresh(): Promise<void> {
		const id = ++this.updateId;
		const isCurrent = () => id === this.updateId && this.alive;
		const next = createDiv();
		try {
			await this.update(next, isCurrent);
		} catch (e) {
			if (!isCurrent()) return;
			next.empty();
			next.createEl("p", { cls: "nc-block-error", text: e instanceof BlockError ? e.message : `Konnte nicht geladen werden: ${errorMessage(e)}` });
		}
		if (isCurrent()) this.bodyEl.replaceChildren(...Array.from(next.childNodes));
	}
}

/** Shows a message in place of a block (wrong options, module switched off, …). */
export function renderBlockMessage(el: HTMLElement, message: string): void {
	el.empty();
	el.addClass("nc-block");
	el.createEl("p", { cls: "nc-block-error", text: message });
}

/** The list for the "insert block" command. */
export class BlockSuggestModal extends FuzzySuggestModal<BlockDefinition> {
	constructor(app: App, private blocks: BlockDefinition[], private onChoose: (block: BlockDefinition) => void) {
		super(app);
		this.setPlaceholder("Welchen Nextcloud-Block einfügen?");
	}

	getItems(): BlockDefinition[] {
		return this.blocks;
	}

	getItemText(block: BlockDefinition): string {
		return block.title;
	}

	onChooseItem(block: BlockDefinition): void {
		this.onChoose(block);
	}
}

/** "```nextcloud-aufgaben\nansicht: heute\n```\n" */
export function blockMarkdown(block: BlockDefinition): string {
	const body = block.template.trim();
	return "```" + block.language + "\n" + (body ? body + "\n" : "") + "```\n";
}
