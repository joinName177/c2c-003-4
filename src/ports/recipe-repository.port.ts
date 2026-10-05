import type { RecipeSnapshot } from '../core/models';
export interface RecipeRepository { load(): RecipeSnapshot; save(snapshot: RecipeSnapshot): void; }
