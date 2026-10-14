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
	recipeIngredient: string[];
	recipeInstructions: string[];
}

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
		const res = await this.client.get(`${BASE}/recipes/${encodeURIComponent(id)}`);
		const recipe = res.json as Recipe;
		return {
			...recipe,
			recipeIngredient: recipe.recipeIngredient ?? [],
			// Instructions are plain strings per the API spec, but schema.org also allows HowToStep objects.
			recipeInstructions: (recipe.recipeInstructions ?? []).map((step: string | { text: string }) =>
				typeof step === "string" ? step : step.text
			),
		};
	}

	/** Image bytes as a Blob; needs auth, so it can't be used as a plain <img src>. */
	async getImage(id: string, size: ImageSize): Promise<Blob> {
		const res = await this.client.get(`${BASE}/recipes/${encodeURIComponent(id)}/image?size=${size}`);
		// Header casing differs between desktop and mobile.
		const typeKey = Object.keys(res.headers).find((k) => k.toLowerCase() === "content-type");
		return new Blob([res.arrayBuffer], { type: typeKey ? res.headers[typeKey] : "" });
	}
}
