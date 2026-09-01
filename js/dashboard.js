function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMondayIso(fromDate) {
  const now = fromDate || new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return isoDate(monday);
}

function formatDayLabel(iso) {
  const today = isoDate(new Date());
  const tomorrow = isoDate(new Date(Date.now() + 86400000));
  if (iso === today) return "Today";
  if (iso === tomorrow) return "Tomorrow";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

async function loadGreeting() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  try {
    const rows = await supabaseRequest("profiles", { query: `?select=display_name&id=eq.${window.currentUserId}&limit=1` });
    const name = rows[0]?.display_name || (user?.email ? user.email.split("@")[0] : "");
    document.getElementById("greetName").textContent = name ? `, ${name}` : "";
  } catch (error) {
    console.error(error);
  }
}

// ---------- Stats ----------

async function loadStats() {
  const weekStart = getMondayIso();

  const [recipes, pantry, plans] = await Promise.all([
    supabaseRequest("recipes", { query: `?select=id&user_id=eq.${window.currentUserId}` }),
    supabaseRequest("pantry_items", { query: `?select=id&user_id=eq.${window.currentUserId}` }),
    supabaseRequest("meal_plans", { query: `?select=id&week_start=eq.${weekStart}&user_id=eq.${window.currentUserId}&limit=1` })
  ]);

  document.getElementById("statRecipeCount").textContent = recipes.length;
  document.getElementById("statPantryCount").textContent = pantry.length;

  let weekCount = 0;
  let mealPlanId = null;
  if (plans.length) {
    mealPlanId = plans[0].id;
    const items = await supabaseRequest("meal_plan_items", { query: `?select=id&meal_plan_id=eq.${mealPlanId}` });
    weekCount = items.length;
  }
  document.getElementById("statWeekCount").textContent = weekCount;

  const outstanding = await loadOutstandingShoppingCount(mealPlanId);
  document.getElementById("statShoppingCount").textContent = outstanding;
}

// A lightweight approximation of the real Shopping page's logic — counts
// distinct ingredients/foods needed this week that aren't already sitting
// in the pantry at all. Doesn't account for partial coverage or unit
// mismatches the way the real Shopping page does; it's meant as a glance
// figure, not a replacement for it.
async function loadOutstandingShoppingCount(mealPlanId) {
  if (!mealPlanId) return 0;

  const items = await supabaseRequest("meal_plan_items", {
    query: `?select=recipe_id,food_id,leftover_of&meal_plan_id=eq.${mealPlanId}`
  });
  if (!items.length) return 0;

  const recipeIds = [...new Set(items.filter(i => i.recipe_id && !i.leftover_of).map(i => i.recipe_id))];
  const foodIds = [...new Set(items.filter(i => i.food_id).map(i => i.food_id))];

  const neededIngredientKeys = new Set();
  if (recipeIds.length) {
    const encoded = recipeIds.map(id => `"${id}"`).join(",");
    const recipeIngredients = await supabaseRequest("recipe_ingredients", {
      query: `?select=ingredient_id,unit&recipe_id=in.(${encoded})`
    });
    recipeIngredients.forEach(ri => neededIngredientKeys.add(`${ri.ingredient_id}::${ri.unit || ""}`));
  }

  let coveredIngredientKeys = new Set();
  let coveredFoodIds = new Set();
  if (neededIngredientKeys.size || foodIds.length) {
    const pantryItems = await supabaseRequest("pantry_items", {
      query: `?select=ingredient_id,food_id,unit&user_id=eq.${window.currentUserId}`
    });
    pantryItems.forEach(p => {
      if (p.ingredient_id) coveredIngredientKeys.add(`${p.ingredient_id}::${p.unit || ""}`);
      if (p.food_id) coveredFoodIds.add(p.food_id);
    });
  }

  const outstandingIngredients = [...neededIngredientKeys].filter(k => !coveredIngredientKeys.has(k)).length;
  const outstandingFoods = foodIds.filter(id => !coveredFoodIds.has(id)).length;

  return outstandingIngredients + outstandingFoods;
}

// ---------- Next recipe hero ----------

function mondayIsoOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return getMondayIso(new Date(y, m - 1, d));
}

async function loadNextRecipe() {
  const weekStart = getMondayIso();
  const todayIso = isoDate(new Date());

  const plans = await supabaseRequest("meal_plans", {
    query: `?select=id&user_id=eq.${window.currentUserId}&week_start=gte.${weekStart}&order=week_start.asc&limit=6`
  });
  if (!plans.length) return null;

  const planIds = plans.map(p => `"${p.id}"`).join(",");
  const items = await supabaseRequest("meal_plan_items", {
    query: `?select=id,day,meal_type,recipe_id,portions_made&meal_plan_id=in.(${planIds})&recipe_id=not.is.null&leftover_of=is.null&pantry_applied_at=is.null&day=gte.${todayIso}&order=day.asc&limit=10`
  });
  if (!items.length) return null;

  const earliestDay = items[0].day;
  const tagOrder = ["Breakfast", "Lunch", "Dinner", "Snack"];
  const sameDayItems = items.filter(i => i.day === earliestDay).sort((a, b) => {
    const ai = tagOrder.indexOf(a.meal_type), bi = tagOrder.indexOf(b.meal_type);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0;
  });
  const next = sameDayItems[0];

  const recipeRows = await supabaseRequest("recipes", {
    query: `?select=id,name,servings,cooking_time_minutes,image_url&id=eq.${next.recipe_id}&limit=1`
  });
  const recipe = recipeRows[0];
  if (!recipe) return null;

  return { item: next, recipe, day: earliestDay };
}

function renderNextRecipeHero(result) {
  const container = document.getElementById("nextRecipeHero");

  if (!result) {
    container.innerHTML = `<div class="card hero-empty"><p class="meta" style="margin:0;">Nothing planned yet — <a href="index.html">plan your week</a> to see your next meal here.</p></div>`;
    return;
  }

  const { item, recipe, day } = result;
  const dayLabel = formatDayLabel(day);
  const portions = item.portions_made || recipe.servings || "?";
  const timeLabel = recipe.cooking_time_minutes ? ` · ${recipe.cooking_time_minutes} mins` : "";
  const goToWeek = `index.html?week=${mondayIsoOf(day)}`;
  const hasPhoto = !!recipe.image_url;

  container.innerHTML = `
    <a href="recipe-view.html?id=${recipe.id}" class="item-hero${hasPhoto ? "" : " no-photo"}" ${hasPhoto ? `style="background-image:url('${esc(recipe.image_url)}')"` : ""}>
      <button class="hero-goto-btn" onclick="event.stopPropagation(); event.preventDefault(); window.location.href='${goToWeek}';">Go to meal plan</button>
      <div class="hero-content">
        <div class="tag-badge">${esc(item.meal_type || "Meal")}</div>
        <div class="item-name">${esc(recipe.name)}</div>
        <div class="item-sub">${esc(dayLabel)} · makes ${esc(String(portions))} portions${timeLabel}</div>
      </div>
    </a>
  `;
}

// ---------- Quick actions ----------

const QUICK_ACTIONS = [
  { href: "index.html", label: "Plan this week", icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>` },
  { href: "shopping.html", label: "Shopping list", icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h14l-1.5 10a2 2 0 0 1-2 1.7H8.5a2 2 0 0 1-2-1.7L5 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></svg>` },
  { href: "deal-check.html", label: "Check a deal", icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 12.6 12 21l-9-9V4h8l9.4 8.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/></svg>` }
];

function renderQuickActions() {
  document.getElementById("quickActions").innerHTML = QUICK_ACTIONS.map(a => `
    <a href="${a.href}" class="quick-action">
      <span class="quick-action-icon">${a.icon}</span>
      <span class="quick-action-label">${esc(a.label)}</span>
    </a>
  `).join("");
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return;
  renderQuickActions();
  try {
    const [, , nextRecipe] = await Promise.all([
      loadGreeting(),
      loadStats(),
      loadNextRecipe()
    ]);
    renderNextRecipeHero(nextRecipe);
    setShellStatus("ok", "Connected to Server");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
  }
})();
