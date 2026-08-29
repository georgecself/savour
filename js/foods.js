const ADMIN_USER_ID = "37926109-b428-45fc-8771-72e16390a649";

const state = {
  myFoods: [],
  libraryFoods: [],
  activeTab: "mine",
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
  status: document.getElementById("status"),
  importLink: document.getElementById("importLink")
};

function setStatus(message) {
  els.status.textContent = message;
}

function fmtNum(n, suffix = "") {
  return n === null || n === undefined ? "—" : `${n}${suffix}`;
}

const FOOD_SELECT = "id,user_id,name,brand,serving_size,serving_unit,calories,protein_g,carbohydrates_g,fat_g,price,shopping_category,is_public,created_at";

async function loadFoodsMatching(query) {
  return supabaseRequest("foods", { query: `?select=${FOOD_SELECT}&${query}&order=name.asc` });
}

async function loadFoods() {
  try {
    setStatus("Loading foods…");

    const [mine, library] = await Promise.all([
      loadFoodsMatching(`user_id=eq.${window.currentUserId}`),
      loadFoodsMatching(`is_public=eq.true`)
    ]);
    state.myFoods = mine;
    state.libraryFoods = library;

    if (window.currentUserId === ADMIN_USER_ID) {
      els.importLink.style.display = "inline-block";
    }

    renderFoods();
    setStatus(`${state.myFoods.length} food${state.myFoods.length === 1 ? "" : "s"}`);
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

function switchTab(tab) {
  state.activeTab = tab;
  document.getElementById("tabMine").classList.toggle("active", tab === "mine");
  document.getElementById("tabLibrary").classList.toggle("active", tab === "library");
  renderFoods();
}

function renderFoods() {
  const term = els.search.value.trim().toLowerCase();
  const source = state.activeTab === "library" ? state.libraryFoods : state.myFoods;

  const filtered = source.filter(item =>
    item.name.toLowerCase().includes(term) ||
    (item.brand || "").toLowerCase().includes(term) ||
    item.shopping_category.toLowerCase().includes(term)
  );

  if (!filtered.length) {
    const emptyMsg = state.activeTab === "library"
      ? (term ? "No library foods match your search." : "No shared foods yet.")
      : (term ? "No foods match your search." : "No foods yet — add your first one.");
    els.table.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
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
        ${filtered.map(item => {
          const isMine = item.user_id === window.currentUserId;
          return `
          <tr>
            <td class="wrap">
              <strong>${esc(item.name)}</strong>
              ${state.activeTab === "library" ? `<br><span class="owner-badge">${isMine ? "Yours" : "Shared"}</span>` : ""}
            </td>
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
                ${isMine
                  ? `<button class="btn" onclick="openEditFood('${item.id}')">Edit</button><button class="btn danger" onclick="deleteFood('${item.id}')">Delete</button>`
                  : `<button class="btn primary" onclick="cloneFood('${item.id}')">＋ Add to mine</button>`
                }
              </div>
            </td>
          </tr>
        `;
        }).join("")}
      </tbody>
    </table>
  `;
}

async function cloneFood(id) {
  const source = state.libraryFoods.find(f => f.id === id);
  if (!source) return;
  if (!confirm(`Add "${source.name}" to your own foods?`)) return;

  try {
    await supabaseRequest("foods", {
      method: "POST",
      body: {
        name: source.name, brand: source.brand, shopping_category: source.shopping_category,
        serving_size: source.serving_size, serving_unit: source.serving_unit,
        calories: source.calories, protein_g: source.protein_g, carbohydrates_g: source.carbohydrates_g,
        fat_g: source.fat_g, price: source.price,
        user_id: window.currentUserId, is_public: false
      }
    });
    await loadFoods();
    switchTab("mine");
    alert(`"${source.name}" is now in your own foods.`);
  } catch (error) {
    console.error(error);
    alert("Couldn't add that food. Check the browser console for details.");
  }
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
  const item = [...state.myFoods, ...state.libraryFoods].find(x => x.id === id);
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
      // Not touching is_public here — PATCH only updates the fields listed,
      // so publish status (set via the importer) is left exactly as it was.
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
  const item = [...state.myFoods, ...state.libraryFoods].find(x => x.id === id);
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
