// recipes.js — recipe database + editor for Savour.
// Key design decision: ingredients are only ever added to a recipe by picking
// them from the global ingredients list via the autocomplete. That means a
// row either has a real ingredient_id attached, or it doesn't — there is no
// "look the name up in Supabase and hope it matches" step at save time.
// That async lookup-during-save was what caused the old bug where saving
// could wipe out a recipe's ingredients if one row failed to match.

const state = {
  ingredients: [],   // full global ingredient list, loaded once
  myRecipes: [],
  libraryRecipes: [],
  activeTab: "mine",
  editingRecipeId: null,
  rowCounter: 0,
  activeSuggestionRow: null
};

const ADMIN_USER_ID = "37926109-b428-45fc-8771-72e16390a649";

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

function coverPlaceholderSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="13" cy="13" r="12" stroke="#4B5D32" stroke-width="1.5"/>
    <path d="M8 14c0-3 2.2-6 5-6s5 3 5 6-2.2 4-5 4-5-1-5-4Z" fill="#4B5D32"/>
  </svg>`;
}

// ---------- Loading ----------

async function loadRecipesMatching(query) {
  const recipes = await supabaseRequest("recipes", {
    query: `?select=id,user_id,name,description,servings,cooking_time_minutes,instructions,image_url,is_public&${query}&order=name.asc`
  });

  const recipeIds = recipes.map(r => r.id);
  let recipeIngredients = [];
  if (recipeIds.length) {
    const encoded = recipeIds.map(id => `"${id}"`).join(",");
    recipeIngredients = await supabaseRequest("recipe_ingredients", {
      query: `?select=id,recipe_id,ingredient_id,quantity,unit,notes,sort_order,ingredients(id,name,category)&recipe_id=in.(${encoded})&order=sort_order.asc`
    });
  }

  return recipes.map(r => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    description: r.description || "",
    servings: r.servings || 2,
    time: r.cooking_time_minutes || 30,
    instructions: r.instructions || "",
    imageUrl: r.image_url || "",
        isPublic: r.is_public,
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
    state.ingredients = await supabaseRequest("ingredients", { query: "?select=id,name,category,default_unit&order=name.asc" });

    const [mine, library] = await Promise.all([
      loadRecipesMatching(`user_id=eq.${window.currentUserId}`),
      loadRecipesMatching(`is_public=eq.true`)
    ]);
    state.myRecipes = mine;
    state.libraryRecipes = library;

    if (window.currentUserId === ADMIN_USER_ID) {
      const importLink = document.getElementById("importLink");
      if (importLink) importLink.style.display = "inline-block";
    }

    renderRecipeList();
    setStatus("Connected to Supabase");
  } catch (error) {
    console.error(error);
    setStatus("Database connection failed");
    els.grid.innerHTML = `<div class="empty-state">Couldn't load recipes. Check the browser console for details.</div>`;
  }
}

function switchTab(tab) {
  state.activeTab = tab;
  document.getElementById("tabMine").classList.toggle("active", tab === "mine");
  document.getElementById("tabLibrary").classList.toggle("active", tab === "library");
  renderRecipeList();
}

// ---------- Recipe list ----------

function renderRecipeList() {
  const term = els.search.value.trim().toLowerCase();
  const source = state.activeTab === "library" ? state.libraryRecipes : state.myRecipes;
  const filtered = source.filter(r => r.name.toLowerCase().includes(term));

  if (!filtered.length) {
    const emptyMsg = state.activeTab === "library"
      ? (term ? "No library recipes match your search." : "No shared recipes yet.")
      : (term ? "No recipes match your search." : "No recipes yet — add your first one.");
    els.grid.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
    return;
  }

  els.grid.innerHTML = filtered.map(r => {
    const isMine = r.userId === window.currentUserId;
    const cover = r.imageUrl
      ? `<img class="recipe-card-img" src="${esc(r.imageUrl)}" alt="" onerror="this.parentElement.innerHTML=coverPlaceholderSvg(130)">`
      : `<div class="recipe-card-img cover-placeholder" style="height:130px;">${coverPlaceholderSvg(36)}</div>`;
    return `
    <div class="card recipe-card">
      ${cover}
      <div class="recipe-card-body">
        ${state.activeTab === "library" ? `<div class="owner-badge">${isMine ? "Yours · published" : "Shared"}</div>` : ""}
        <h3>${esc(r.name)}</h3>
        <div class="meta">Serves ${r.servings} · ${r.time} mins · ${r.ingredients.length} ingredient${r.ingredients.length === 1 ? "" : "s"}</div>
        <ul>
          ${r.ingredients.slice(0, 5).map(i => `<li>${i.quantity ? esc(String(i.quantity)) + " " : ""}${esc(i.unit)} ${esc(i.name)}</li>`).join("")}
          ${r.ingredients.length > 5 ? "<li>…</li>" : ""}
        </ul>
        <div class="recipe-actions">
          <a class="btn" href="recipe-view.html?id=${r.id}">View</a>
          ${isMine
            ? `<button class="btn" onclick="openRecipeModal('${r.id}')">Edit</button><button class="btn danger" onclick="deleteRecipe('${r.id}')">Delete</button>`
            : `<button class="btn primary" onclick="cloneRecipe('${r.id}')">＋ Add to my recipes</button>`
          }
        </div>
      </div>
    </div>
  `;
  }).join("");
}

async function cloneRecipe(id) {
  const source = state.libraryRecipes.find(r => r.id === id);
  if (!source) return;
  if (!confirm(`Add "${source.name}" to your own recipes? You'll get your own editable copy.`)) return;

  try {
    const created = (await supabaseRequest("recipes", {
      method: "POST",
      body: {
        name: source.name, description: source.description || null, servings: source.servings,
        cooking_time_minutes: source.time, instructions: source.instructions || null,
        image_url: source.imageUrl || null, user_id: window.currentUserId, is_public: false
      }
    }))[0];

    if (source.ingredients.length) {
      const rows = source.ingredients.map((ing, i) => ({
        recipe_id: created.id, ingredient_id: ing.ingredientId,
        quantity: ing.quantity, unit: ing.unit || null, notes: ing.notes || null, sort_order: i
      }));
      await supabaseRequest("recipe_ingredients", { method: "POST", body: rows });
    }

    await loadAll();
    switchTab("mine");
    alert(`"${source.name}" is now in your own recipes — feel free to edit your copy.`);
  } catch (error) {
    console.error(error);
    alert("Couldn't add that recipe. Check the browser console for details.");
  }
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
  const recipe = id ? state.myRecipes.find(r => r.id === id) : null;

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
      <div class="field full">
        <label>Photo URL</label>
        <input id="rImageUrl" value="${recipe ? esc(recipe.imageUrl) : ""}" placeholder="Optional — link to an image already online">
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
  const imageUrl = document.getElementById("rImageUrl").value.trim();
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
      cooking_time_minutes: time, instructions: instructions || null, image_url: imageUrl || null
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
