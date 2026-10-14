import { NextcloudClient } from "../../core/NextcloudClient";

// index.php works whether or not the instance has pretty URLs enabled.
const BASE = "/index.php/apps/cookbook/api/v1";

export interface RecipeStub {
	id: string;
	name: string;
	keywords: string;
}

export interface Recipe {
	id: string;
	name: string;
	description: string;
	recipeYield: number | null;
	prepTime: string | null;
	cookTime: string | null;
	totalTime: string | null;
	recipeCategory: string;
	keywords: string;
	url: string;
	recipeIngredient: string[];
	recipeInstructions: string[];
	tool: string[];
	dateModified?: string;
}

/** The recipe JSON exactly as Cookbook stores it, including fields this plugin doesn't edit (image, nutrition, …). */
export type RawRecipe = Record<string, unknown> & { id?: string; name?: string; dateModified?: string };

export type ImageSize = "full" | "thumb" | "thumb16";

export class CookbookApi {
	constructor(private client: NextcloudClient) {}

	async listRecipes(): Promise<RecipeStub[]> {
		const res = await this.client.get(`${BASE}/recipes`);
		// Older Cookbook versions only send the deprecated recipe_id.
		return (res.json as Array<RecipeStub & { recipe_id?: number }>).map((r) => ({
			id: String(r.id ?? r.recipe_id),
			name: r.name,
			keywords: r.keywords,
		}));
	}

	async getRecipe(id: string): Promise<Recipe> {
		return normalizeRecipe(await this.getRawRecipe(id));
	}

	async getRawRecipe(id: string): Promise<RawRecipe> {
		const res = await this.client.get(`${BASE}/recipes/${encodeURIComponent(id)}`);
		return res.json as RawRecipe;
	}

	/** Saves a full recipe. Cookbook identifies the recipe by the id inside the body, not the URL. */
	async updateRecipe(recipe: RawRecipe & { id: string }): Promise<void> {
		await this.client.put(`${BASE}/recipes/${encodeURIComponent(recipe.id)}`, recipe);
	}

	/** Creates a recipe and returns its new id. */
	async createRecipe(recipe: RawRecipe): Promise<string> {
		const res = await this.client.post(`${BASE}/recipes`, recipe);
		return String(res.json);
	}

	/** Image bytes as a Blob; needs auth, so it can't be used as a plain <img src>. */
	async getImage(id: string, size: ImageSize): Promise<Blob> {
		const res = await this.client.get(`${BASE}/recipes/${encodeURIComponent(id)}/image?size=${size}`);
		// Header casing differs between desktop and mobile.
		const typeKey = Object.keys(res.headers).find((k) => k.toLowerCase() === "content-type");
		return new Blob([res.arrayBuffer], { type: typeKey ? res.headers[typeKey] : "" });
	}
}

export function normalizeRecipe(raw: RawRecipe): Recipe {
	const recipe = raw as unknown as Recipe;
	return {
		...recipe,
		description: recipe.description ?? "",
		recipeCategory: recipe.recipeCategory ?? "",
		keywords: recipe.keywords ?? "",
		url: recipe.url ?? "",
		recipeIngredient: recipe.recipeIngredient ?? [],
		// Instructions are plain strings per the API spec, but schema.org also allows HowToStep objects.
		recipeInstructions: (recipe.recipeInstructions ?? []).map((step: string | { text: string }) =>
			typeof step === "string" ? step : step.text
		),
		tool: recipe.tool ?? [],
	};
}
