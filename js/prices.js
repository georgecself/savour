const state = {
  ingredients: [],
  foods: [],
  prices: [], // raw rows with resolved item name/type
  addType: "ingredient",
  pendingSelection: null,
  editingId: null
};

const els = {
  groups: document.getElementById("priceGroups"),
  search: document.getElementById("searchInput"),
  modal: document.getElementById("modal"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  add: document.getElementById("addPriceBtn")
};

const isAdmin = () => window.currentUserId === ADMIN_USER_ID;

function fmtMoney(n) {
  return "£" + Number(n).toFixed(2);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// ---------- Loading ----------

async function loadAll() {
  try {
    setShellStatus(undefined, "Loading…");

    const [ingredients, foods, prices] = await Promise.all([
      supabaseRequest("ingredients", { query: "?select=id,name,default_unit&order=name.asc" }),
      supabaseRequest("foods", { query: `?select=id,name,serving_unit&user_id=eq.${window.currentUserId}&order=name.asc` }),
      supabaseRequest("product_prices", {
        query: "?select=id,ingredient_id,food_id,store,brand,product_name,pack_size,pack_unit,price,unit_price,is_deal,deal_ends_on,logged_by,created_at,ingredients(name),foods(name)&order=unit_price.asc"
      })
    ]);

    state.ingredients = ingredients;
    state.foods = foods;

    state.prices = prices.map(p => ({
      id: p.id, ingredientId: p.ingredient_id, foodId: p.food_id,
      itemName: p.ingredients?.name || p.foods?.name || "(deleted item)",
      itemKey: p.ingredient_id || p.food_id,
      store: p.store, brand: p.brand, productName: p.product_name,
      packSize: p.pack_size, packUnit: p.pack_unit, price: p.price, unitPrice: p.unit_price,
      isDeal: p.is_deal, dealEndsOn: p.deal_ends_on, loggedBy: p.logged_by, createdAt: p.created_at
    }));

    if (isAdmin() && els.add) els.add.style.display = "flex";

    renderGroups();
    setShellStatus("ok", "Connected to Server");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
    els.groups.innerHTML = `<div class="empty-state">Couldn't load prices. Check the browser console for details.</div>`;
  }
}

function renderGroups() {
  const term = els.search.value.trim().toLowerCase();
  const filtered = state.prices.filter(p =>
    p.itemName.toLowerCase().includes(term) ||
    p.store.toLowerCase().includes(term) ||
    (p.brand || "").toLowerCase().includes(term)
  );

  if (!filtered.length) {
    els.groups.innerHTML = `<div class="empty-state">${term ? "No matches." : "No prices logged yet."}</div>`;
    return;
  }

  const groups = {};
  filtered.forEach(p => {
    if (!groups[p.itemKey]) groups[p.itemKey] = { name: p.itemName, rows: [] };
    groups[p.itemKey].rows.push(p);
  });

  const sortedGroupKeys = Object.keys(groups).sort((a, b) => groups[a].name.localeCompare(groups[b].name));
  const admin = isAdmin();

  els.groups.innerHTML = sortedGroupKeys.map(key => {
    const group = groups[key];
    const rows = [...group.rows].sort((a, b) => a.unitPrice - b.unitPrice); // cheapest first
    const cheapestId = rows[0]?.id;

    return `
      <div class="group">
        <h3>${esc(group.name)}</h3>
        <div class="card price-card">
          <table class="price-table">
            <thead>
              <tr><th>Store</th><th>Product</th><th>Pack</th><th>Price</th><th>Per unit</th><th>Logged on</th>${admin ? "<th></th>" : ""}</tr>
            </thead>
            <tbody>
              ${rows.map(r => {
                const dealActive = r.isDeal && (!r.dealEndsOn || r.dealEndsOn >= todayIso());
                return `
                <tr class="${r.id === cheapestId ? "best" : ""}">
                  <td>${esc(r.store)}</td>
                  <td>${esc(r.productName)}${r.brand ? `<br><span style="color:var(--muted); font-size:12px;">${esc(r.brand)}</span>` : ""}</td>
                  <td>${esc(String(r.packSize))} ${esc(r.packUnit)}</td>
                  <td>${fmtMoney(r.price)}</td>
                  <td class="unit-price">${fmtMoney(r.unitPrice)}/${esc(r.packUnit)}
                    ${r.id === cheapestId ? `<span class="best-badge">Best value</span>` : ""}
                    ${dealActive ? `<span class="deal-badge">Deal</span>` : ""}
                  </td>
                  <td class="logged-date">${fmtDate(r.createdAt)}</td>
                  ${admin ? `
                    <td>
                      <div class="row-actions">
                        <button class="row-icon-btn" onclick="openEditPrice('${r.id}')" title="Edit" aria-label="Edit">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        </button>
                        <button class="row-icon-btn danger" onclick="deletePrice('${r.id}')" title="Delete" aria-label="Delete">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>
                        </button>
                      </div>
                    </td>
                  ` : ""}
                </tr>
              `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- Add flow (admin only — button is hidden otherwise, and RLS blocks the write regardless) ----------

function openAddPrice() {
  state.editingId = null;
  state.addType = "ingredient";
  state.pendingSelection = null;
  renderAddModal();
  els.modalBackdrop.classList.add("open");
}

function renderAddModal() {
  if (!state.pendingSelection) {
    els.modal.innerHTML = `
      <h2>Log a price</h2>
      <p class="meta">Pick what this price is for — you'll enter the details next.</p>
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
      <h2>Log a price</h2>
      <div class="selection-banner">
        <span>${esc(sel.name)}</span>
        <button onclick="backToPicker()">Change</button>
      </div>

      <div class="form-grid">
        <div class="field"><label>Store</label><input id="pStore" placeholder="e.g. Tesco"></div>
        <div class="field"><label>Brand (optional)</label><input id="pBrand" placeholder="e.g. Tesco Finest"></div>
        <div class="field full"><label>Product name</label><input id="pProductName" placeholder="e.g. Tesco Spaghetti 500g" value="${esc(sel.name)}"></div>
        <div class="field"><label>Pack size (total contents)</label><input id="pPackSize" type="number" step="any" min="0" placeholder="e.g. 500"></div>
        <div class="field"><label>Pack unit</label><input id="pPackUnit" placeholder="e.g. g" value="${esc(sel.defaultUnit || "")}"></div>
        <div class="field full"><label>Price</label><input id="pPrice" type="number" step="any" min="0" placeholder="e.g. 0.65"></div>
      </div>
      <p class="meta" style="margin-top:-6px;">For multipacks, enter the <strong>total</strong> contents — e.g. a 3×500g multipack is pack size 1500, not 3.</p>

      <div class="checkbox-row">
        <input type="checkbox" id="pIsDeal" onchange="document.getElementById('dealEndsField').style.display=this.checked?'block':'none'">
        <label for="pIsDeal">This is a current deal/promotion</label>
      </div>
      <div class="field" id="dealEndsField" style="display:none;">
        <label>Deal ends (optional)</label>
        <input id="pDealEnds" type="date">
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="backToPicker()">Back</button>
        <button class="btn primary" style="border-radius:999px;" onclick="confirmSavePrice()">Save price</button>
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

  box.innerHTML = filtered.map(x => `<div class="pick-option" onclick="selectPickItem('${x.id}')">${esc(x.name)}</div>`).join("");
}

function selectPickItem(id) {
  const source = state.addType === "ingredient" ? state.ingredients : state.foods;
  const item = source.find(x => x.id === id);
  if (!item) return;

  state.pendingSelection = {
    id: item.id, name: item.name,
    defaultUnit: state.addType === "ingredient" ? item.default_unit : item.serving_unit
  };
  renderAddModal();
}

function backToPicker() {
  state.pendingSelection = null;
  renderAddModal();
}

async function confirmSavePrice() {
  const store = document.getElementById("pStore").value.trim();
  const brand = document.getElementById("pBrand").value.trim();
  const productName = document.getElementById("pProductName").value.trim();
  const packSize = Number(document.getElementById("pPackSize").value);
  const packUnit = document.getElementById("pPackUnit").value.trim();
  const price = Number(document.getElementById("pPrice").value);
  const isDeal = document.getElementById("pIsDeal").checked;
  const dealEndsOn = document.getElementById("pDealEnds").value || null;

  if (!store || !productName || !packSize || !packUnit || !price) {
    alert("Please fill in store, product name, pack size, pack unit, and price.");
    return;
  }

  const sel = state.pendingSelection;
  const body = {
    store, brand: brand || null, product_name: productName,
    pack_size: packSize, pack_unit: packUnit, price,
    is_deal: isDeal, deal_ends_on: isDeal ? dealEndsOn : null,
    logged_by: window.currentUserId
  };
  if (state.addType === "ingredient") body.ingredient_id = sel.id; else body.food_id = sel.id;

  try {
    await supabaseRequest("product_prices", { method: "POST", body });
    closeModal();
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't save that price. Check the browser console for details.");
  }
}

// ---------- Edit / delete (admin only) ----------

function openEditPrice(id) {
  const p = state.prices.find(x => x.id === id);
  if (!p) return;
  state.editingId = id;

  els.modal.innerHTML = `
    <h2>Edit price</h2>
    <div class="selection-banner"><span>${esc(p.itemName)}</span></div>

    <div class="form-grid">
      <div class="field"><label>Store</label><input id="pStore" value="${esc(p.store)}"></div>
      <div class="field"><label>Brand (optional)</label><input id="pBrand" value="${esc(p.brand || "")}"></div>
      <div class="field full"><label>Product name</label><input id="pProductName" value="${esc(p.productName)}"></div>
      <div class="field"><label>Pack size (total contents)</label><input id="pPackSize" type="number" step="any" min="0" value="${p.packSize}"></div>
      <div class="field"><label>Pack unit</label><input id="pPackUnit" value="${esc(p.packUnit)}"></div>
      <div class="field full"><label>Price</label><input id="pPrice" type="number" step="any" min="0" value="${p.price}"></div>
    </div>

    <div class="checkbox-row">
      <input type="checkbox" id="pIsDeal" ${p.isDeal ? "checked" : ""} onchange="document.getElementById('dealEndsField').style.display=this.checked?'block':'none'">
      <label for="pIsDeal">This is a current deal/promotion</label>
    </div>
    <div class="field" id="dealEndsField" style="display:${p.isDeal ? "block" : "none"};">
      <label>Deal ends (optional)</label>
      <input id="pDealEnds" type="date" value="${p.dealEndsOn || ""}">
    </div>

    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" style="border-radius:999px;" onclick="saveEditPrice('${id}')">Save</button>
    </div>
  `;
  els.modalBackdrop.classList.add("open");
}

async function saveEditPrice(id) {
  const body = {
    store: document.getElementById("pStore").value.trim(),
    brand: document.getElementById("pBrand").value.trim() || null,
    product_name: document.getElementById("pProductName").value.trim(),
    pack_size: Number(document.getElementById("pPackSize").value),
    pack_unit: document.getElementById("pPackUnit").value.trim(),
    price: Number(document.getElementById("pPrice").value),
    is_deal: document.getElementById("pIsDeal").checked,
    deal_ends_on: document.getElementById("pIsDeal").checked ? (document.getElementById("pDealEnds").value || null) : null
  };

  try {
    await supabaseRequest("product_prices", { method: "PATCH", query: `?id=eq.${id}`, body });
    closeModal();
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't save that change. Check the browser console for details.");
  }
}

async function deletePrice(id) {
  if (!confirm("Delete this logged price?")) return;
  try {
    await supabaseRequest("product_prices", { method: "DELETE", query: `?id=eq.${id}`, prefer: "return=minimal" });
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't delete that price. Check the browser console for details.");
  }
}

function closeModal() {
  els.modalBackdrop.classList.remove("open");
}

if (els.add) els.add.addEventListener("click", openAddPrice);
els.search.addEventListener("input", renderGroups);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadAll();
})();
