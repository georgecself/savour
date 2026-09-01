// foods.js — foods database + editor for Savour.
// Same conventions as recipes.js: cloned_from tracks lineage so "already
// added" state is real database fact, not session memory, and both the
// individual card button and "Add all new foods" read from the same place.

const state = {
  myFoods: [],
  libraryFoods: [],
  activeTab: "mine",
  editingFoodId: null
};

const ICONS = {
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  remove: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>`
};

const FOOD_SELECT = "id,user_id,name,brand,serving_size,serving_unit,calories,protein_g,carbohydrates_g,fat_g,price,shopping_category,cloned_from,is_public";

function getAddedLibraryIds() {
  return new Set(state.myFoods.map(f => f.clonedFrom).filter(Boolean));
}

// ---------- Loading ----------

async function loadFoodsMatching(query) {
  const rows = await supabaseRequest("foods", { query: `?select=${FOOD_SELECT}&${query}&order=name.asc` });
  return rows.map(f => ({
    id: f.id, userId: f.user_id, name: f.name, brand: f.brand || "",
    servingSize: f.serving_size, servingUnit: f.serving_unit || "",
    calories: f.calories, protein: f.protein_g, carbs: f.carbohydrates_g, fat: f.fat_g,
    price: f.price, category: f.shopping_category || "", clonedFrom: f.cloned_from || null, isPublic: f.is_public
  }));
}

async function loadAll() {
  try {
    setShellStatus(undefined, "Loading…");
    const [mine, library] = await Promise.all([
      loadFoodsMatching(`user_id=eq.${window.currentUserId}`),
      loadFoodsMatching(`is_public=eq.true`)
    ]);
    state.myFoods = mine;
    state.libraryFoods = library;

    if (window.currentUserId === ADMIN_USER_ID) {
      const importLink = document.getElementById("importLink");
      if (importLink) importLink.style.display = "flex";
    }

    renderCategoryFilterOptions();
    renderFoods();
    setShellStatus("ok", "Connected to Server");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
    document.getElementById("foodGrid").innerHTML = `<div class="empty-state">Couldn't load foods. Check the browser console for details.</div>`;
  }
}

function switchTab(tab) {
  state.activeTab = tab;
  document.getElementById("tabMine").classList.toggle("active", tab === "mine");
  document.getElementById("tabLibrary").classList.toggle("active", tab === "library");
  document.getElementById("addAllBtn").style.display = tab === "library" ? "flex" : "none";
  document.getElementById("createFoodBtn").style.display = tab === "mine" ? "flex" : "none";
  renderCategoryFilterOptions();
  renderFoods();
}

function renderCategoryFilterOptions() {
  const source = state.activeTab === "library" ? state.libraryFoods : state.myFoods;
  const present = [...new Set(source.map(f => f.category).filter(Boolean))].sort();
  const select = document.getElementById("categoryFilter");
  const current = select.value;
  select.innerHTML = `<option value="">All categories</option>` + present.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if (present.includes(current)) select.value = current;
}

// ---------- Card grid ----------

function renderFoods() {
  const term = document.getElementById("searchInput").value.trim().toLowerCase();
  const categoryValue = document.getElementById("categoryFilter").value;
  const source = state.activeTab === "library" ? state.libraryFoods : state.myFoods;
  const addedIds = getAddedLibraryIds();
  const filtered = source.filter(f =>
    f.name.toLowerCase().includes(term) &&
    (!categoryValue || f.category === categoryValue)
  );

  const grid = document.getElementById("foodGrid");

  if (!filtered.length) {
    const emptyMsg = state.activeTab === "library"
      ? (term || categoryValue ? "No library foods match." : "No shared foods yet.")
      : (term || categoryValue ? "No foods match." : "No foods yet — create your first one.");
    grid.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
    return;
  }

  grid.innerHTML = filtered.map(f => {
    const isMine = f.userId === window.currentUserId;

    const menu = isMine ? `
      <div class="item-menu-wrap">
        <button class="kebab-btn" onclick="toggleCardMenu(event, '${f.id}')" aria-label="Options">⋮</button>
        <div class="item-menu" id="menu-${f.id}">
          <button onclick="closeAllCardMenus(); openFoodModal('${f.id}')">${ICONS.edit} Edit</button>
          <button class="danger" onclick="closeAllCardMenus(); deleteFood('${f.id}')">${ICONS.remove} Delete</button>
        </div>
      </div>
    ` : "";

    const badges = [];
    if (state.activeTab === "library") badges.push(`<span class="owner-badge">${isMine ? "Yours · published" : "Shared"}</span>`);
    if (f.category) badges.push(`<span class="category-badge">${esc(f.category)}</span>`);

    const stats = [
      f.calories !== null && f.calories !== undefined ? { v: Math.round(f.calories), l: "kcal" } : null,
      f.protein !== null && f.protein !== undefined ? { v: `${Math.round(f.protein)}g`, l: "protein" } : null,
      f.carbs !== null && f.carbs !== undefined ? { v: `${Math.round(f.carbs)}g`, l: "carbs" } : null,
      f.fat !== null && f.fat !== undefined ? { v: `${Math.round(f.fat)}g`, l: "fat" } : null
    ].filter(Boolean);

    const statsHtml = stats.length
      ? `<div class="food-stats">${stats.map(s => `<div class="food-stat"><span class="food-stat-value">${esc(String(s.v))}</span><span class="food-stat-label">${s.l}</span></div>`).join("")}</div>`
      : `<div class="food-no-nutrition">No nutrition info added</div>`;

    const alreadyAdded = addedIds.has(f.id);
    const cta = !isMine
      ? (alreadyAdded
          ? `<button class="btn card-cta added" disabled>✓ Added</button>`
          : `<button class="btn primary card-cta" onclick="cloneFood('${f.id}')">Add to my foods</button>`)
      : "";

    return `
      <div class="card food-card">
        <div class="food-card-top">
          <div class="badge-row">${badges.join("")}</div>
          ${menu}
        </div>
        <h3>${esc(f.name)}</h3>
        ${f.brand ? `<div class="food-brand">${esc(f.brand)}</div>` : ""}
        ${f.servingSize ? `<div class="food-serving">Per ${esc(String(f.servingSize))}${esc(f.servingUnit)}</div>` : ""}
        ${statsHtml}
        <div class="food-card-bottom">
          ${f.price !== null && f.price !== undefined ? `<div class="food-price">£${Number(f.price).toFixed(2)}</div>` : `<div></div>`}
          ${cta}
        </div>
      </div>
    `;
  }).join("");
}

function toggleCardMenu(event, id) {
  event.stopPropagation();
  const menu = document.getElementById(`menu-${id}`);
  const wasOpen = menu.classList.contains("open");
  closeAllCardMenus();
  if (!wasOpen) menu.classList.add("open");
}

function closeAllCardMenus() {
  document.querySelectorAll(".item-menu.open").forEach(m => m.classList.remove("open"));
}

document.addEventListener("click", closeAllCardMenus);

// ---------- Clone (library -> mine) ----------

async function cloneFoodCore(source) {
  const created = (await supabaseRequest("foods", {
    method: "POST",
    body: {
      name: source.name, brand: source.brand || null, serving_size: source.servingSize,
      serving_unit: source.servingUnit || null, calories: source.calories, protein_g: source.protein,
      carbohydrates_g: source.carbs, fat_g: source.fat, price: source.price,
      shopping_category: source.category || null, cloned_from: source.id,
      user_id: window.currentUserId, is_public: false
    }
  }))[0];

  state.myFoods.push({
    id: created.id, userId: window.currentUserId, name: source.name, brand: source.brand,
    servingSize: source.servingSize, servingUnit: source.servingUnit, calories: source.calories,
    protein: source.protein, carbs: source.carbs, fat: source.fat, price: source.price,
    category: source.category, clonedFrom: source.id, isPublic: false
  });
}

async function cloneFood(id) {
  if (getAddedLibraryIds().has(id)) return;
  const source = state.libraryFoods.find(f => f.id === id);
  if (!source) return;

  try {
    await cloneFoodCore(source);
    renderCategoryFilterOptions();
    renderFoods();
  } catch (error) {
    console.error(error);
    alert("Couldn't add that food. Check the browser console for details.");
  }
}

async function addAllNewFoods() {
  const toAdd = state.libraryFoods.filter(f => f.userId !== window.currentUserId && !getAddedLibraryIds().has(f.id));
  if (!toAdd.length) {
    alert("Nothing new to add — your library is already up to date.");
    return;
  }
  if (!confirm(`Add all ${toAdd.length} new food${toAdd.length === 1 ? "" : "s"} to your own foods?`)) return;

  const btn = document.getElementById("addAllBtn");
  btn.disabled = true;
  let done = 0, failed = 0;

  for (const food of toAdd) {
    try {
      await cloneFoodCore(food);
      done++;
    } catch (error) {
      console.error(error);
      failed++;
    }
  }

  btn.disabled = false;
  renderCategoryFilterOptions();
  renderFoods();
  alert(`Added ${done} food${done === 1 ? "" : "s"}.${failed ? ` ${failed} failed — check the browser console.` : ""}`);
}

async function deleteFood(id) {
  if (!confirm("Delete this food? This can't be undone.")) return;
  try {
    await supabaseRequest("foods", { method: "DELETE", query: `?id=eq.${id}`, prefer: "return=minimal" });
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't delete the food. Check the browser console for details.");
  }
}

// ---------- Editor modal ----------

function openFoodModal(id = null) {
  state.editingFoodId = id;
  const food = id ? state.myFoods.find(f => f.id === id) : null;

  document.getElementById("modalTitle").textContent = food ? "Edit food" : "Add food";
  document.getElementById("foodName").value = food ? food.name : "";
  document.getElementById("foodBrand").value = food ? food.brand : "";
  document.getElementById("foodCategory").value = food && food.category ? food.category : "Other";
  document.getElementById("foodServingSize").value = food && food.servingSize !== null ? food.servingSize : "";
  document.getElementById("foodServingUnit").value = food ? food.servingUnit : "";
  document.getElementById("foodCalories").value = food && food.calories !== null && food.calories !== undefined ? food.calories : "";
  document.getElementById("foodProtein").value = food && food.protein !== null && food.protein !== undefined ? food.protein : "";
  document.getElementById("foodCarbs").value = food && food.carbs !== null && food.carbs !== undefined ? food.carbs : "";
  document.getElementById("foodFat").value = food && food.fat !== null && food.fat !== undefined ? food.fat : "";
  document.getElementById("foodPrice").value = food && food.price !== null && food.price !== undefined ? food.price : "";

  document.getElementById("modalBackdrop").classList.add("open");
}

function closeModal() {
  document.getElementById("modalBackdrop").classList.remove("open");
}

function numOrNull(value) {
  const trimmed = String(value).trim();
  return trimmed === "" ? null : Number(trimmed);
}

async function saveFood() {
  const name = document.getElementById("foodName").value.trim();
  if (!name) { alert("Please give the food a name."); return; }

  const payload = {
    name,
    brand: document.getElementById("foodBrand").value.trim() || null,
    shopping_category: document.getElementById("foodCategory").value || null,
    serving_size: numOrNull(document.getElementById("foodServingSize").value),
    serving_unit: document.getElementById("foodServingUnit").value.trim() || null,
    calories: numOrNull(document.getElementById("foodCalories").value),
    protein_g: numOrNull(document.getElementById("foodProtein").value),
    carbohydrates_g: numOrNull(document.getElementById("foodCarbs").value),
    fat_g: numOrNull(document.getElementById("foodFat").value),
    price: numOrNull(document.getElementById("foodPrice").value)
  };

  const saveBtn = document.querySelector(".modal-actions .primary");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    if (state.editingFoodId) {
      await supabaseRequest("foods", { method: "PATCH", query: `?id=eq.${state.editingFoodId}`, body: payload });
    } else {
      await supabaseRequest("foods", { method: "POST", body: { ...payload, user_id: window.currentUserId, is_public: false } });
    }
    closeModal();
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't save the food: " + (error.message || "unknown error") + "\nCheck the browser console for details.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save food";
  }
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return;
  await loadAll();

  const editId = new URLSearchParams(window.location.search).get("edit");
  if (editId && state.myFoods.some(f => f.id === editId)) {
    openFoodModal(editId);
  }
})();
