const state = {
  ingredients: [],
  editingId: null
};

const els = {
  table: document.getElementById("ingredientTable"),
  search: document.getElementById("searchInput"),
  modal: document.getElementById("modalBackdrop"),
  modalTitle: document.getElementById("modalTitle"),
  name: document.getElementById("ingredientName"),
  category: document.getElementById("ingredientCategory"),
  unit: document.getElementById("ingredientUnit"),
  add: document.getElementById("addIngredientBtn"),
  cancel: document.getElementById("cancelBtn"),
  save: document.getElementById("saveBtn"),
  status: document.getElementById("status")
};

function setStatus(message) {
  els.status.textContent = message;
}

async function loadIngredients() {
  try {
    setStatus("Loading ingredients…");

    state.ingredients = await supabaseRequest("ingredients", {
      query: "?select=id,name,category,default_unit,created_at&order=name.asc"
    });

    renderIngredients();
    setStatus(`${state.ingredients.length} ingredients`);
  } catch (error) {
    console.error(error);
    setStatus("Connection failed");
    els.table.innerHTML = `
      <div class="empty-state">
        <strong>Couldn't load ingredients.</strong><br>
        Check the browser console for details.
      </div>`;
  }
}

function renderIngredients() {
  const term = els.search.value.trim().toLowerCase();

  const filtered = state.ingredients.filter(item =>
    item.name.toLowerCase().includes(term) ||
    item.category.toLowerCase().includes(term)
  );

  if (!filtered.length) {
    els.table.innerHTML = `
      <div class="empty-state">
        ${term ? "No ingredients match your search." : "No ingredients found."}
      </div>`;
    return;
  }

  els.table.innerHTML = `
    <table class="ingredient-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Category</th>
          <th>Default unit</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(item => `
          <tr>
            <td><strong>${esc(item.name)}</strong></td>
            <td>${esc(item.category)}</td>
            <td>${esc(item.default_unit || "—")}</td>
            <td>
              <div class="actions">
                <button class="btn" onclick="openEditIngredient('${item.id}')">Edit</button>
                <button class="btn danger" onclick="deleteIngredient('${item.id}')">Delete</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function openAddIngredient() {
  state.editingId = null;
  els.modalTitle.textContent = "Add ingredient";
  els.name.value = "";
  els.category.value = "Other";
  els.unit.value = "";
  els.modal.classList.add("open");
  setTimeout(() => els.name.focus(), 50);
}

function openEditIngredient(id) {
  const item = state.ingredients.find(x => x.id === id);
  if (!item) return;

  state.editingId = id;
  els.modalTitle.textContent = "Edit ingredient";
  els.name.value = item.name;
  els.category.value = item.category;
  els.unit.value = item.default_unit || "";
  els.modal.classList.add("open");
  setTimeout(() => els.name.focus(), 50);
}

function closeModal() {
  els.modal.classList.remove("open");
}

async function saveIngredient() {
  const name = els.name.value.trim();
  const category = els.category.value;
  const default_unit = els.unit.value || null;

  if (!name) {
    alert("Please enter an ingredient name.");
    return;
  }

  els.save.disabled = true;
  els.save.textContent = "Saving…";

  try {
    if (state.editingId) {
      await supabaseRequest("ingredients", {
        method: "PATCH",
        query: `?id=eq.${state.editingId}`,
        body: { name, category, default_unit }
      });
    } else {
      await supabaseRequest("ingredients", {
        method: "POST",
        body: { name, category, default_unit }
      });
    }

    closeModal();
    await loadIngredients();
  } catch (error) {
    console.error(error);

    if (error.message.includes("duplicate key") || error.message.includes("ingredients_name_unique")) {
      alert("An ingredient with that name already exists.");
    } else {
      alert("Couldn't save the ingredient. Check the browser console for details.");
    }
  } finally {
    els.save.disabled = false;
    els.save.textContent = "Save ingredient";
  }
}

async function deleteIngredient(id) {
  const item = state.ingredients.find(x => x.id === id);
  if (!item) return;

  if (!confirm(`Delete "${item.name}"?`)) return;

  try {
    await supabaseRequest("ingredients", {
      method: "DELETE",
      query: `?id=eq.${id}`,
      prefer: "return=minimal"
    });

    await loadIngredients();
  } catch (error) {
    console.error(error);

    if (error.message.includes("foreign key")) {
      alert(
        `"${item.name}" can't be deleted because it is already being used by a recipe or pantry item.`
      );
    } else {
      alert("Couldn't delete the ingredient. Check the browser console for details.");
    }
  }
}

els.add.addEventListener("click", openAddIngredient);
els.cancel.addEventListener("click", closeModal);
els.save.addEventListener("click", saveIngredient);
els.search.addEventListener("input", renderIngredients);

els.modal.addEventListener("click", event => {
  if (event.target === els.modal) closeModal();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
});

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadIngredients();
})();
