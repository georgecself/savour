// shopping-data.js — the shared "what's needed, what's covered, what's
// owed" engine for the shopping list. Used by both the regular Shopping
// page and Shop Mode, so this logic only ever lives in one place.
// Pure data functions only — no DOM rendering here.

function formatQty(n) {
  if (n === null || n === undefined) return "";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function getMondayOf(date) {
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return isoDate(d);
}

// ---------- Building the raw need, from this week's meal plan ----------

async function loadIngredientContributions(recipeItems, directIngredientItems) {
  const aggregated = {}; // key = ingredientId::unit

  if (recipeItems.length) {
    const recipeIds = [...new Set(recipeItems.map(i => i.recipe_id))];
    const encoded = recipeIds.map(id => `"${id}"`).join(",");

    const [recipeIngredients, recipes] = await Promise.all([
      supabaseRequest("recipe_ingredients", {
        query: `?select=recipe_id,ingredient_id,quantity,unit,ingredients(id,name,category,is_staple,grams_per_ml)&recipe_id=in.(${encoded})`
      }),
      supabaseRequest("recipes", { query: `?select=id,servings&id=in.(${encoded})` })
    ]);

    const servingsByRecipe = Object.fromEntries(recipes.map(r => [r.id, r.servings || 1]));

    const byRecipe = {};
    recipeIngredients.forEach(ri => {
      if (!byRecipe[ri.recipe_id]) byRecipe[ri.recipe_id] = [];
      byRecipe[ri.recipe_id].push(ri);
    });

    recipeItems.forEach(mealItem => {
      const baseServings = servingsByRecipe[mealItem.recipe_id] || 1;
      const multiplier = (mealItem.portions_made || baseServings) / baseServings;
      const rows = byRecipe[mealItem.recipe_id] || [];
      rows.forEach(ri => {
        if (!ri.ingredients) return; // ingredient may have been deleted
        const unit = ri.unit || "";
        const key = `${ri.ingredient_id}::${unit}`;
        if (!aggregated[key]) {
          aggregated[key] = {
            ingredientId: ri.ingredient_id,
            label: ri.ingredients.name,
            category: ri.ingredients.category || "Other",
            unit,
            qtySum: 0,
            hasUnspecified: false,
            isStaple: !!ri.ingredients.is_staple,
            gramsPerMl: ri.ingredients.grams_per_ml || null
          };
        }
        if (ri.quantity !== null && ri.quantity !== undefined) {
          aggregated[key].qtySum += ri.quantity * multiplier;
        } else {
          aggregated[key].hasUnspecified = true;
        }
      });
    });
  }

  // Essentials — ingredients added directly to the plan (day = null), not
  // via a recipe. Folded into the same aggregation so a "500g flour"
  // essential and a "500g flour" recipe need show up as one combined row.
  if (directIngredientItems && directIngredientItems.length) {
    const ingredientIds = [...new Set(directIngredientItems.map(i => i.ingredient_id))];
    const encoded = ingredientIds.map(id => `"${id}"`).join(",");
    const ingredients = await supabaseRequest("ingredients", {
      query: `?select=id,name,category,is_staple,grams_per_ml&id=in.(${encoded})`
    });
    const ingredientsById = Object.fromEntries(ingredients.map(i => [i.id, i]));

    directIngredientItems.forEach(raw => {
      const ing = ingredientsById[raw.ingredient_id];
      if (!ing) return;
      const unit = raw.unit || "";
      const key = `${raw.ingredient_id}::${unit}`;
      if (!aggregated[key]) {
        aggregated[key] = {
          ingredientId: raw.ingredient_id,
          label: ing.name,
          category: ing.category || "Other",
          unit,
          qtySum: 0,
          hasUnspecified: false,
          isStaple: !!ing.is_staple,
          gramsPerMl: ing.grams_per_ml || null
        };
      }
      if (raw.quantity !== null && raw.quantity !== undefined) {
        aggregated[key].qtySum += raw.quantity;
      } else {
        aggregated[key].hasUnspecified = true;
      }
    });
  }

  return Object.values(aggregated);
}

async function loadFoodContributions(foodItems) {
  if (!foodItems.length) return [];

  const foodIds = [...new Set(foodItems.map(i => i.food_id))];
  const encoded = foodIds.map(id => `"${id}"`).join(",");

  const foods = await supabaseRequest("foods", {
    query: `?select=id,name,brand,price,shopping_category&id=in.(${encoded})`
  });
  const foodsById = Object.fromEntries(foods.map(f => [f.id, f]));

  const aggregated = {};
  foodItems.forEach(item => {
    aggregated[item.food_id] = (aggregated[item.food_id] || 0) + (item.quantity || 1);
  });

  return Object.entries(aggregated).map(([foodId, qty]) => {
    const food = foodsById[foodId];
    if (!food) return null;
    return {
      foodId,
      label: food.brand ? `${food.name} (${food.brand})` : food.name,
      category: food.shopping_category || "Other",
      qty,
      unitPrice: food.price !== null && food.price !== undefined ? food.price : null
    };
  }).filter(Boolean);
}

// ---------- Pantry matching (uses js/units.js for conversion) ----------

function applyPantry(ingredientRowsRaw, foodRowsRaw, pantryItems) {
  // Pantry entries are kept as a list per ingredient, not collapsed by
  // exact unit string — a row asking for "500g" needs to be able to draw
  // on a pantry entry logged as "1kg", which requires actually converting
  // rather than string-matching.
  const pantryIngredientEntries = {}; // ingredientId -> [{ quantity, unit }]
  const pantryFoodMap = {};
  const trackedIngredientIds = new Set();

  pantryItems.forEach(p => {
    if (p.ingredient_id) {
      trackedIngredientIds.add(p.ingredient_id);
      if (!pantryIngredientEntries[p.ingredient_id]) pantryIngredientEntries[p.ingredient_id] = [];
      pantryIngredientEntries[p.ingredient_id].push({ quantity: p.quantity || 0, unit: p.unit || "" });
    } else if (p.food_id) {
      pantryFoodMap[p.food_id] = (pantryFoodMap[p.food_id] || 0) + (p.quantity || 0);
    }
  });

  function getOwnedInUnit(ingredientId, neededUnit, gramsPerMl) {
    const entries = pantryIngredientEntries[ingredientId] || [];
    let total = 0;
    entries.forEach(e => {
      const converted = convertQuantity(e.quantity, e.unit, neededUnit, gramsPerMl);
      if (converted !== null) total += converted;
    });
    return total;
  }

  const buyRows = [];
  const coveredRows = [];
  const reminderRows = []; // staples with no pantry tracking — "you should have"

  ingredientRowsRaw.forEach(row => {
    if (row.isStaple && !trackedIngredientIds.has(row.ingredientId)) {
      reminderRows.push({
        category: row.category, label: row.label,
        qtyLabel: row.qtySum > 0 ? `needs ${formatQty(row.qtySum)}${row.unit ? " " + row.unit : ""}` : "amount not specified",
        key: `ing:${row.ingredientId}:${row.unit}`
      });
      return;
    }

    const owned = getOwnedInUnit(row.ingredientId, row.unit, row.gramsPerMl);

    if (row.qtySum > 0 && owned > 0) {
      const remaining = row.qtySum - owned;
      if (remaining <= 0) {
        coveredRows.push({
          category: row.category, label: row.label,
          qtyLabel: `need ${formatQty(row.qtySum)}${row.unit ? " " + row.unit : ""} — have ${formatQty(owned)}${row.unit ? " " + row.unit : ""}`,
          price: null, key: `ing:${row.ingredientId}:${row.unit}`,
          type: "ingredient", refId: row.ingredientId, unit: row.unit, needQty: 0
        });
        return;
      }
      buyRows.push({
        category: row.category, label: row.label,
        qtyLabel: `${formatQty(remaining)}${row.unit ? " " + row.unit : ""}${row.hasUnspecified ? " + more" : ""} (have ${formatQty(owned)} already)`,
        price: null, key: `ing:${row.ingredientId}:${row.unit}`,
        type: "ingredient", refId: row.ingredientId, unit: row.unit, needQty: remaining
      });
      return;
    }

    buyRows.push({
      category: row.category, label: row.label,
      qtyLabel: row.qtySum > 0
        ? `${formatQty(row.qtySum)}${row.unit ? " " + row.unit : ""}${row.hasUnspecified ? " + more" : ""}`
        : (row.hasUnspecified ? "some (amount not specified)" : ""),
      price: null, key: `ing:${row.ingredientId}:${row.unit}`,
      type: "ingredient", refId: row.ingredientId, unit: row.unit, needQty: row.qtySum > 0 ? row.qtySum : null
    });
  });

  foodRowsRaw.forEach(row => {
    const owned = pantryFoodMap[row.foodId] || 0;
    const remaining = row.qty - owned;

    if (owned > 0 && remaining <= 0) {
      coveredRows.push({
        category: row.category, label: row.label,
        qtyLabel: `need ×${formatQty(row.qty)} — have ×${formatQty(owned)}`,
        price: null, key: `food:${row.foodId}`,
        type: "food", refId: row.foodId, unit: null, needQty: 0
      });
      return;
    }

    buyRows.push({
      category: row.category, label: row.label,
      qtyLabel: `×${formatQty(remaining)}${owned > 0 ? ` (have ×${formatQty(owned)} already)` : ""}`,
      price: row.unitPrice !== null ? row.unitPrice * remaining : null,
      key: `food:${row.foodId}`,
      type: "food", refId: row.foodId, unit: null, needQty: remaining
    });
  });

  return { buyRows, coveredRows, reminderRows };
}

// ---------- Pricing (from logged product_prices) ----------

async function loadCheapestPrices() {
  const rows = await supabaseRequest("product_prices", {
    query: "?select=ingredient_id,food_id,store,brand,pack_unit,unit_price,price&order=unit_price.asc"
  });

  const cheapestByIngredient = {};
  const cheapestByFood = {};
  rows.forEach(r => {
    if (r.ingredient_id && !cheapestByIngredient[r.ingredient_id]) cheapestByIngredient[r.ingredient_id] = r;
    if (r.food_id && !cheapestByFood[r.food_id]) cheapestByFood[r.food_id] = r;
  });
  return { cheapestByIngredient, cheapestByFood };
}

function applyPricing(buyRows, { cheapestByIngredient, cheapestByFood }) {
  buyRows.forEach(row => {
    if (row.type === "ingredient") {
      const cheapest = cheapestByIngredient[row.refId];
      if (!cheapest) return;
      const storeLabel = cheapest.brand ? `${cheapest.store} (${cheapest.brand})` : cheapest.store;
      if (row.unit && cheapest.pack_unit && row.unit.toLowerCase() === cheapest.pack_unit.toLowerCase() && row.needQty) {
        row.price = cheapest.unit_price * row.needQty;
        row.priceSource = `£${cheapest.unit_price.toFixed(2)}/${cheapest.pack_unit} at ${storeLabel}`;
      } else {
        row.priceHint = `~£${cheapest.unit_price.toFixed(2)}/${cheapest.pack_unit} at ${storeLabel}`;
      }
    } else if (row.type === "food") {
      const cheapest = cheapestByFood[row.refId];
      if (!cheapest) return;
      const computed = cheapest.unit_price * (row.needQty || 0);
      if (row.price === null || computed < row.price) {
        row.price = computed;
        const storeLabel = cheapest.brand ? `${cheapest.store} (${cheapest.brand})` : cheapest.store;
        row.priceSource = `£${cheapest.unit_price.toFixed(2)} at ${storeLabel}`;
      }
    }
  });
}

// ---------- The single function responsible for updating the pantry ----------
// Takes a batch: [{ ingredientId, foodId, unit, qty }]. Anything already
// logged with the same item + unit gets its quantity merged rather than
// duplicated; anything new gets inserted.
async function addItemsToPantry(items) {
  for (const item of items) {
    if (!item.qty || item.qty <= 0) continue;

    const filters = item.ingredientId
      ? `ingredient_id=eq.${item.ingredientId}&${item.unit ? `unit=eq.${encodeURIComponent(item.unit)}` : "unit=is.null"}`
      : `food_id=eq.${item.foodId}`;

    const existing = await supabaseRequest("pantry_items", {
      query: `?select=id,quantity&${filters}&user_id=eq.${window.currentUserId}&limit=1`
    });

    if (existing.length) {
      const newQty = (existing[0].quantity || 0) + item.qty;
      await supabaseRequest("pantry_items", { method: "PATCH", query: `?id=eq.${existing[0].id}`, body: { quantity: newQty } });
    } else {
      const body = { quantity: item.qty, unit: item.unit || null, user_id: window.currentUserId };
      if (item.ingredientId) body.ingredient_id = item.ingredientId; else body.food_id = item.foodId;
      await supabaseRequest("pantry_items", { method: "POST", body });
    }
  }
}

// Given a week's meal_plan_id, returns the full computed shopping picture.
// This is the one call both pages make.
async function computeShoppingList(mealPlanId) {
  const items = await supabaseRequest("meal_plan_items", {
    query: `?select=day,meal_type,recipe_id,food_id,ingredient_id,quantity,unit,portions_made,leftover_of,pantry_applied_at&meal_plan_id=eq.${mealPlanId}`
  });

  if (!items.length) return { buyRows: [], coveredRows: [], reminderRows: [] };

  const recipeItems = items.filter(i => i.recipe_id && !i.leftover_of && !i.pantry_applied_at);
  const foodItems = items.filter(i => i.food_id && !i.pantry_applied_at);
  const directIngredientItems = items.filter(i => i.ingredient_id && !i.pantry_applied_at);

  const [ingredientRows, foodRows, pantryItems, cheapestPrices] = await Promise.all([
    loadIngredientContributions(recipeItems, directIngredientItems),
    loadFoodContributions(foodItems),
    supabaseRequest("pantry_items", { query: `?select=ingredient_id,food_id,quantity,unit&user_id=eq.${window.currentUserId}` }),
    loadCheapestPrices()
  ]);

  const result = applyPantry(ingredientRows, foodRows, pantryItems);
  applyPricing(result.buyRows, cheapestPrices);
  return result;
}
