import { findByName } from "../../core/blocks";
import { CookbookApi } from "./CookbookApi";

/** `api.cookbook`: recipes for scripts. */
export function cookbookApi(api: CookbookApi) {
	return {
		async recipes() {
			return (await api.listRecipes()).map((r) => ({ id: r.id, name: r.name, keywords: r.keywords }));
		},

		/** A recipe by id or name (or the beginning of it). */
		async recipe(nameOrId: string) {
			const stubs = await api.listRecipes();
			const stub = stubs.find((r) => r.id === nameOrId) ?? findByName(stubs, nameOrId, (r) => r.name, "Rezept");
			return api.getRecipe(stub.id);
		},
	};
}
