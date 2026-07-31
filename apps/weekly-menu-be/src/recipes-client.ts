import {
  RECIPE_CATEGORY_TO_SLOT,
  recipeCategorySchema,
  type DishPools
} from "@cfp/weekly-menu-shared";

export type RecipeDto = Readonly<{
  name: string;
  category: keyof typeof RECIPE_CATEGORY_TO_SLOT;
}>;

function recipesUrl(baseUrl: string): URL {
  const url = new URL("/api/recipes", baseUrl);
  url.searchParams.set("where[active][equals]", "true");
  url.searchParams.set("limit", "0");
  return url;
}

function parseRecipe(value: unknown): RecipeDto {
  if (!value || typeof value !== "object") throw new Error("RECIPES_CONTRACT_INVALID");
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const category = recipeCategorySchema.safeParse(record.category);
  if (!name || !category.success || record.active !== true) {
    throw new Error("RECIPES_CONTRACT_INVALID");
  }
  return { name, category: category.data };
}

export async function fetchRecipePools(
  baseUrl: string,
  fetcher: typeof fetch = fetch
): Promise<DishPools> {
  const response = await fetcher(recipesUrl(baseUrl), {
    method: "GET",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error("RECIPES_UNAVAILABLE");

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { docs?: unknown }).docs)) {
    throw new Error("RECIPES_CONTRACT_INVALID");
  }

  const pools: { [Slot in keyof DishPools]: string[] } = {
    bigMeat: [],
    smallMeat: [],
    vegetable: []
  };
  for (const value of (payload as { docs: unknown[] }).docs) {
    const recipe = parseRecipe(value);
    pools[RECIPE_CATEGORY_TO_SLOT[recipe.category]].push(recipe.name);
  }
  return pools;
}
