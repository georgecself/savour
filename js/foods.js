const state = {
  foods: [],
  editingId: null
};

const els = {
  table: document.getElementById("foodTable"),
  search: document.getElementById("searchInput"),
  modal: document.getElementById("modalBackdrop"),
  modalTitle: document.getElementById("modalTitle"),
  name: document.getElementById("foodName"),
  brand: document.getElementById("foodBrand"),
  category: document.getElementById("foodCategory"),
  servingSize: document.getElementById("foodServingSize"),
  servingUnit: document.getElementById("foodServingUnit"),
  calories: document.getElementById("foodCalories"),
  protein: document.getElementById("foodProtein"),
  carbs: document.getElementById("foodCarbs"),
  fat: document.getElementById("foodFat"),
  price: document.getElementById("foodPrice"),
  add: document.getElementById("addFoodBtn"),
  cancel: document.getElementById("cancelBtn"),
  save: document.getElementById("saveBtn"),
  status: document.getElementById("status")
};

function setStatus(message) {
  els.status.textContent = message;
}

function fmtNum(n, suffix = "") {
  return n === null || n === undefined ? "—" : `${n}${suffix}`;
}

async function loadFoods() {
  try {
    setStatus("Loading foods…");

    state.foods = await supabaseRequest("foods", {
      query: `?select=id,name,brand,serving_size,serving_unit,calories,protein_g,carbohydrates_g,fat_g,price,shopping_category,created_at&user_id=eq.${window.currentUserId}&order=name.asc`
    });

    renderFoods();
    setStatus(`${state.foods.length} food${state.foods.length === 1 ? "" : "s"}`);
  } catch (error) {
    console.error(error);
    setStatus("Connection failed");
    els.table.innerHTML = `
      <div class="empty-state">
        <strong>Couldn't load foods.</strong><br>
        Check the browser console for details.
      </div>`;
  }
}

function renderFoods() {
  const term = els.search.value.trim().toLowerCase();

  const filtered = state.foods.filter(item =>
    item.name.toLowerCase().includes(term) ||
    (item.brand || "").toLowerCase().includes(term) ||
    item.shopping_category.toLowerCase().includes(term)
  );

  if (!filtered.length) {
    els.table.innerHTML = `
      <div class="empty-state">
        ${term ? "No foods match your search." : "No foods yet — add your first one."}
      </div>`;
    return;
  }

  els.table.innerHTML = `
    <table class="food-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Brand</th>
          <th>Category</th>
          <th>Serving</th>
          <th>Cals</th>
          <th>Protein</th>
          <th>Carbs</th>
          <th>Fat</th>
          <th>Price</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(item => `
          <tr>
            <td class="wrap"><strong>${esc(item.name)}</strong></td>
            <td>${esc(item.brand || "—")}</td>
            <td>${esc(item.shopping_category)}</td>
            <td class="num">${item.serving_size ? esc(String(item.serving_size)) + " " + esc(item.serving_unit || "") : "—"}</td>
            <td class="num">${fmtNum(item.calories)}</td>
            <td class="num">${fmtNum(item.protein_g, "g")}</td>
            <td class="num">${fmtNum(item.carbohydrates_g, "g")}</td>
            <td class="num">${fmtNum(item.fat_g, "g")}</td>
            <td class="num">${item.price !== null ? "£" + Number(item.price).toFixed(2) : "—"}</td>
            <td>
              <div class="actions">
                <button class="btn" onclick="openEditFood('${item.id}')">Edit</button>
                <button class="btn danger" onclick="deleteFood('${item.id}')">Delete</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function fillForm(item) {
  els.name.value = item?.name || "";
  els.brand.value = item?.brand || "";
  els.category.value = item?.shopping_category || "Other";
  els.servingSize.value = item?.serving_size ?? "";
  els.servingUnit.value = item?.serving_unit || "";
  els.calories.value = item?.calories ?? "";
  els.protein.value = item?.protein_g ?? "";
  els.carbs.value = item?.carbohydrates_g ?? "";
  els.fat.value = item?.fat_g ?? "";
  els.price.value = item?.price ?? "";
}

function openAddFood() {
  state.editingId = null;
  els.modalTitle.textContent = "Add food";
  fillForm(null);
  els.modal.classList.add("open");
  setTimeout(() => els.name.focus(), 50);
}

function openEditFood(id) {
  const item = state.foods.find(x => x.id === id);
  if (!item) return;

  state.editingId = id;
  els.modalTitle.textContent = "Edit food";
  fillForm(item);
  els.modal.classList.add("open");
  setTimeout(() => els.name.focus(), 50);
}

function closeModal() {
  els.modal.classList.remove("open");
}

function numOrNull(value) {
  return value === "" ? null : Number(value);
}

async function saveFood() {
  const name = els.name.value.trim();

  if (!name) {
    alert("Please enter a food name.");
    return;
  }

  const payload = {
    name,
    brand: els.brand.value.trim() || null,
    shopping_category: els.category.value,
    serving_size: numOrNull(els.servingSize.value),
    serving_unit: els.servingUnit.value.trim() || null,
    calories: numOrNull(els.calories.value),
    protein_g: numOrNull(els.protein.value),
    carbohydrates_g: numOrNull(els.carbs.value),
    fat_g: numOrNull(els.fat.value),
    price: numOrNull(els.price.value)
  };

  els.save.disabled = true;
  els.save.textContent = "Saving…";

  try {
    if (state.editingId) {
      await supabaseRequest("foods", {
        method: "PATCH",
        query: `?id=eq.${state.editingId}`,
        body: payload
      });
    } else {
      await supabaseRequest("foods", {
        method: "POST",
        body: { ...payload, user_id: window.currentUserId }
      });
    }

    closeModal();
    await loadFoods();
  } catch (error) {
    console.error(error);
    alert("Couldn't save the food. Check the browser console for details.");
  } finally {
    els.save.disabled = false;
    els.save.textContent = "Save food";
  }
}

async function deleteFood(id) {
  const item = state.foods.find(x => x.id === id);
  if (!item) return;

  if (!confirm(`Delete "${item.name}"? This will also remove it from any meal plans or pantry entries it's used in.`)) return;

  try {
    await supabaseRequest("foods", {
      method: "DELETE",
      query: `?id=eq.${id}`,
      prefer: "return=minimal"
    });

    await loadFoods();
  } catch (error) {
    console.error(error);
    alert("Couldn't delete the food. Check the browser console for details.");
  }
}

els.add.addEventListener("click", openAddFood);
els.cancel.addEventListener("click", closeModal);
els.save.addEventListener("click", saveFood);
els.search.addEventListener("input", renderFoods);

els.modal.addEventListener("click", event => {
  if (event.target === els.modal) closeModal();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
});

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadFoods();
})();
