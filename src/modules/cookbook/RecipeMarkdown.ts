import { parseYaml, stringifyYaml } from "obsidian";
import { Recipe } from "./CookbookApi";

/** The parts of a recipe that can be edited as Markdown. */
export type EditableRecipe = Pick<
	Recipe,
	| "name"
	| "description"
	| "recipeYield"
	| "prepTime"
	| "cookTime"
	| "totalTime"
	| "recipeCategory"
	| "keywords"
	| "url"
	| "recipeIngredient"
	| "recipeInstructions"
	| "tool"
>;

export const EMPTY_RECIPE: EditableRecipe = {
	name: "",
	description: "",
	recipeYield: null,
	prepTime: null,
	cookTime: null,
	totalTime: null,
	recipeCategory: "",
	keywords: "",
	url: "",
	recipeIngredient: [],
	recipeInstructions: [],
	tool: [],
};

const FM = {
	yield: "portionen",
	prep: "vorbereitung",
	cook: "kochzeit",
	total: "gesamtzeit",
	category: "kategorie",
	keywords: "stichwörter",
	url: "quelle",
};

const SECTIONS = { ingredients: "Zutaten", instructions: "Zubereitung", tools: "Werkzeuge" };

/** Thrown for Markdown that can't be turned back into a recipe; the message is shown to the user. */
export class RecipeFormatError extends Error {}

export function recipeToMarkdown(recipe: EditableRecipe): string {
	const frontmatter: Array<[string, string | number | null]> = [
		[FM.yield, recipe.recipeYield],
		[FM.prep, formatDuration(recipe.prepTime)],
		[FM.cook, formatDuration(recipe.cookTime)],
		[FM.total, formatDuration(recipe.totalTime)],
		[FM.category, recipe.recipeCategory],
		[FM.keywords, recipe.keywords.split(",").filter(Boolean).join(", ")],
		[FM.url, recipe.url],
	];
	const lines = ["---"];
	for (const [key, value] of frontmatter) {
		// Empty keys stay visible so it's clear which fields exist.
		lines.push(value === null || value === "" ? `${key}:` : stringifyYaml({ [key]: value }).trimEnd());
	}
	lines.push("---", `# ${recipe.name}`, "");
	if (recipe.description) lines.push(recipe.description, "");

	lines.push(`## ${SECTIONS.ingredients}`);
	for (const item of recipe.recipeIngredient) {
		// Cookbook marks ingredient group headings with a leading "## ".
		lines.push(item.startsWith("## ") ? `### ${item.slice(3)}` : `- ${item}`);
	}
	lines.push("", `## ${SECTIONS.instructions}`);
	recipe.recipeInstructions.forEach((step, i) => {
		const [first, ...rest] = step.split("\n");
		lines.push(`${i + 1}. ${first}`, ...rest.map((line) => `   ${line}`));
	});
	lines.push("", `## ${SECTIONS.tools}`);
	for (const tool of recipe.tool) lines.push(`- ${tool}`);
	return lines.join("\n") + "\n";
}

export function markdownToRecipe(markdown: string): EditableRecipe {
	const recipe: EditableRecipe = { ...EMPTY_RECIPE, recipeIngredient: [], recipeInstructions: [], tool: [] };
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

	let i = 0;
	if (lines[0]?.trim() === "---") {
		const end = lines.findIndex((line, j) => j > 0 && line.trim() === "---");
		if (end === -1) throw new RecipeFormatError("Dem Frontmatter fehlt das abschließende ---.");
		applyFrontmatter(recipe, lines.slice(1, end).join("\n"));
		i = end + 1;
	}

	let titleFound = false;
	let section: "description" | "ingredients" | "instructions" | "tools" | null = null;
	const description: string[] = [];

	for (; i < lines.length; i++) {
		const line = lines[i];
		const text = line.trim();

		const h1 = line.match(/^#(?:\s+(.*))?$/);
		if (h1) {
			if (titleFound) throw new RecipeFormatError(`Nur ein Titel (# …) ist erlaubt (Zeile ${i + 1}).`);
			titleFound = true;
			recipe.name = (h1[1] ?? "").trim();
			section = "description";
			continue;
		}

		const h2 = line.match(/^##\s+(.*)$/);
		if (h2) {
			const name = h2[1].trim().toLowerCase();
			if (name === SECTIONS.ingredients.toLowerCase()) section = "ingredients";
			else if (name === SECTIONS.instructions.toLowerCase()) section = "instructions";
			else if (name === SECTIONS.tools.toLowerCase()) section = "tools";
			else
				throw new RecipeFormatError(
					`Unbekannter Abschnitt "## ${h2[1].trim()}" (Zeile ${i + 1}). Erlaubt: ${Object.values(SECTIONS).join(", ")}.`
				);
			continue;
		}

		if (!text) {
			if (section === "description") description.push("");
			continue;
		}

		switch (section) {
			case null:
				throw new RecipeFormatError(`Text vor dem Titel (Zeile ${i + 1}). Beginne mit "# Rezeptname".`);
			case "description":
				description.push(text);
				break;
			case "ingredients": {
				const group = line.match(/^###\s+(.*)$/);
				recipe.recipeIngredient.push(group ? `## ${group[1].trim()}` : stripBullet(text));
				break;
			}
			case "instructions": {
				const step = text.match(/^(?:\d+[.)]|[-*+])\s+(.*)$/);
				const steps = recipe.recipeInstructions;
				if (step || steps.length === 0) steps.push(step ? step[1] : text);
				// Lines that don't start a new step continue the previous one.
				else steps[steps.length - 1] += "\n" + text;
				break;
			}
			case "tools":
				recipe.tool.push(stripBullet(text));
				break;
		}
	}

	if (!recipe.name) throw new RecipeFormatError('Das Rezept braucht einen Titel: eine Zeile wie "# Pfannkuchen".');
	recipe.description = description.join("\n").trim();
	return recipe;
}

function applyFrontmatter(recipe: EditableRecipe, yaml: string) {
	let data: unknown;
	try {
		data = parseYaml(yaml) ?? {};
	} catch (e) {
		throw new RecipeFormatError(`Das Frontmatter ist kein gültiges YAML: ${e instanceof Error ? e.message : e}`);
	}
	if (typeof data !== "object" || Array.isArray(data)) throw new RecipeFormatError("Das Frontmatter muss aus Zeilen der Form schlüssel: wert bestehen.");

	for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
		const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value).trim();
		switch (key.toLowerCase()) {
			case FM.yield:
				if (text && !/^\d+$/.test(text)) throw new RecipeFormatError(`"${FM.yield}" muss eine ganze Zahl sein.`);
				recipe.recipeYield = text ? Number(text) : null;
				break;
			case FM.prep:
				recipe.prepTime = parseDuration(FM.prep, text);
				break;
			case FM.cook:
				recipe.cookTime = parseDuration(FM.cook, text);
				break;
			case FM.total:
				recipe.totalTime = parseDuration(FM.total, text);
				break;
			case FM.category:
				recipe.recipeCategory = text;
				break;
			case FM.keywords:
				recipe.keywords = text
					.split(",")
					.map((k) => k.trim())
					.filter(Boolean)
					.join(",");
				break;
			case FM.url:
				recipe.url = text;
				break;
			default:
				throw new RecipeFormatError(`Unbekanntes Feld "${key}" im Frontmatter. Erlaubt: ${Object.values(FM).join(", ")}.`);
		}
	}
}

function stripBullet(text: string): string {
	return text.replace(/^[-*+]\s+/, "");
}

/** "PT1H20M" → "1 h 20 min"; "" for empty or zero durations. */
export function formatDuration(iso: string | null): string {
	const match = iso?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/);
	if (!match) return "";
	const hours = Number(match[1] ?? 0);
	const minutes = Number(match[2] ?? 0);
	return [hours ? `${hours} h` : "", minutes ? `${minutes} min` : ""].filter(Boolean).join(" ");
}

/** "1 h 20 min", "1h20m", "90 min" or "90" (minutes) → "PT1H20M"; empty → null. */
function parseDuration(field: string, text: string): string | null {
	if (!text) return null;
	const match = text.match(/^(?:(\d+)\s*(?:h|std\.?|stunden?)\s*)?(?:(\d+)\s*(?:m|min\.?|minuten?)?)?$/i);
	if (!match || (match[1] === undefined && match[2] === undefined)) {
		throw new RecipeFormatError(`"${field}" muss eine Dauer wie "1 h 20 min" oder "45 min" sein.`);
	}
	const total = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
	return `PT${Math.floor(total / 60)}H${total % 60}M`;
}
