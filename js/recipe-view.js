let recipe = null;
let checkedIngredients = new Set();
let cookStepIndex = 0;

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

function getRecipeId() {
  return new URLSearchParams(window.location.search).get("id");
}

async function load() {
  const id = getRecipeId();
  if (!id) {
    document.getElementById("content").innerHTML = `<div class="empty-state">No recipe specified.</div>`;
    setStatus("Connected to Supabase");
    return;
  }

  try {
    setStatus("Loading…");
    const rows = await supabaseRequest("recipes", {
      query: `?select=id,user_id,name,description,servings,cooking_time_minutes,instructions,image_url,is_public&id=eq.${id}&limit=1`
    });

    if (!rows.length) {
      document.getElementById("content").innerHTML = `<div class="empty-state">Recipe not found, or you don't have access to it.</div>`;
      setStatus("Connected to Supabase");
      return;
    }

    const r = rows[0];
    const ingredientRows = await supabaseRequest("recipe_ingredients", {
      query: `?select=ingredient_id,quantity,unit,notes,sort_order,ingredients(id,name,category)&recipe_id=eq.${id}&order=sort_order.asc`
    });

    recipe = {
      id: r.id, userId: r.user_id, name: r.name, description: r.description || "",
      baseServings: r.servings || 2, time: r.cooking_time_minutes || 0,
      instructions: r.instructions || "", imageUrl: r.image_url || "", isPublic: r.is_public,
      ingredients: ingredientRows.map(ri => ({
        name: ri.ingredients?.name || "(deleted ingredient)",
        unit: ri.unit || "",
        quantity: ri.quantity
      }))
    };

    render();
    setStatus("Connected to Supabase");
  } catch (error) {
    console.error(error);
    setStatus("Database connection failed");
    document.getElementById("content").innerHTML = `<div class="empty-state">Couldn't load this recipe. Check the browser console for details.</div>`;
  }
}

function render() {
  const isMine = recipe.userId === window.currentUserId;

  document.getElementById("content").innerHTML = `
    ${recipe.imageUrl ? `<img class="hero-img" src="${esc(recipe.imageUrl)}" alt="" onerror="this.style.display='none'">` : ""}

    <div class="rv-header">
      <h1>${esc(recipe.name)}</h1>
      ${recipe.description ? `<p class="rv-description">${esc(recipe.description)}</p>` : ""}
      <div class="rv-meta">
        <span>${recipe.time ? recipe.time + " mins" : "No time set"}</span>
        <span>${recipe.ingredients.length} ingredient${recipe.ingredients.length === 1 ? "" : "s"}</span>
        ${recipe.isPublic ? `<span class="rv-badge">${isMine ? "Published to library" : "From the shared library"}</span>` : ""}
      </div>
      <div class="rv-actions">
        ${isMine
          ? `<a class="btn" href="recipes.html">Edit on Recipes page</a>`
          : `<button class="btn primary" onclick="cloneRecipe()">＋ Add to my recipes</button>`
        }
        <button class="btn" id="cookModeBtn" onclick="toggleCookMode()">👨‍🍳 Cook mode</button>
      </div>
    </div>

    <div class="rv-columns" id="normalView">
      <div class="card rv-card">
        <div class="servings-row">
          <label style="font-size:12px; font-weight:600;">Servings</label>
          <input id="servingsInput" type="number" min="1" value="${recipe.baseServings}" oninput="renderIngredients()">
        </div>
        <ul class="ing-list" id="ingList"></ul>
      </div>
      <div class="card rv-card">
        <h3 style="margin-top:0;">Instructions</h3>
        <div class="instructions">${renderInstructions(recipe.instructions)}</div>
      </div>
    </div>

    <div class="cook-mode" id="cookMode">
      <div class="card">
        <div class="cook-step-count" id="cookStepCount"></div>
        <div class="cook-step-text" id="cookStepText"></div>
        <div class="cook-nav">
          <button class="btn" id="cookPrevBtn" onclick="cookStep(-1)">← Back</button>
          <button class="btn" id="cookNextBtn" onclick="cookStep(1)">Next →</button>
        </div>
      </div>
    </div>
  `;

  renderIngredients();
}

function renderInstructions(text) {
  const steps = text.split("\n").map(s => s.trim()).filter(Boolean);
  if (steps.length <= 1) return esc(text || "No instructions added.");
  return `<ol>${steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>`;
}

function renderIngredients() {
  const servings = Number(document.getElementById("servingsInput").value) || recipe.baseServings;
  const multiplier = servings / recipe.baseServings;

  document.getElementById("ingList").innerHTML = recipe.ingredients.map((ing, i) => {
    const scaled = ing.quantity !== null ? Math.round(ing.quantity * multiplier * 100) / 100 : null;
    const key = `${i}`;
    return `
      <li class="${checkedIngredients.has(key) ? "checked" : ""}">
        <input type="checkbox" ${checkedIngredients.has(key) ? "checked" : ""} onchange="toggleIngredient('${key}', this)">
        <span class="ing-qty">${scaled !== null ? esc(String(scaled)) + " " + esc(ing.unit) : ""}</span>
        <span>${esc(ing.name)}</span>
      </li>
    `;
  }).join("") || `<li class="empty-state">No ingredients listed.</li>`;
}

function toggleIngredient(key, checkbox) {
  if (checkbox.checked) checkedIngredients.add(key); else checkedIngredients.delete(key);
  checkbox.closest("li").classList.toggle("checked", checkbox.checked);
}

// ---------- Cook mode ----------

function getCookSteps() {
  return recipe.instructions.split("\n").map(s => s.trim()).filter(Boolean);
}

function toggleCookMode() {
  const cookEl = document.getElementById("cookMode");
  const normalEl = document.getElementById("normalView");
  const isActive = cookEl.classList.toggle("active");
  normalEl.style.display = isActive ? "none" : "grid";
  document.getElementById("cookModeBtn").textContent = isActive ? "📋 Normal view" : "👨‍🍳 Cook mode";
  if (isActive) { cookStepIndex = 0; renderCookStep(); }
}

function renderCookStep() {
  const steps = getCookSteps();
  if (!steps.length) {
    document.getElementById("cookStepText").textContent = "No instructions added for this recipe yet.";
    document.getElementById("cookStepCount").textContent = "";
    document.getElementById("cookPrevBtn").disabled = true;
    document.getElementById("cookNextBtn").disabled = true;
    return;
  }
  document.getElementById("cookStepCount").textContent = `Step ${cookStepIndex + 1} of ${steps.length}`;
  document.getElementById("cookStepText").textContent = steps[cookStepIndex];
  document.getElementById("cookPrevBtn").disabled = cookStepIndex === 0;
  document.getElementById("cookNextBtn").disabled = cookStepIndex === steps.length - 1;
}

function cookStep(delta) {
  const steps = getCookSteps();
  cookStepIndex = Math.max(0, Math.min(steps.length - 1, cookStepIndex + delta));
  renderCookStep();
}

// ---------- Clone to own recipes ----------

async function cloneRecipe() {
  if (!confirm(`Add "${recipe.name}" to your own recipes? You'll get your own editable copy.`)) return;

  try {
    const created = (await supabaseRequest("recipes", {
      method: "POST",
      body: {
        name: recipe.name, description: recipe.description || null, servings: recipe.baseServings,
        cooking_time_minutes: recipe.time || null, instructions: recipe.instructions || null,
        image_url: recipe.imageUrl || null, user_id: window.currentUserId, is_public: false
      }
    }))[0];

    if (recipe.ingredients.length) {
      // Need ingredient_ids again — refetch since the display-only list above stripped them.
      const fullRows = await supabaseRequest("recipe_ingredients", {
        query: `?select=ingredient_id,quantity,unit,notes,sort_order&recipe_id=eq.${recipe.id}&order=sort_order.asc`
      });
      const rows = fullRows.map((ri, i) => ({
        recipe_id: created.id, ingredient_id: ri.ingredient_id,
        quantity: ri.quantity, unit: ri.unit, notes: ri.notes, sort_order: i
      }));
      await supabaseRequest("recipe_ingredients", { method: "POST", body: rows });
    }

    alert(`"${recipe.name}" is now in your own recipes.`);
    window.location.href = "recipes.html";
  } catch (error) {
    console.error(error);
    alert("Couldn't add that recipe. Check the browser console for details.");
  }
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await load();
})();
