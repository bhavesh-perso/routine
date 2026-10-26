# Food module (`js/food.js`, `js/food-plan.js`, `styles/food.css`)

## Routes (`#/food/...`)
| Route | Screen |
|---|---|
| `#/food` | Today: totals vs target (~2,500 kcal / 120 g, g/kg from the latest weigh-in), planned meals with **Log this meal**, per-meal swap, logged list, recents, household portions, custom food, whey toggle (off by default) |
| `/week[/<iso>]` | Plan for Mon–Sun with kcal and protein per day, batch-cook days marked |
| `/prep/<iso>` | What to cook on a batch-cook day: ingredients, numbered steps, where each box goes |
| `/shop[/<iso>]` | Weekly fresh list (Mon–Sun) and monthly staples list (calendar month of that Monday), tick-off, pack sizes, extras from `foods.json` |
| `/recipes`, `/recipe/<id>` | Library, "Watch how" (YouTube search link), mark as cooked |
| `/skills` | One-new-recipe-a-week checklist, cooked map |

## How the plan works
- Cooking happens only on prep days (`isPrepDay`: first off day of each off stretch). Each prep day cooks 2 batch dishes x 4 boxes. Dishes come from `POOL` in `food-plan.js` by prep-day ordinal counted from 2026-10-26 (`pool[3i]`, `pool[3i+1]`), so consecutive prep days never share a dish and all 8 dishes rotate.
- Boxes are eaten from the prep day until the next prep day: work days use 2 boxes (night: Meal 1 + packed Meal 2; morning: packed Meal 2 + Meal 3), off days and prep days use 1 (Meal 2; the prep day's is fresh). Dishes alternate; on two-box days the order flips on odd day numbers. Worst case is 8 boxes between prep days, which is what a prep day cooks. `batchFor`, `boxesNeeded`, `whereBoxesGo` expose this.
- Every other slot is a quick item (`recipes.json` `quick`, filtered by `slots`; pack-for-work only on work days) picked by search: rotated by day number, the first combination that puts the day in 2,400–2,650 kcal and 115–135 g protein and differs from yesterday. `topups` (milk, banana, peanuts...) are added when a day is still under target. Plans chain from 2026-10-26 and are memoised per settings object.
- `extra: true` quick recipes (fish and potatoes) are never planned; they show up in the swap list.
- Nutrition is always computed from `foods.json` (per 100 g; `pcs` foods use `shop.each`). No fixed kcal/protein numbers live in recipes.
- Swaps: `food.swaps[iso][slot] = recipeId`. A swap replaces that meal only; the box it replaced stays in the fridge or freezer and later days do not move.

## Data
- `food = { log:{[rd]:[{ n,k,p,meal,t,src?,qty? }]}, recent:[ 'r:<recipeId>' | portionId ], shop:{[mondayIso]:{key:true}}, staples:{['YYYY-MM']:{key:true}}, cooked:{recipeId:iso}, swaps:{[iso]:{slot:id}} }`
- Logging uses `ctx.rd`; `t` is the time of day when tapped (`ctx.min`), `meal` the slot.
- Protein per kg reads `get('progress').weighins` directly (latest entry with kg).
- Recipe rules (tested): <= 8 ingredients excluding `basics`, no pork/beef/alcohol, every ingredient key exists in `foods.json`.
- Shop quantities are summed from `dayDetail(...).uses` (full batch recipes counted on the prep day, quick items and top-ups on the day eaten). Pack suggestion: biggest packs first, then the smallest pack that covers the rest.

## Exports
`food.js`: default module, `todayCard(ctx)`, `mealsFor(iso,s)`, `prepFor(iso,s)`, `totals(iso)`, `logEntry`, `removeEntry`, `setSwap`, `markCooked`, `tick`, `latestKg`, `ingText`, `loadData`.
`food-plan.js` (pure, no DOM): `setData`, `mealsFor`, `dayDetail`, `prepFor`, `dishesFor`, `batchFor`, `boxesNeeded`, `whereBoxesGo`, `slotOptions`, `groceryFor`, `packsFor`, `monthRange`, `nutrition`, `perServing`.

## Gotchas
- Data loads in `init()` (fetch of `data/foods.json` and `data/recipes.json`); until then the screens show a reload note and the plan is empty.
- Tests set data with `setData` and mock `localStorage` as `tests/storage.test.js` does.
