const state = {
  ingredients: [],
  foods: [],
  pantryItems: [], // resolved: {id, type, refId, name, category, quantity, unit}
  addType: "ingredient",
  pendingSelection: null // { id, name, category, defaultUnit } while adding
};

const els = {
  table: document.getElementById("pantryTable"),
  search: document.getElementById("searchInput"),
  modal: document.getElementById("modal"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  add: document.getElementById("addPantryBtn")
};

const ROW_ICONS = {
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  remove: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>`
};

// ---------- Loading ----------

async function loadAll() {
  try {
    setShellStatus(undefined, "Loading…");

    const [ingredients, foods, rawPantry] = await Promise.all([
      supabaseRequest("ingredients", { query: "?select=id,name,category,default_unit&order=name.asc" }),
      supabaseRequest("foods", { query: `?select=id,name,brand,serving_unit,shopping_category&user_id=eq.${window.currentUserId}&order=name.asc` }),
      supabaseRequest("pantry_items", { query: `?select=id,ingredient_id,food_id,quantity,unit&user_id=eq.${window.currentUserId}&order=created_at.asc` })
    ]);

    state.ingredients = ingredients;
    state.foods = foods;

    state.pantryItems = rawPantry.map(p => {
      if (p.ingredient_id) {
        const ing = ingredients.find(i => i.id === p.ingredient_id);
        return { id: p.id, type: "ingredient", refId: p.ingredient_id, name: ing ? ing.name : "(deleted ingredient)", category: ing ? ing.category : "Other", quantity: p.quantity, unit: p.unit };
      } else if (p.food_id) {
        const food = foods.find(f => f.id === p.food_id);
        return { id: p.id, type: "food", refId: p.food_id, name: food ? food.name : "(deleted food)", category: food ? food.shopping_category : "Other", quantity: p.quantity, unit: p.unit };
      }
      return null;
    }).filter(Boolean);

    renderTable();
    setShellStatus("ok", "Connected to Supabase");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
    els.table.innerHTML = `<div class="empty-state">Couldn't load the pantry. Check the browser console for details.</div>`;
  }
}

// ---------- Table ----------

function renderTable() {
  const term = els.search.value.trim().toLowerCase();
  const filtered = state.pantryItems.filter(p => p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term));

  if (!filtered.length) {
    els.table.innerHTML = `<div class="empty-state">${term ? "No pantry items match your search." : "Your pantry is empty — add what you've already got."}</div>`;
    return;
  }

  els.table.innerHTML = `
    <table class="pantry-table">
      <thead><tr><th>Item</th><th>Category</th><th>Quantity</th><th></th></tr></thead>
      <tbody>
        ${filtered.map(p => `
          <tr>
            <td>${esc(p.name)}</td>
            <td>${esc(p.category)}</td>
            <td class="num">${p.quantity !== null && p.quantity !== undefined ? esc(String(p.quantity)) + " " + esc(p.unit || "") : (p.unit ? esc(p.unit) : "some")}</td>
            <td>
              <div class="row-actions">
                <button class="row-icon-btn" onclick="openEditModal('${p.id}')" title="Edit" aria-label="Edit">${ROW_ICONS.edit}</button>
                <button class="row-icon-btn danger" onclick="deletePantryItem('${p.id}')" title="Remove" aria-label="Remove">${ROW_ICONS.remove}</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

// ---------- Add flow: pick item, THEN set quantity, THEN confirm ----------

function openAddModal() {
  state.addType = "ingredient";
  state.pendingSelection = null;
  renderAddModal();
  els.modalBackdrop.classList.add("open");
}

function renderAddModal() {
  if (!state.pendingSelection) {
    els.modal.innerHTML = `
      <h2>Add to pantry</h2>
      <p class="meta">Pick what you've got — you'll set the quantity next.</p>
      <div class="type-toggle">
        <button type="button" class="type-btn ${state.addType === "ingredient" ? "active" : ""}" onclick="switchAddType('ingredient')">Ingredient</button>
        <button type="button" class="type-btn ${state.addType === "food" ? "active" : ""}" onclick="switchAddType('food')">Food</button>
      </div>
      <div class="field">
        <label>Search</label>
        <input id="pickSearch" placeholder="Type to search…" oninput="renderPickOptions()">
      </div>
      <div id="pickOptions" class="pick-options"></div>
      <div class="modal-actions"><button class="btn" onclick="closeModal()">Cancel</button></div>
    `;
    renderPickOptions();
  } else {
    const sel = state.pendingSelection;
    els.modal.innerHTML = `
      <h2>Add to pantry</h2>
      <div class="selection-banner">
        <span>${esc(sel.name)}</span>
        <button onclick="backToPicker()">Change</button>
      </div>
      <div class="qty-unit-row">
        <div class="field"><label>Quantity (optional)</label><input id="pantryQty" type="number" step="any" min="0" placeholder="e.g. 500"></div>
        <div class="field"><label>Unit</label><input id="pantryUnit" value="${esc(sel.defaultUnit || "")}" placeholder="e.g. g"></div>
      </div>
      <p class="meta">If you already have this item logged with the same unit, this will add to the existing amount rather than duplicating it.</p>
      <div class="modal-actions">
        <button class="btn" onclick="backToPicker()">Back</button>
        <button class="btn primary" onclick="confirmAddPantry()">Add to pantry</button>
      </div>
    `;
  }
}

function switchAddType(type) {
  state.addType = type;
  state.pendingSelection = null;
  renderAddModal();
}

function renderPickOptions() {
  const term = document.getElementById("pickSearch").value.trim().toLowerCase();
  const source = state.addType === "ingredient" ? state.ingredients : state.foods;
  const filtered = source.filter(x => x.name.toLowerCase().includes(term));
  const box = document.getElementById("pickOptions");

  if (!filtered.length) {
    box.innerHTML = `<div class="empty-state">${source.length ? "No matches." : `No ${state.addType}s yet.`}</div>`;
    return;
  }

  box.innerHTML = filtered.map(x => `
    <div class="pick-option" onclick="selectPickItem('${x.id}')">
      <div>${esc(x.name)}</div>
      <div class="sub">${state.addType === "ingredient" ? esc(x.category) : esc(x.brand || x.shopping_category || "")}</div>
    </div>
  `).join("");
}

function selectPickItem(id) {
  const source = state.addType === "ingredient" ? state.ingredients : state.foods;
  const item = source.find(x => x.id === id);
  if (!item) return;

  state.pendingSelection = {
    id: item.id,
    name: item.name,
    defaultUnit: state.addType === "ingredient" ? item.default_unit : item.serving_unit
  };
  renderAddModal();
}

function backToPicker() {
  state.pendingSelection = null;
  renderAddModal();
}

async function confirmAddPantry() {
  const qtyRaw = document.getElementById("pantryQty").value;
  const unit = document.getElementById("pantryUnit").value.trim() || null;
  const quantity = qtyRaw === "" ? null : Number(qtyRaw);
  const sel = state.pendingSelection;

  try {
    // Restocking something already logged with the same unit adds to it
    // instead of creating a duplicate row.
    const existing = state.pantryItems.find(p =>
      p.type === state.addType && p.refId === sel.id && (p.unit || "") === (unit || "")
    );

    if (existing) {
      const merged = (existing.quantity === null && quantity === null)
        ? null
        : (Number(existing.quantity) || 0) + (Number(quantity) || 0);
      await supabaseRequest("pantry_items", {
        method: "PATCH", query: `?id=eq.${existing.id}`, body: { quantity: merged, unit }
      });
    } else {
      const body = { quantity, unit, user_id: window.currentUserId };
      if (state.addType === "ingredient") body.ingredient_id = sel.id; else body.food_id = sel.id;
      await supabaseRequest("pantry_items", { method: "POST", body });
    }

    closeModal();
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't add that to the pantry. Check the browser console for details.");
  }
}

// ---------- Edit (quantity/unit only) & delete ----------

function openEditModal(id) {
  const item = state.pantryItems.find(p => p.id === id);
  if (!item) return;

  els.modal.innerHTML = `
    <h2>Edit ${esc(item.name)}</h2>
    <p class="meta">To change the item itself, remove this and add a new one.</p>
    <div class="qty-unit-row">
      <div class="field"><label>Quantity</label><input id="editQty" type="number" step="any" min="0" value="${item.quantity ?? ""}"></div>
      <div class="field"><label>Unit</label><input id="editUnit" value="${esc(item.unit || "")}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="saveEditPantry('${id}')">Save</button>
    </div>
  `;
  els.modalBackdrop.classList.add("open");
}

async function saveEditPantry(id) {
  const qtyRaw = document.getElementById("editQty").value;
  const unit = document.getElementById("editUnit").value.trim() || null;
  const quantity = qtyRaw === "" ? null : Number(qtyRaw);

  try {
    await supabaseRequest("pantry_items", { method: "PATCH", query: `?id=eq.${id}`, body: { quantity, unit } });
    closeModal();
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't save that change. Check the browser console for details.");
  }
}

async function deletePantryItem(id) {
  const item = state.pantryItems.find(p => p.id === id);
  if (!item) return;
  if (!confirm(`Remove "${item.name}" from your pantry?`)) return;

  try {
    await supabaseRequest("pantry_items", { method: "DELETE", query: `?id=eq.${id}`, prefer: "return=minimal" });
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't remove that item. Check the browser console for details.");
  }
}

function closeModal() {
  els.modalBackdrop.classList.remove("open");
}

els.add.addEventListener("click", openAddModal);
els.search.addEventListener("input", renderTable);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadAll();
})();
