// deal-checker-widget.js — the "Check a deal" popup, shared between the
// regular Shopping page and Shop Mode. Assumes the host page provides
// #modal / #modalBackdrop and a closeModal() function, same convention
// used throughout the app's other modals.

const dealCheck = {
  ingredients: null,
  foods: null,
  type: "ingredient",
  selection: null,
  priceHistory: []
};

const VERDICT_ICONS = {
  good: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>`,
  typical: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>`,
  bad: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>`,
  unknown: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.4v.3"/><path d="M12 17h.01"/></svg>`
};

async function openDealCheckModal() {
  document.getElementById("modal").innerHTML = `<h2>Check a deal</h2><p class="meta">Loading…</p>`;
  document.getElementById("modalBackdrop").classList.add("open");

  if (!dealCheck.ingredients) {
    try {
      const [ingredients, foods] = await Promise.all([
        supabaseRequest("ingredients", { query: "?select=id,name,default_unit&order=name.asc" }),
        supabaseRequest("foods", { query: `?select=id,name,serving_unit&user_id=eq.${window.currentUserId}&order=name.asc` })
      ]);
      dealCheck.ingredients = ingredients;
      dealCheck.foods = foods;
    } catch (error) {
      console.error(error);
      document.getElementById("modal").innerHTML = `<h2>Check a deal</h2><p class="meta">Couldn't load items. Check the browser console for details.</p><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`;
      return;
    }
  }

  dealCheck.type = "ingredient";
  dealCheck.selection = null;
  renderDealCheckPicker();
}

function renderDealCheckPicker() {
  document.getElementById("modal").innerHTML = `
    <h2>Check a deal</h2>
    <div class="type-toggle">
      <button type="button" class="type-btn ${dealCheck.type === "ingredient" ? "active" : ""}" onclick="switchDealCheckType('ingredient')">Ingredient</button>
      <button type="button" class="type-btn ${dealCheck.type === "food" ? "active" : ""}" onclick="switchDealCheckType('food')">Food</button>
    </div>
    <div class="field">
      <label>What are you looking at?</label>
      <input id="dcPickSearch" placeholder="Type to search…" oninput="renderDealCheckOptions()">
    </div>
    <div id="dcPickOptions" class="pick-options"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>
  `;
  renderDealCheckOptions();
}

function switchDealCheckType(type) {
  dealCheck.type = type;
  dealCheck.selection = null;
  renderDealCheckPicker();
}

function renderDealCheckOptions() {
  const term = document.getElementById("dcPickSearch").value.trim().toLowerCase();
  const source = dealCheck.type === "ingredient" ? dealCheck.ingredients : dealCheck.foods;
  const filtered = source.filter(x => x.name.toLowerCase().includes(term));
  const box = document.getElementById("dcPickOptions");

  if (!filtered.length) {
    box.innerHTML = `<div class="empty-state">${source.length ? "No matches." : `No ${dealCheck.type}s yet.`}</div>`;
    return;
  }
  box.innerHTML = filtered.map(x => `<div class="pick-option" onclick="selectDealCheckItem('${x.id}')">${esc(x.name)}</div>`).join("");
}

async function selectDealCheckItem(id) {
  const source = dealCheck.type === "ingredient" ? dealCheck.ingredients : dealCheck.foods;
  const item = source.find(x => x.id === id);
  if (!item) return;

  dealCheck.selection = { id: item.id, name: item.name, defaultUnit: dealCheck.type === "ingredient" ? item.default_unit : item.serving_unit };
  document.getElementById("modal").innerHTML = `<h2>Check a deal</h2><p class="meta">Loading price history…</p>`;

  try {
    const filterField = dealCheck.type === "ingredient" ? "ingredient_id" : "food_id";
    dealCheck.priceHistory = await supabaseRequest("product_prices", {
      query: `?select=unit_price,is_deal,pack_unit&${filterField}=eq.${item.id}`
    });
  } catch (error) {
    console.error(error);
    dealCheck.priceHistory = [];
  }

  renderDealCheckDetails();
}

function dealCheckChangeSelection() {
  dealCheck.selection = null;
  renderDealCheckPicker();
}

function computeDealCheckGuidePrice() {
  const nonDeal = dealCheck.priceHistory.filter(p => !p.is_deal);
  const source = nonDeal.length ? nonDeal : dealCheck.priceHistory;
  if (!source.length) return null;
  const avg = source.reduce((sum, p) => sum + p.unit_price, 0) / source.length;
  return { avg, count: source.length, isFallbackToDeals: !nonDeal.length };
}

function getDealCheckVerdict(enteredUnitPrice, guide) {
  if (!guide) return { key: "unknown", label: "No data to compare yet", detail: "This will become the first reference price for this item." };
  const ratio = enteredUnitPrice / guide.avg;
  if (ratio <= 0.85) return { key: "good", label: "Good deal!", detail: `${Math.round((1 - ratio) * 100)}% below the typical £${guide.avg.toFixed(2)}` };
  if (ratio >= 1.15) return { key: "bad", label: "Pricier than usual", detail: `${Math.round((ratio - 1) * 100)}% above the typical £${guide.avg.toFixed(2)}` };
  return { key: "typical", label: "Fairly typical price", detail: `Typical price is around £${guide.avg.toFixed(2)}` };
}

function renderDealCheckDetails() {
  const sel = dealCheck.selection;
  const guide = computeDealCheckGuidePrice();
  const isAdmin = window.currentUserId === ADMIN_USER_ID;

  document.getElementById("modal").innerHTML = `
    <h2>Check a deal</h2>
    <div class="selection-banner">
      <span>${esc(sel.name)}</span>
      <button onclick="dealCheckChangeSelection()">Change</button>
    </div>
    <div class="guide-note">
      ${guide
        ? `Typical price so far: <strong>£${guide.avg.toFixed(2)}</strong> per unit (from ${guide.count} logged price${guide.count === 1 ? "" : "s"}${guide.isFallbackToDeals ? " — deal prices only, no baseline yet" : ""})`
        : "No prices logged for this yet."}
    </div>
    <div class="form-grid">
      <div class="field"><label>Price seen</label><input id="dcPrice" type="number" step="any" min="0" placeholder="e.g. 2.00" oninput="updateDealCheckVerdict()"></div>
      <div class="field"><label>Pack size (total)</label><input id="dcPackSize" type="number" step="any" min="0" placeholder="e.g. 500" oninput="updateDealCheckVerdict()"></div>
      <div class="field full"><label>Pack unit</label><input id="dcPackUnit" placeholder="e.g. g" value="${esc(sel.defaultUnit || "")}" oninput="updateDealCheckVerdict()"></div>
      ${isAdmin ? `
        <div class="field"><label>Store</label><input id="dcStore" placeholder="e.g. Tesco"></div>
        <div class="field"><label>Brand (optional)</label><input id="dcBrand" placeholder="e.g. Tesco Finest"></div>
      ` : ""}
    </div>
    <div id="dcVerdictBox"></div>
    <div id="dcSuggestBox"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>
  `;
}

function updateDealCheckVerdict() {
  const price = Number(document.getElementById("dcPrice").value);
  const packSize = Number(document.getElementById("dcPackSize").value);
  const packUnit = document.getElementById("dcPackUnit").value.trim();
  const box = document.getElementById("dcVerdictBox");
  const suggestBox = document.getElementById("dcSuggestBox");
  const isAdmin = window.currentUserId === ADMIN_USER_ID;

  if (!price || !packSize || !packUnit) {
    box.innerHTML = "";
    suggestBox.innerHTML = "";
    return;
  }

  const unitPrice = price / packSize;
  const guide = computeDealCheckGuidePrice();
  const verdict = getDealCheckVerdict(unitPrice, guide);

  box.innerHTML = `
    <div class="verdict ${verdict.key}">
      <div class="verdict-icon">${VERDICT_ICONS[verdict.key]}</div>
      <div class="verdict-label">${esc(verdict.label)}</div>
      <div class="verdict-detail">${esc(verdict.detail)}</div>
      <div class="verdict-detail">£${unitPrice.toFixed(2)} per ${esc(packUnit)}</div>
    </div>
    ${isAdmin ? `
      <div class="checkbox-row">
        <input type="checkbox" id="dcIsDeal" ${verdict.key === "good" ? "checked" : ""}>
        <label for="dcIsDeal">Mark as a deal/promotion</label>
      </div>
      <button class="btn primary" style="width:100%; border-radius:999px;" onclick="logDealCheckPrice()">Log this price</button>
    ` : ""}
  `;

  if (verdict.key === "good" && dealCheck.type === "ingredient") {
    renderDealCheckSuggestions();
  } else {
    suggestBox.innerHTML = "";
  }
}

async function renderDealCheckSuggestions() {
  const suggestBox = document.getElementById("dcSuggestBox");
  suggestBox.innerHTML = `<p class="meta">Looking for recipes that use this…</p>`;

  try {
    const rows = await supabaseRequest("recipe_ingredients", {
      query: `?select=recipe_id,recipes(id,name,servings,cooking_time_minutes)&ingredient_id=eq.${dealCheck.selection.id}`
    });
    const seen = new Set();
    const recipes = [];
    rows.forEach(r => { if (r.recipes && !seen.has(r.recipes.id)) { seen.add(r.recipes.id); recipes.push(r.recipes); } });

    if (!recipes.length) {
      suggestBox.innerHTML = `<p class="meta">No recipes using this yet — worth adding one while it's cheap!</p>`;
      return;
    }

    suggestBox.innerHTML = `
      <div class="recipe-suggest">
        <h3>Recipes using this</h3>
        <ul class="suggest-list">
          ${recipes.map(r => `
            <li>
              <span>${esc(r.name)}<br><span class="suggest-sub">Serves ${r.servings || "?"} · ${r.cooking_time_minutes ? r.cooking_time_minutes + " mins" : ""}</span></span>
              <a class="btn" style="border-radius:999px;" href="recipe-view.html?id=${r.id}">View</a>
            </li>
          `).join("")}
        </ul>
      </div>
    `;
  } catch (error) {
    console.error(error);
    suggestBox.innerHTML = "";
  }
}

async function logDealCheckPrice() {
  const store = document.getElementById("dcStore").value.trim() || "Unspecified";
  const brand = document.getElementById("dcBrand").value.trim();
  const price = Number(document.getElementById("dcPrice").value);
  const packSize = Number(document.getElementById("dcPackSize").value);
  const packUnit = document.getElementById("dcPackUnit").value.trim();
  const isDeal = document.getElementById("dcIsDeal").checked;

  const body = {
    store, brand: brand || null, product_name: dealCheck.selection.name,
    pack_size: packSize, pack_unit: packUnit, price,
    is_deal: isDeal, deal_ends_on: null, logged_by: window.currentUserId
  };
  if (dealCheck.type === "ingredient") body.ingredient_id = dealCheck.selection.id; else body.food_id = dealCheck.selection.id;

  try {
    await supabaseRequest("product_prices", { method: "POST", body });
    alert("Price logged — thanks, this helps future deal checks.");
    closeModal();
  } catch (error) {
    console.error(error);
    alert("Couldn't log that price. Check the browser console for details.\n\nIf this keeps happening, double-check price submission is actually meant to be admin-only for your account.");
  }
}
