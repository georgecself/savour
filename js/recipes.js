// recipes.js — recipe database + editor for Savour.
// Key design decision: ingredients are only ever added to a recipe by picking
// them from the global ingredients list via the autocomplete. That means a
// row either has a real ingredient_id attached, or it doesn't — there is no
// "look the name up in Supabase and hope it matches" step at save time.
// That async lookup-during-save was what caused the old bug where saving
// could wipe out a recipe's ingredients if one row failed to match.

const state = {
  ingredients: [],   // full global ingredient list, loaded once
  recipes: [],        // recipes with resolved ingredient rows
  editingRecipeId: null,
  rowCounter: 0,
  activeSuggestionRow: null
};

const els = {
  grid: document.getElementById("recipeGrid"),
  search: document.getElementById("recipeSearch"),
  modal: document.getElementById("modal"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  status: document.getElementById("status")
};

function setStatus(message) {
  els.status.textContent = message;
}

// ---------- Loading ----------

async function loadIngredients() {
  state.ingredients = await supabaseRequest("ingredients", {
    query: "?select=id,name,category,default_unit&order=name.asc"
  });
}

async function loadRecipes() {
  const recipes = await supabaseRequest("recipes", {
    query: `?select=id,name,description,servings,cooking_time_minutes,instructions&user_id=eq.${window.currentUserId}&order=name.asc`
  });

  const recipeIds = recipes.map(r => r.id);
  let recipeIngredients = [];
  if (recipeIds.length) {
    const encoded = recipeIds.map(id => `"${id}"`).join(",");
    recipeIngredients = await supabaseRequest("recipe_ingredients", {
      query: `?select=id,recipe_id,ingredient_id,quantity,unit,notes,sort_order,ingredients(id,name,category)&recipe_id=in.(${encoded})&order=sort_order.asc`
    });
  }

  state.recipes = recipes.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description || "",
    servings: r.servings || 2,
    time: r.cooking_time_minutes || 30,
    instructions: r.instructions || "",
    ingredients: recipeIngredients
      .filter(ri => ri.recipe_id === r.id)
      .map(ri => ({
        ingredientId: ri.ingredient_id,
        name: ri.ingredients?.name || "(unknown ingredient)",
        category: ri.ingredients?.category || "Other",
        quantity: ri.quantity,
        unit: ri.unit || "",
        notes: ri.notes || ""
      }))
  }));
}

async function loadAll() {
  try {
    setStatus("Loading…");
    await Promise.all([loadIngredients(), loadRecipes()]);
    renderRecipeList();
    setStatus("Connected to Supabase");
  } catch (error) {
    console.error(error);
    setStatus("Database connection failed");
    els.grid.innerHTML = `<div class="empty-state">Couldn't load recipes. Check the browser console for details.</div>`;
  }
}

// ---------- Recipe list ----------

function renderRecipeList() {
  const term = els.search.value.trim().toLowerCase();
  const filtered = state.recipes.filter(r => r.name.toLowerCase().includes(term));

  if (!filtered.length) {
    els.grid.innerHTML = `<div class="empty-state">${term ? "No recipes match your search." : "No recipes yet — add your first one."}</div>`;
    return;
  }

  els.grid.innerHTML = filtered.map(r => `
    <div class="card recipe-card">
      <h3>${esc(r.name)}</h3>
      <div class="meta">Serves ${r.servings} · ${r.time} mins · ${r.ingredients.length} ingredient${r.ingredients.length === 1 ? "" : "s"}</div>
      <ul>
        ${r.ingredients.slice(0, 5).map(i => `<li>${i.quantity ? esc(String(i.quantity)) + " " : ""}${esc(i.unit)} ${esc(i.name)}</li>`).join("")}
        ${r.ingredients.length > 5 ? "<li>…</li>" : ""}
      </ul>
      <div class="recipe-actions">
        <button class="btn" onclick="openRecipeModal('${r.id}')">Edit</button>
        <button class="btn danger" onclick="deleteRecipe('${r.id}')">Delete</button>
      </div>
    </div>
  `).join("");
}

async function deleteRecipe(id) {
  if (!confirm("Delete this recipe? This can't be undone.")) return;
  try {
    await supabaseRequest("recipes", { method: "DELETE", query: `?id=eq.${id}`, prefer: "return=minimal" });
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't delete the recipe. Check the browser console for details.");
  }
}

// ---------- Recipe editor modal ----------

function openRecipeModal(id = null) {
  state.editingRecipeId = id;
  const recipe = id ? state.recipes.find(r => r.id === id) : null;

  els.modal.innerHTML = `
    <h2>${recipe ? "Edit recipe" : "Add recipe"}</h2>
    <div class="form-grid">
      <div class="field full">
        <label>Name</label>
        <input id="rName" value="${recipe ? esc(recipe.name) : ""}" placeholder="e.g. Chilli con carne">
      </div>
      <div class="field full">
        <label>Description</label>
        <input id="rDescription" value="${recipe ? esc(recipe.description) : ""}" placeholder="Optional short description">
      </div>
      <div class="field">
        <label>Servings</label>
        <input id="rServings" type="number" min="1" value="${recipe ? recipe.servings : 2}">
      </div>
      <div class="field">
        <label>Cooking time (minutes)</label>
        <input id="rTime" type="number" min="1" value="${recipe ? recipe.time : 30}">
      </div>
    </div>

    <div class="field full">
      <label>Ingredients</label>
      <div id="ingRows" class="ing-rows"></div>
      <button type="button" class="btn add-row-btn" onclick="addIngredientRow()">＋ Add ingredient</button>
      <p class="meta" style="margin-top:8px;">Type to search the global ingredient list and pick a match. Ingredients not yet in the database need to be added via the Ingredients page first.</p>
    </div>

    <div class="field full">
      <label>Instructions</label>
      <textarea id="rInstructions" placeholder="Step-by-step method">${recipe ? esc(recipe.instructions) : ""}</textarea>
    </div>

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveRecipe()">Save recipe</button>
    </div>
  `;

  document.getElementById("ingRows").innerHTML = "";
  if (recipe && recipe.ingredients.length) {
    recipe.ingredients.forEach(ing => addIngredientRow(ing));
  } else {
    addIngredientRow();
  }

  els.modalBackdrop.classList.add("open");
}

function closeModal() {
  els.modalBackdrop.classList.remove("open");
  hideSuggestions();
}

// ---------- Ingredient rows (autocomplete) ----------

function addIngredientRow(prefill = null) {
  const rowKey = `row${state.rowCounter++}`;
  const container = document.getElementById("ingRows");

  const row = document.createElement("div");
  row.className = "ing-row";
  row.dataset.key = rowKey;
  row.dataset.ingredientId = prefill ? prefill.ingredientId : "";

  row.innerHTML = `
    <input type="number" step="any" min="0" class="row-qty" placeholder="Qty"
      value="${prefill && prefill.quantity !== null && prefill.quantity !== undefined ? prefill.quantity : ""}">
    <input type="text" class="row-name" placeholder="Search ingredients…"
      value="${prefill ? esc(prefill.name) : ""}"
      autocomplete="off"
      oninput="onIngredientInput('${rowKey}')"
      onfocus="onIngredientInput('${rowKey}')"
      onblur="setTimeout(()=>hideSuggestions(), 150)">
    <input type="text" class="row-unit" placeholder="Unit"
      value="${prefill ? esc(prefill.unit) : ""}">
    <button type="button" class="ing-remove" onclick="removeIngredientRow('${rowKey}')">×</button>
  `;

  container.appendChild(row);
}

function removeIngredientRow(rowKey) {
  const row = document.querySelector(`.ing-row[data-key="${rowKey}"]`);
  if (row) row.remove();
}

function onIngredientInput(rowKey) {
  const row = document.querySelector(`.ing-row[data-key="${rowKey}"]`);
  if (!row) return;

  // Any manual edit invalidates a previously-selected ingredient — the user
  // must re-pick from the list, so a mismatched id/name pair can never be saved.
  row.dataset.ingredientId = "";
  row.querySelector(".row-name").classList.remove("invalid");

  const term = row.querySelector(".row-name").value.trim().toLowerCase();
  if (!term) { hideSuggestions(); return; }

  const matches = state.ingredients
    .filter(i => i.name.toLowerCase().includes(term))
    .slice(0, 8);

  showSuggestions(row, matches);
}

function showSuggestions(row, matches) {
  hideSuggestions();
  const box = document.createElement("div");
  box.className = "ing-suggestions";
  box.id = "activeSuggestions";

  box.innerHTML = matches.length
    ? matches.map(m => `<div data-id="${m.id}" data-name="${esc(m.name)}" data-unit="${esc(m.default_unit || "")}">${esc(m.name)} <span style="color:var(--muted)">· ${esc(m.category)}</span></div>`).join("")
    : `<div class="no-match">No matching ingredient — add it on the Ingredients page first.</div>`;

  box.querySelectorAll("div[data-id]").forEach(el => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault(); // fires before the input's blur
      selectSuggestion(row, el.dataset.id, el.dataset.name, el.dataset.unit);
    });
  });

  row.appendChild(box);
}

function hideSuggestions() {
  const existing = document.getElementById("activeSuggestions");
  if (existing) existing.remove();
}

function selectSuggestion(row, id, name, defaultUnit) {
  row.dataset.ingredientId = id;
  row.querySelector(".row-name").value = name;
  row.querySelector(".row-name").classList.remove("invalid");
  const unitInput = row.querySelector(".row-unit");
  if (!unitInput.value.trim() && defaultUnit) unitInput.value = defaultUnit;
  hideSuggestions();
}

// ---------- Validation (runs before ANY database write) ----------

function collectAndValidateRows() {
  const rowEls = document.querySelectorAll(".ing-row");
  const rows = [];
  const errors = [];

  rowEls.forEach((row, index) => {
    const name = row.querySelector(".row-name").value.trim();
    const qtyRaw = row.querySelector(".row-qty").value;
    const unit = row.querySelector(".row-unit").value.trim();
    const ingredientId = row.dataset.ingredientId;

    // Fully empty row — skip silently, it just won't be saved.
    if (!name && !qtyRaw && !unit) return;

    if (!ingredientId) {
      row.querySelector(".row-name").classList.add("invalid");
      errors.push(`Row ${index + 1}: "${name || "(blank)"}" hasn't been picked from the ingredient list.`);
      return;
    }

    rows.push({
      ingredient_id: ingredientId,
      quantity: qtyRaw === "" ? null : Number(qtyRaw),
      unit: unit || null,
      notes: null,
      sort_order: rows.length
    });
  });

  return { valid: errors.length === 0, rows, errors };
}

// ---------- Save (all-or-nothing) ----------

async function saveRecipe() {
  const name = document.getElementById("rName").value.trim();
  if (!name) { alert("Please give the recipe a name."); return; }

  const servings = Number(document.getElementById("rServings").value) || 1;
  const time = Number(document.getElementById("rTime").value) || 0;
  const description = document.getElementById("rDescription").value.trim();
  const instructions = document.getElementById("rInstructions").value.trim();

  // Validate every ingredient row BEFORE any Supabase call is made.
  const { valid, rows, errors } = collectAndValidateRows();
  if (!valid) {
    alert("Please fix the following before saving:\n\n" + errors.join("\n"));
    return; // Nothing has touched the database yet.
  }
  if (!rows.length) {
    if (!confirm("This recipe has no ingredients. Save anyway?")) return;
  }

  const saveBtn = document.querySelector(".modal-actions .primary");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    const recipePayload = {
      name, description: description || null, servings,
      cooking_time_minutes: time, instructions: instructions || null
    };

    if (state.editingRecipeId) {
      const id = state.editingRecipeId;
      // Ingredients are already fully validated real IDs at this point, so
      // this delete+insert pair can only fail on a network/server error —
      // not on a bad ingredient match, which was the original bug.
      await supabaseRequest("recipes", { method: "PATCH", query: `?id=eq.${id}`, body: recipePayload });
      await supabaseRequest("recipe_ingredients", { method: "DELETE", query: `?recipe_id=eq.${id}`, prefer: "return=minimal" });
      if (rows.length) {
        await supabaseRequest("recipe_ingredients", { method: "POST", body: rows.map(r => ({ ...r, recipe_id: id })) });
      }
    } else {
      const created = (await supabaseRequest("recipes", { method: "POST", body: { ...recipePayload, user_id: window.currentUserId } }))[0];
      if (rows.length) {
        try {
          await supabaseRequest("recipe_ingredients", { method: "POST", body: rows.map(r => ({ ...r, recipe_id: created.id })) });
        } catch (ingredientError) {
          // Roll back the orphaned recipe row rather than leaving it stranded.
          await supabaseRequest("recipes", { method: "DELETE", query: `?id=eq.${created.id}`, prefer: "return=minimal" });
          throw ingredientError;
        }
      }
    }

    closeModal();
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't save the recipe: " + (error.message || "unknown error") + "\nCheck the browser console for details.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save recipe";
  }
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadAll();
})();
