// shopping.js — builds this week's shopping list from meal_plan_items,
// combining recipe ingredient quantities and food quantities.

const dayNames = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const CHECKED_KEY_PREFIX = "savour_shopping_checked_"; // + week start date

let checkedKeys = new Set();
let currentWeekStart = null;
let lastBuyRows = []; // kept around so "Complete shop" can look up ticked rows

function setDbStatus(message) {
  document.getElementById("dbStatus").textContent = message;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return isoDate(monday);
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return isoDate(d);
}

function formatQty(n) {
  if (n === null || n === undefined) return "";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function loadCheckedFromStorage(weekStart) {
  try {
    const raw = localStorage.getItem(CHECKED_KEY_PREFIX + window.currentUserId + "_" + weekStart);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveCheckedToStorage() {
  try {
    localStorage.setItem(CHECKED_KEY_PREFIX + window.currentUserId + "_" + currentWeekStart, JSON.stringify([...checkedKeys]));
  } catch (e) {
    console.warn("Couldn't persist checked items", e);
  }
}

async function loadShoppingList() {
  try {
    setDbStatus("Loading…");
    currentWeekStart = getWeekStart();
    const weekEnd = getWeekEnd(currentWeekStart);
    checkedKeys = loadCheckedFromStorage(currentWeekStart);

    const plans = await supabaseRequest("meal_plans", {
      query: `?select=id&week_start=eq.${currentWeekStart}&user_id=eq.${window.currentUserId}&limit=1`
    });

    if (!plans.length) {
      renderEmpty();
      setDbStatus("Connected to Supabase");
      return;
    }

    const mealPlanId = plans[0].id;
    const items = await supabaseRequest("meal_plan_items", {
      query: `?select=day,meal_type,recipe_id,food_id,quantity,portions_made,leftover_of&meal_plan_id=eq.${mealPlanId}`
    });

    if (!items.length) {
      renderEmpty();
      setDbStatus("Connected to Supabase");
      return;
    }

    // Leftover entries contributed nothing new — their ingredients were
    // already counted when the original batch was cooked.
    const recipeItems = items.filter(i => i.recipe_id && !i.leftover_of);
    const foodItems = items.filter(i => i.food_id);

    const [ingredientRows, foodRows, pantryItems] = await Promise.all([
      loadIngredientContributions(recipeItems),
      loadFoodContributions(foodItems),
      supabaseRequest("pantry_items", { query: `?select=ingredient_id,food_id,quantity,unit&user_id=eq.${window.currentUserId}` })
    ]);

    const { buyRows, coveredRows, reminderRows } = applyPantry(ingredientRows, foodRows, pantryItems);

    render(buyRows, coveredRows, reminderRows);
    setDbStatus("Connected to Supabase");
  } catch (error) {
    console.error(error);
    setDbStatus("Database connection failed");
    document.getElementById("listContainer").innerHTML =
      `<div class="empty-state">Couldn't load the shopping list. Check the browser console for details.</div>`;
  }
}

async function loadIngredientContributions(recipeItems) {
  if (!recipeItems.length) return [];

  const recipeIds = [...new Set(recipeItems.map(i => i.recipe_id))];
  const encoded = recipeIds.map(id => `"${id}"`).join(",");

  const [recipeIngredients, recipes] = await Promise.all([
    supabaseRequest("recipe_ingredients", {
      query: `?select=recipe_id,ingredient_id,quantity,unit,ingredients(id,name,category,is_staple)&recipe_id=in.(${encoded})`
    }),
    supabaseRequest("recipes", { query: `?select=id,servings&id=in.(${encoded})` })
  ]);

  const servingsByRecipe = Object.fromEntries(recipes.map(r => [r.id, r.servings || 1]));

  // Group recipe_ingredients by recipe_id for quick lookup.
  const byRecipe = {};
  recipeIngredients.forEach(ri => {
    if (!byRecipe[ri.recipe_id]) byRecipe[ri.recipe_id] = [];
    byRecipe[ri.recipe_id].push(ri);
  });

  // aggregated key = ingredientId::unit
  const aggregated = {};

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
          isStaple: !!ri.ingredients.is_staple
        };
      }
      if (ri.quantity !== null && ri.quantity !== undefined) {
        aggregated[key].qtySum += ri.quantity * multiplier;
      } else {
        aggregated[key].hasUnspecified = true;
      }
    });
  });

  return Object.values(aggregated); // raw — pantry subtraction happens before formatting
}

async function loadFoodContributions(foodItems) {
  if (!foodItems.length) return [];

  const foodIds = [...new Set(foodItems.map(i => i.food_id))];
  const encoded = foodIds.map(id => `"${id}"`).join(",");

  const foods = await supabaseRequest("foods", {
    query: `?select=id,name,brand,price,shopping_category&id=in.(${encoded})`
  });
  const foodsById = Object.fromEntries(foods.map(f => [f.id, f]));

  const aggregated = {}; // food_id -> qty sum
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

function applyPantry(ingredientRowsRaw, foodRowsRaw, pantryItems) {
  const pantryIngredientMap = {}; // ingredientId::unit -> qty
  const pantryFoodMap = {}; // foodId -> qty
  const trackedIngredientIds = new Set(); // ingredients with ANY pantry entry, any unit

  pantryItems.forEach(p => {
    if (p.ingredient_id) {
      trackedIngredientIds.add(p.ingredient_id);
      const key = `${p.ingredient_id}::${p.unit || ""}`;
      pantryIngredientMap[key] = (pantryIngredientMap[key] || 0) + (p.quantity || 0);
    } else if (p.food_id) {
      pantryFoodMap[p.food_id] = (pantryFoodMap[p.food_id] || 0) + (p.quantity || 0);
    }
  });

  const buyRows = [];
  const coveredRows = [];
  const reminderRows = []; // staples with no pantry tracking — "you should have"

  ingredientRowsRaw.forEach(row => {
    // Staple, and never actually logged in the Pantry — treat as a nudge to
    // check the cupboard rather than a firm buy-list item.
    if (row.isStaple && !trackedIngredientIds.has(row.ingredientId)) {
      reminderRows.push({
        icon: "🧂", category: row.category, label: row.label,
        qtyLabel: row.qtySum > 0 ? `needs ${formatQty(row.qtySum)}${row.unit ? " " + row.unit : ""}` : "amount not specified",
        key: `ing:${row.ingredientId}:${row.unit}`
      });
      return;
    }

    const key = `${row.ingredientId}::${row.unit}`;
    const owned = pantryIngredientMap[key] || 0;

    // Can only safely subtract when we know the needed amount — an
    // unspecified-quantity ingredient always stays on the buy list.
    if (row.qtySum > 0 && owned > 0) {
      const remaining = row.qtySum - owned;
      if (remaining <= 0) {
        coveredRows.push({
          icon: "🍳", category: row.category, label: row.label,
          qtyLabel: `need ${formatQty(row.qtySum)}${row.unit ? " " + row.unit : ""} — have ${formatQty(owned)}${row.unit ? " " + row.unit : ""}`,
          price: null, key: `ing:${row.ingredientId}:${row.unit}`,
          type: "ingredient", refId: row.ingredientId, unit: row.unit, needQty: 0
        });
        return;
      }
      buyRows.push({
        icon: "🍳", category: row.category, label: row.label,
        qtyLabel: `${formatQty(remaining)}${row.unit ? " " + row.unit : ""}${row.hasUnspecified ? " + more" : ""} (have ${formatQty(owned)} already)`,
        price: null, key: `ing:${row.ingredientId}:${row.unit}`,
        type: "ingredient", refId: row.ingredientId, unit: row.unit, needQty: remaining
      });
      return;
    }

    buyRows.push({
      icon: "🍳", category: row.category, label: row.label,
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
        icon: "🥫", category: row.category, label: row.label,
        qtyLabel: `need ×${formatQty(row.qty)} — have ×${formatQty(owned)}`,
        price: null, key: `food:${row.foodId}`,
        type: "food", refId: row.foodId, unit: null, needQty: 0
      });
      return;
    }

    buyRows.push({
      icon: "🥫", category: row.category, label: row.label,
      qtyLabel: `×${formatQty(remaining)}${owned > 0 ? ` (have ×${formatQty(owned)} already)` : ""}`,
      price: row.unitPrice !== null ? row.unitPrice * remaining : null,
      key: `food:${row.foodId}`,
      type: "food", refId: row.foodId, unit: null, needQty: remaining
    });
  });

  return { buyRows, coveredRows, reminderRows };
}

function render(buyRows, coveredRows, reminderRows) {
  lastBuyRows = buyRows;
  const allRows = [...buyRows, ...coveredRows, ...reminderRows];

  if (!allRows.length) {
    renderEmpty();
    document.getElementById("completeShopBar").style.display = "none";
    return;
  }

  if (!buyRows.length) {
    document.getElementById("listContainer").innerHTML =
      `<div class="empty-state">Everything planned this week is already covered.  🎉</div>` + renderReminderSection(reminderRows) + renderCoveredSection(coveredRows);
    renderSummary(buyRows, coveredRows, reminderRows);
    document.getElementById("completeShopBar").style.display = "none";
    return;
  }

  // Group buy rows by category
  const categories = {};
  buyRows.forEach(row => {
    if (!categories[row.category]) categories[row.category] = [];
    categories[row.category].push(row);
  });

  const sortedCategoryNames = Object.keys(categories).sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  const buyHtml = sortedCategoryNames.map(cat => {
    const rows = categories[cat].sort((a, b) => a.label.localeCompare(b.label));
    return `
      <div class="category">
        <h3>${esc(cat)}</h3>
        <div class="card category-card">
          ${rows.map(row => `
            <div class="shop-row ${checkedKeys.has(row.key) ? "checked" : ""}">
              <input type="checkbox" ${checkedKeys.has(row.key) ? "checked" : ""} onchange="toggleChecked('${row.key.replace(/'/g, "\\'")}', this)">
              <div class="shop-label"><span class="shop-icon">${row.icon}</span>${esc(row.label)}</div>
              <div class="shop-qty">${esc(row.qtyLabel)}</div>
              ${row.price !== null ? `<div class="shop-price">£${row.price.toFixed(2)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  document.getElementById("listContainer").innerHTML = buyHtml + renderReminderSection(reminderRows) + renderCoveredSection(coveredRows);
  renderSummary(buyRows, coveredRows, reminderRows);
  document.getElementById("completeShopBar").style.display = "block";
}

function renderReminderSection(reminderRows) {
  if (!reminderRows.length) return "";
  return `
    <div class="category">
      <h3>🧂 You should have these — worth checking</h3>
      <div class="card category-card">
        ${reminderRows.map(row => `
          <div class="shop-row">
            <div class="shop-label"><span class="shop-icon">${row.icon}</span>${esc(row.label)}</div>
            <div class="shop-qty">${esc(row.qtyLabel)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderCoveredSection(coveredRows) {
  if (!coveredRows.length) return "";
  return `
    <div class="category">
      <h3>Already covered by pantry</h3>
      <div class="card category-card">
        ${coveredRows.map(row => `
          <div class="shop-row">
            <div class="shop-label"><span class="shop-icon">${row.icon}</span>${esc(row.label)}</div>
            <div class="shop-qty">${esc(row.qtyLabel)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderSummary(buyRows, coveredRows, reminderRows) {
  const totalCost = buyRows.reduce((sum, r) => sum + (r.price || 0), 0);
  const summary = document.getElementById("summaryBar");
  summary.innerHTML = `
    <div class="summary-pill">${buyRows.length} to buy</div>
    ${coveredRows.length ? `<div class="summary-pill">${coveredRows.length} covered by pantry</div>` : ""}
    ${reminderRows.length ? `<div class="summary-pill">🧂 ${reminderRows.length} staples to check</div>` : ""}
    ${totalCost > 0 ? `<div class="summary-pill">Est. £${totalCost.toFixed(2)}</div>` : ""}
    <div class="summary-note">Cost estimate covers priced foods only — recipe ingredients aren't priced yet.</div>
  `;
}

function renderEmpty() {
  document.getElementById("summaryBar").innerHTML = "";
  document.getElementById("listContainer").innerHTML =
    `<div class="empty-state">Nothing planned for this week yet — add recipes or foods on the Week page and they'll show up here.</div>`;
}

function toggleChecked(key, checkbox) {
  if (checkbox.checked) checkedKeys.add(key); else checkedKeys.delete(key);
  checkbox.closest(".shop-row").classList.toggle("checked", checkbox.checked);
  saveCheckedToStorage();
}

function clearChecked() {
  checkedKeys.clear();
  saveCheckedToStorage();
  document.querySelectorAll(".shop-row").forEach(row => {
    row.classList.remove("checked");
    row.querySelector("input[type=checkbox]").checked = false;
  });
}

// ---------- Complete shop — adds ticked items to pantry ----------

let pendingShopRows = null;

function openCompleteShopModal() {
  pendingShopRows = lastBuyRows.filter(r => checkedKeys.has(r.key));

  if (!pendingShopRows.length) {
    alert("Tick some items off the list first — this adds whatever's ticked to your pantry.");
    return;
  }

  document.getElementById("modal").innerHTML = `
    <h2>Complete shop</h2>
    <p class="meta">These will be added to your pantry. Adjust any amounts first — e.g. if you bought more or less than planned.</p>
    <div>
      ${pendingShopRows.map((r, i) => `
        <div class="mark-row">
          <div class="mark-row-name">${r.icon} ${esc(r.label)}</div>
          <input type="number" step="any" min="0" id="shopQty_${i}" value="${r.needQty !== null ? formatQty(r.needQty) : ""}" placeholder="0">
          <div class="mark-row-unit">${esc(r.unit || "")}</div>
        </div>
      `).join("")}
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="confirmCompleteShop()">Add to pantry</button>
    </div>
  `;
  document.getElementById("modalBackdrop").classList.add("open");
}

async function addToPantry({ ingredientId, foodId, unit }, qty) {
  if (!qty || qty <= 0) return;

  const filters = ingredientId
    ? `ingredient_id=eq.${ingredientId}&${unit ? `unit=eq.${encodeURIComponent(unit)}` : "unit=is.null"}`
    : `food_id=eq.${foodId}`;

  const existing = await supabaseRequest("pantry_items", {
    query: `?select=id,quantity&${filters}&user_id=eq.${window.currentUserId}&limit=1`
  });

  if (existing.length) {
    const newQty = (existing[0].quantity || 0) + qty;
    await supabaseRequest("pantry_items", { method: "PATCH", query: `?id=eq.${existing[0].id}`, body: { quantity: newQty } });
  } else {
    const body = { quantity: qty, unit: unit || null, user_id: window.currentUserId };
    if (ingredientId) body.ingredient_id = ingredientId; else body.food_id = foodId;
    await supabaseRequest("pantry_items", { method: "POST", body });
  }
}

async function confirmCompleteShop() {
  try {
    for (let i = 0; i < pendingShopRows.length; i++) {
      const r = pendingShopRows[i];
      const qtyRaw = document.getElementById(`shopQty_${i}`).value;
      const qty = qtyRaw === "" ? 0 : Number(qtyRaw);
      await addToPantry({ ingredientId: r.type === "ingredient" ? r.refId : null, foodId: r.type === "food" ? r.refId : null, unit: r.unit }, qty);
      checkedKeys.delete(r.key);
    }
    saveCheckedToStorage();
    closeModal();
    alert("Pantry updated.");
    await loadShoppingList();
  } catch (error) {
    console.error(error);
    alert("Couldn't update your pantry. Check the browser console for details.");
  }
}

function closeModal() {
  document.getElementById("modalBackdrop").classList.remove("open");
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadShoppingList();
})();
