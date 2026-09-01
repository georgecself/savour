// shopping.js — builds this week's shopping list from meal_plan_items,
// combining recipe ingredient quantities and food quantities.

const CHECKED_KEY_PREFIX = "savour_shopping_checked_"; // + week start date

let checkedKeys = new Set();
let currentWeekStart = null;
let lastBuyRows = []; // kept around so "Complete shop" can look up ticked rows

function getMondayOf(date) {
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

let viewedMonday = getMondayOf(new Date());

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeekStart() {
  return isoDate(viewedMonday);
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
    setShellStatus(undefined, "Loading…");
    currentWeekStart = getWeekStart();
    const weekEnd = getWeekEnd(currentWeekStart);
    checkedKeys = loadCheckedFromStorage(currentWeekStart);
    updateWeekHeading();

    const plans = await supabaseRequest("meal_plans", {
      query: `?select=id&week_start=eq.${currentWeekStart}&user_id=eq.${window.currentUserId}&limit=1`
    });

    if (!plans.length) {
      renderEmpty();
      setShellStatus("ok", "Connected to Server");
      return;
    }

    const mealPlanId = plans[0].id;
    const items = await supabaseRequest("meal_plan_items", {
      query: `?select=day,meal_type,recipe_id,food_id,quantity,portions_made,leftover_of,pantry_applied_at&meal_plan_id=eq.${mealPlanId}`
    });

    if (!items.length) {
      renderEmpty();
      setShellStatus("ok", "Connected to Server");
      return;
    }

    // Leftover entries contributed nothing new — their ingredients were
    // already counted when the original batch was cooked. Items already
    // marked as cooked/eaten are also excluded here: once you've made
    // something, its ingredients are resolved one way or another, so they
    // shouldn't keep showing up as still needed.
    const recipeItems = items.filter(i => i.recipe_id && !i.leftover_of && !i.pantry_applied_at);
    const foodItems = items.filter(i => i.food_id && !i.pantry_applied_at);

    const [ingredientRows, foodRows, pantryItems, cheapestPrices] = await Promise.all([
      loadIngredientContributions(recipeItems),
      loadFoodContributions(foodItems),
      supabaseRequest("pantry_items", { query: `?select=ingredient_id,food_id,quantity,unit&user_id=eq.${window.currentUserId}` }),
      loadCheapestPrices()
    ]);

    const { buyRows, coveredRows, reminderRows } = applyPantry(ingredientRows, foodRows, pantryItems);
    applyPricing(buyRows, cheapestPrices);

    render(buyRows, coveredRows, reminderRows);
    setShellStatus("ok", "Connected to Server");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
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

  const byRecipe = {};
  recipeIngredients.forEach(ri => {
    if (!byRecipe[ri.recipe_id]) byRecipe[ri.recipe_id] = [];
    byRecipe[ri.recipe_id].push(ri);
  });

  const aggregated = {}; // key = ingredientId::unit

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

function applyPantry(ingredientRowsRaw, foodRowsRaw, pantryItems) {
  const pantryIngredientMap = {};
  const pantryFoodMap = {};
  const trackedIngredientIds = new Set();

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
    if (row.isStaple && !trackedIngredientIds.has(row.ingredientId)) {
      reminderRows.push({
        category: row.category, label: row.label,
        qtyLabel: row.qtySum > 0 ? `needs ${formatQty(row.qtySum)}${row.unit ? " " + row.unit : ""}` : "amount not specified",
        key: `ing:${row.ingredientId}:${row.unit}`
      });
      return;
    }

    const key = `${row.ingredientId}::${row.unit}`;
    const owned = pantryIngredientMap[key] || 0;

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

// ---------- Rendering ----------

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
      `<div class="empty-state">Everything planned this week is already covered.</div>` + renderReminderSection(reminderRows) + renderCoveredSection(coveredRows);
    renderSummary(buyRows, coveredRows, reminderRows);
    document.getElementById("completeShopBar").style.display = "none";
    return;
  }

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
              <div class="shop-label">
                ${esc(row.label)}
                ${row.priceHint ? `<div style="font-size:11px; color:var(--muted);">${esc(row.priceHint)}</div>` : ""}
              </div>
              <div class="shop-qty">${esc(row.qtyLabel)}</div>
              ${row.price !== null ? `<div class="shop-price">£${row.price.toFixed(2)}${row.priceSource ? `<br><span style="font-weight:400; font-size:10px; color:var(--muted);">${esc(row.priceSource)}</span>` : ""}</div>` : ""}
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
    <div class="category reminder">
      <h3>Worth checking — staples you should already have</h3>
      <div class="card category-card reminder">
        ${reminderRows.map(row => `
          <div class="shop-row">
            <div class="shop-label">${esc(row.label)}</div>
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
    <div class="category covered">
      <h3>Already covered by pantry</h3>
      <div class="card category-card covered">
        ${coveredRows.map(row => `
          <div class="shop-row">
            <div class="shop-label">${esc(row.label)}</div>
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

  const stats = [
    { value: buyRows.length, label: "To buy" },
    { value: coveredRows.length, label: "Covered by pantry" },
    { value: reminderRows.length, label: "Worth checking" },
    { value: totalCost > 0 ? `£${totalCost.toFixed(2)}` : "—", label: "Estimated cost" }
  ];

  summary.innerHTML = `
    <div class="shopping-stats">
      ${stats.map(s => `<div class="shopping-stat"><span class="shopping-stat-value">${esc(String(s.value))}</span><span class="shopping-stat-label">${esc(s.label)}</span></div>`).join("")}
    </div>
    <div class="summary-note">Estimated cost only covers items with a logged price on the Prices page (or foods with a price set) — everything else is unpriced for now.</div>
  `;
}

function renderEmpty() {
  document.getElementById("summaryBar").innerHTML = "";
  document.getElementById("listContainer").innerHTML =
    `<div class="empty-state">Nothing planned for this week yet — add recipes or foods on the Week page and they'll show up here.</div>`;
}

function updateWeekHeading() {
  const monday = new Date(viewedMonday);
  const sunday = new Date(viewedMonday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = d => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const isCurrentWeek = isoDate(viewedMonday) === isoDate(getMondayOf(new Date()));
  const rangeLabel = `${fmt(monday)} – ${fmt(sunday)}`;
  const heading = document.getElementById("weekHeading");
  if (heading) heading.textContent = isCurrentWeek ? `Shopping List (${rangeLabel})` : `Shopping List — ${rangeLabel}`;
}

async function navigateWeek(delta) {
  viewedMonday.setDate(viewedMonday.getDate() + delta * 7);
  await loadShoppingList();
}

async function jumpToToday() {
  viewedMonday = getMondayOf(new Date());
  await loadShoppingList();
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
    const box = row.querySelector("input[type=checkbox]");
    if (box) box.checked = false;
  });
}

// ---------- Adding items to the pantry ----------
//
// This is the one function responsible for "the whole logic of updating the
// pantry" — everything that touches pantry_items when a shop is completed
// goes through here, rather than being spread across the modal/confirm flow.
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

// ---------- Complete shop modal — reviews quantities, then calls addItemsToPantry ----------

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
          <div class="mark-row-name">${esc(r.label)}</div>
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

async function confirmCompleteShop() {
  try {
    const items = pendingShopRows.map((r, i) => {
      const qtyRaw = document.getElementById(`shopQty_${i}`).value;
      return {
        ingredientId: r.type === "ingredient" ? r.refId : null,
        foodId: r.type === "food" ? r.refId : null,
        unit: r.unit,
        qty: qtyRaw === "" ? 0 : Number(qtyRaw)
      };
    });

    await addItemsToPantry(items);

    pendingShopRows.forEach(r => checkedKeys.delete(r.key));
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

// ---------- Deal Checker (popup, launched from the toolbar) ----------
// Lazily loads its own item lists on first open — no point fetching this
// unless someone actually uses it. Submitting a logged price is admin-only,
// matching the same restriction now enforced at the database level.

const dealCheck = {
  ingredients: null,
  foods: null,
  type: "ingredient",
  selection: null,
  priceHistory: []
};

const VERDICT_ICONS = {
  good: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>`,
  typical: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>`,
  bad: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>`,
  unknown: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.4v.3"/><path d="M12 17h.01"/></svg>`
};

async function openDealCheckModal() {
  document.getElementById("modal").innerHTML = `<h2>Check a deal</h2><p class="meta">Loading…</p>`;
  document.getElementById("modalBackdrop").classList.add("open");

  if (!dealCheck.ingredients) {
    try {
      const [ingredients, foods] = await Promise.all([
        supabaseRequest("ingredients", { query: "?select=id,name,default_unit&order=name.asc" }),
        supabaseRequest("foods", { query: `?select=id,name,serving_unit&user_id=eq.${window.currentUserId}&order=name.asc` })
      ]);
      dealCheck.ingredients = ingredients;
      dealCheck.foods = foods;
    } catch (error) {
      console.error(error);
      document.getElementById("modal").innerHTML = `<h2>Check a deal</h2><p class="meta">Couldn't load items. Check the browser console for details.</p><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`;
      return;
    }
  }

  dealCheck.type = "ingredient";
  dealCheck.selection = null;
  renderDealCheckPicker();
}

function renderDealCheckPicker() {
  document.getElementById("modal").innerHTML = `
    <h2>Check a deal</h2>
    <div class="type-toggle">
      <button type="button" class="type-btn ${dealCheck.type === "ingredient" ? "active" : ""}" onclick="switchDealCheckType('ingredient')">Ingredient</button>
      <button type="button" class="type-btn ${dealCheck.type === "food" ? "active" : ""}" onclick="switchDealCheckType('food')">Food</button>
    </div>
    <div class="field">
      <label>What are you looking at?</label>
      <input id="dcPickSearch" placeholder="Type to search…" oninput="renderDealCheckOptions()">
    </div>
    <div id="dcPickOptions" class="pick-options"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>
  `;
  renderDealCheckOptions();
}

function switchDealCheckType(type) {
  dealCheck.type = type;
  dealCheck.selection = null;
  renderDealCheckPicker();
}

function renderDealCheckOptions() {
  const term = document.getElementById("dcPickSearch").value.trim().toLowerCase();
  const source = dealCheck.type === "ingredient" ? dealCheck.ingredients : dealCheck.foods;
  const filtered = source.filter(x => x.name.toLowerCase().includes(term));
  const box = document.getElementById("dcPickOptions");

  if (!filtered.length) {
    box.innerHTML = `<div class="empty-state">${source.length ? "No matches." : `No ${dealCheck.type}s yet.`}</div>`;
    return;
  }
  box.innerHTML = filtered.map(x => `<div class="pick-option" onclick="selectDealCheckItem('${x.id}')">${esc(x.name)}</div>`).join("");
}

async function selectDealCheckItem(id) {
  const source = dealCheck.type === "ingredient" ? dealCheck.ingredients : dealCheck.foods;
  const item = source.find(x => x.id === id);
  if (!item) return;

  dealCheck.selection = { id: item.id, name: item.name, defaultUnit: dealCheck.type === "ingredient" ? item.default_unit : item.serving_unit };
  document.getElementById("modal").innerHTML = `<h2>Check a deal</h2><p class="meta">Loading price history…</p>`;

  try {
    const filterField = dealCheck.type === "ingredient" ? "ingredient_id" : "food_id";
    dealCheck.priceHistory = await supabaseRequest("product_prices", {
      query: `?select=unit_price,is_deal,pack_unit&${filterField}=eq.${item.id}`
    });
  } catch (error) {
    console.error(error);
    dealCheck.priceHistory = [];
  }

  renderDealCheckDetails();
}

function dealCheckChangeSelection() {
  dealCheck.selection = null;
  renderDealCheckPicker();
}

function computeDealCheckGuidePrice() {
  const nonDeal = dealCheck.priceHistory.filter(p => !p.is_deal);
  const source = nonDeal.length ? nonDeal : dealCheck.priceHistory;
  if (!source.length) return null;
  const avg = source.reduce((sum, p) => sum + p.unit_price, 0) / source.length;
  return { avg, count: source.length, isFallbackToDeals: !nonDeal.length };
}

function getDealCheckVerdict(enteredUnitPrice, guide) {
  if (!guide) return { key: "unknown", label: "No data to compare yet", detail: "This will become the first reference price for this item." };
  const ratio = enteredUnitPrice / guide.avg;
  if (ratio <= 0.85) return { key: "good", label: "Good deal!", detail: `${Math.round((1 - ratio) * 100)}% below the typical £${guide.avg.toFixed(2)}` };
  if (ratio >= 1.15) return { key: "bad", label: "Pricier than usual", detail: `${Math.round((ratio - 1) * 100)}% above the typical £${guide.avg.toFixed(2)}` };
  return { key: "typical", label: "Fairly typical price", detail: `Typical price is around £${guide.avg.toFixed(2)}` };
}

function renderDealCheckDetails() {
  const sel = dealCheck.selection;
  const guide = computeDealCheckGuidePrice();
  const isAdmin = window.currentUserId === ADMIN_USER_ID;

  document.getElementById("modal").innerHTML = `
    <h2>Check a deal</h2>
    <div class="selection-banner">
      <span>${esc(sel.name)}</span>
      <button onclick="dealCheckChangeSelection()">Change</button>
    </div>
    <div class="guide-note">
      ${guide
        ? `Typical price so far: <strong>£${guide.avg.toFixed(2)}</strong> per unit (from ${guide.count} logged price${guide.count === 1 ? "" : "s"}${guide.isFallbackToDeals ? " — deal prices only, no baseline yet" : ""})`
        : "No prices logged for this yet."}
    </div>
    <div class="form-grid">
      <div class="field"><label>Price seen</label><input id="dcPrice" type="number" step="any" min="0" placeholder="e.g. 2.00" oninput="updateDealCheckVerdict()"></div>
      <div class="field"><label>Pack size (total)</label><input id="dcPackSize" type="number" step="any" min="0" placeholder="e.g. 500" oninput="updateDealCheckVerdict()"></div>
      <div class="field full"><label>Pack unit</label><input id="dcPackUnit" placeholder="e.g. g" value="${esc(sel.defaultUnit || "")}" oninput="updateDealCheckVerdict()"></div>
      ${isAdmin ? `
        <div class="field"><label>Store</label><input id="dcStore" placeholder="e.g. Tesco"></div>
        <div class="field"><label>Brand (optional)</label><input id="dcBrand" placeholder="e.g. Tesco Finest"></div>
      ` : ""}
    </div>
    <div id="dcVerdictBox"></div>
    <div id="dcSuggestBox"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>
  `;
}

function updateDealCheckVerdict() {
  const price = Number(document.getElementById("dcPrice").value);
  const packSize = Number(document.getElementById("dcPackSize").value);
  const packUnit = document.getElementById("dcPackUnit").value.trim();
  const box = document.getElementById("dcVerdictBox");
  const suggestBox = document.getElementById("dcSuggestBox");
  const isAdmin = window.currentUserId === ADMIN_USER_ID;

  if (!price || !packSize || !packUnit) {
    box.innerHTML = "";
    suggestBox.innerHTML = "";
    return;
  }

  const unitPrice = price / packSize;
  const guide = computeDealCheckGuidePrice();
  const verdict = getDealCheckVerdict(unitPrice, guide);

  box.innerHTML = `
    <div class="verdict ${verdict.key}">
      <div class="verdict-icon">${VERDICT_ICONS[verdict.key]}</div>
      <div class="verdict-label">${esc(verdict.label)}</div>
      <div class="verdict-detail">${esc(verdict.detail)}</div>
      <div class="verdict-detail">£${unitPrice.toFixed(2)} per ${esc(packUnit)}</div>
    </div>
    ${isAdmin ? `
      <div class="checkbox-row">
        <input type="checkbox" id="dcIsDeal" ${verdict.key === "good" ? "checked" : ""}>
        <label for="dcIsDeal">Mark as a deal/promotion</label>
      </div>
      <button class="btn primary" style="width:100%; border-radius:999px;" onclick="logDealCheckPrice()">Log this price</button>
    ` : ""}
  `;

  if (verdict.key === "good" && dealCheck.type === "ingredient") {
    renderDealCheckSuggestions();
  } else {
    suggestBox.innerHTML = "";
  }
}

async function renderDealCheckSuggestions() {
  const suggestBox = document.getElementById("dcSuggestBox");
  suggestBox.innerHTML = `<p class="meta">Looking for recipes that use this…</p>`;

  try {
    const rows = await supabaseRequest("recipe_ingredients", {
      query: `?select=recipe_id,recipes(id,name,servings,cooking_time_minutes)&ingredient_id=eq.${dealCheck.selection.id}`
    });
    const seen = new Set();
    const recipes = [];
    rows.forEach(r => { if (r.recipes && !seen.has(r.recipes.id)) { seen.add(r.recipes.id); recipes.push(r.recipes); } });

    if (!recipes.length) {
      suggestBox.innerHTML = `<p class="meta">No recipes using this yet — worth adding one while it's cheap!</p>`;
      return;
    }

    suggestBox.innerHTML = `
      <div class="recipe-suggest">
        <h3>Recipes using this</h3>
        <ul class="suggest-list">
          ${recipes.map(r => `
            <li>
              <span>${esc(r.name)}<br><span class="suggest-sub">Serves ${r.servings || "?"} · ${r.cooking_time_minutes ? r.cooking_time_minutes + " mins" : ""}</span></span>
              <a class="btn" style="border-radius:999px;" href="recipe-view.html?id=${r.id}">View</a>
            </li>
          `).join("")}
        </ul>
      </div>
    `;
  } catch (error) {
    console.error(error);
    suggestBox.innerHTML = "";
  }
}

async function logDealCheckPrice() {
  const store = document.getElementById("dcStore").value.trim() || "Unspecified";
  const brand = document.getElementById("dcBrand").value.trim();
  const price = Number(document.getElementById("dcPrice").value);
  const packSize = Number(document.getElementById("dcPackSize").value);
  const packUnit = document.getElementById("dcPackUnit").value.trim();
  const isDeal = document.getElementById("dcIsDeal").checked;

  const body = {
    store, brand: brand || null, product_name: dealCheck.selection.name,
    pack_size: packSize, pack_unit: packUnit, price,
    is_deal: isDeal, deal_ends_on: null, logged_by: window.currentUserId
  };
  if (dealCheck.type === "ingredient") body.ingredient_id = dealCheck.selection.id; else body.food_id = dealCheck.selection.id;

  try {
    await supabaseRequest("product_prices", { method: "POST", body });
    alert("Price logged — thanks, this helps future deal checks.");
    closeModal();
  } catch (error) {
    console.error(error);
    alert("Couldn't log that price. Check the browser console for details.\n\nIf this keeps happening, double-check price submission is actually meant to be admin-only for your account.");
  }
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadShoppingList();
})();
