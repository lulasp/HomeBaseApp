import { SPOONACULAR_API_KEY } from '../config/firebase';

const BASE = 'https://api.spoonacular.com';

export class ApiLimitError extends Error {
  constructor() { super('API_LIMIT_REACHED'); this.name = 'ApiLimitError'; }
}

const get = async (path, params = {}) => {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'x-api-key': SPOONACULAR_API_KEY },
  });
  if (res.status === 402 || res.status === 429) throw new ApiLimitError();
  if (!res.ok) throw new Error(`Spoonacular error: ${res.status}`);
  return res.json();
};

export const searchRecipes = (query, { number = 12, offset = 0, type, diet, cuisine, maxReadyTime } = {}) => {
  const params = { query, number, offset, addRecipeInformation: true, fillIngredients: true };
  if (type)         params.type         = type;
  if (diet)         params.diet         = diet;
  if (cuisine)      params.cuisine      = cuisine;
  if (maxReadyTime) params.maxReadyTime = maxReadyTime;
  return get('/recipes/complexSearch', params);
};

export const getRecipeDetails = (id) =>
  get(`/recipes/${id}/information`, { includeNutrition: true });

export const getRandomRecipes = (number = 6) =>
  get('/recipes/random', { number });

export const getNutritionById = (id) =>
  get(`/recipes/${id}/nutritionWidget.json`);

export const spoonacularRecipeToLocal = (r) => ({
  title: r.title,
  imageUrl: r.image || null,
  servings: r.servings || 1,
  prepTime: r.preparationMinutes || 0,
  cookTime: r.cookingMinutes || r.readyInMinutes || 0,
  summary: r.summary?.replace(/<[^>]+>/g, '') || '',
  ingredients: (r.extendedIngredients || []).map((i) => ({
    name: i.name,
    amount: String(i.amount),
    unit: i.unit,
  })),
  instructions: (r.analyzedInstructions?.[0]?.steps || []).map((s) => s.step),
  sourceType: 'spoonacular',
  spoonacularId: r.id,
  calories: Math.round(r.nutrition?.nutrients?.find((n) => n.name === 'Calories')?.amount || 0),
});
