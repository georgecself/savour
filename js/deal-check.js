const state = {
  ingredients: [],
  foods: [],
  type: "ingredient",
  selection: null, // { id, name, defaultUnit }
  priceHistory: [] // logged product_prices for the selected item
};

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

// ---------- Loading ----------

async function loadLookups() {
  const [ingredients, foods] = await Promise.all([
    supabaseRequest("ingredients", { query: "?select=id,name,default_unit&order=name.asc" }),
    supabaseRequest("foods", { query: `?select=id,name,serving_unit&user_id=eq.${window.currentUserId}&order=name.asc` })
  ]);
  state.ingredients = ingredients;
  state.foods = foods;
}

// ---------- Item picker ----------

function switchType(type) {
  state.type = type;
  document.getElementById("typeBtnIngredient").classList.toggle("active", type === "ingredient");
  document.getElementById("typeBtnFood").classList.toggle("active", type === "food");
  state.selection = null;
  document.getElementById("detailsSection").style.display = "none";
  document.getElementById("pickSection").style.display = "block";
  document.getElementById("pickSearch").value = "";
  renderPickOptions();
}

function renderPickOptions() {
  const term = document.getElementById("pickSearch").value.trim().toLowerCase();
  const source = state.type === "ingredient" ? state.ingredients : state.foods;
  const filtered = source.filter(x => x.name.toLowerCase().includes(term));
  const box = document.getElementById("pickOptions");

  if (!filtered.length) {
    box.innerHTML = `<div class="empty-state">${source.length ? "No matches." : `No ${state.type}s yet.`}</div>`;
    return;
  }

  box.innerHTML = filtered.map(x => `<div class="pick-option" onclick="selectItem('${x.id}')">${esc(x.name)}</div>`).join("");
}

async function selectItem(id) {
  const source = state.type === "ingredient" ? state.ingredients : state.foods;
  const item = source.find(x => x.id === id);
  if (!item) return;

  state.selection = { id: item.id, name: item.name, defaultUnit: state.type === "ingredient" ? item.default_unit : item.serving_unit };

  document.getElementById("pickSection").style.display = "none";
  document.getElementById("detailsSection").style.display = "block";
  document.getElementById("detailsSection").innerHTML = `<p class="meta">Loading price history…</p>`;

  try {
    const filterField = state.type === "ingredient" ? "ingredient_id" : "food_id";
    state.priceHistory = await supabaseRequest("product_prices", {
      query: `?select=unit_price,is_deal,pack_unit&${filterField}=eq.${item.id}`
    });
  } catch (error) {
    console.error(error);
    state.priceHistory = [];
  }

  renderDetails();
}

function changeSelection() {
  state.selection = null;
  document.getElementById("detailsSection").style.display = "none";
  document.getElementById("pickSection").style.display = "block";
}

// ---------- Guide price ----------

function computeGuidePrice() {
  const nonDeal = state.priceHistory.filter(p => !p.is_deal);
  const source = nonDeal.length ? nonDeal : state.priceHistory;
  if (!source.length) return null;
  const avg = source.reduce((sum, p) => sum + p.unit_price, 0) / source.length;
  return { avg, count: source.length, isFallbackToDeals: !nonDeal.length };
}

function getVerdict(enteredUnitPrice, guide) {
  if (!guide) return { key: "unknown", emoji: "❔", label: "No data to compare yet", detail: "This will become the first reference price for this item." };
  const ratio = enteredUnitPrice / guide.avg;
  if (ratio <= 0.85) return { key: "good", emoji: "🟢", label: "Good deal!", detail: `${Math.round((1 - ratio) * 100)}% below the typical £${guide.avg.toFixed(2)}` };
  if (ratio >= 1.15) return { key: "bad", emoji: "🔴", label: "Pricier than usual", detail: `${Math.round((ratio - 1) * 100)}% above the typical £${guide.avg.toFixed(2)}` };
  return { key: "typical", emoji: "🟡", label: "Fairly typical price", detail: `Typical price is around £${guide.avg.toFixed(2)}` };
}

// ---------- Rendering ----------

function renderDetails() {
  const sel = state.selection;
  const guide = computeGuidePrice();

  document.getElementById("detailsSection").innerHTML = `
    <div class="card section-card">
      <div class="selection-banner">
        <span>${state.type === "ingredient" ? "🥕" : "🥫"} ${esc(sel.name)}</span>
        <button onclick="changeSelection()">Change</button>
      </div>
      <div class="guide-note">
        ${guide
          ? `Typical price so far: <strong>£${guide.avg.toFixed(2)}</strong> per unit (from ${guide.count} logged price${guide.count === 1 ? "" : "s"}${guide.isFallbackToDeals ? " — deal prices only, no baseline yet" : ""})`
          : "No prices logged for this yet — you'll be the first."}
      </div>

      <div class="form-grid">
        <div class="field"><label>Store (optional)</label><input id="dStore" placeholder="e.g. Tesco"></div>
        <div class="field"><label>Brand (optional)</label><input id="dBrand" placeholder="e.g. Tesco Finest"></div>
        <div class="field"><label>Price seen</label><input id="dPrice" type="number" step="any" min="0" placeholder="e.g. 2.00" oninput="updateVerdict()"></div>
        <div class="field"><label>Pack size (total)</label><input id="dPackSize" type="number" step="any" min="0" placeholder="e.g. 500" oninput="updateVerdict()"></div>
        <div class="field full"><label>Pack unit</label><input id="dPackUnit" placeholder="e.g. g" value="${esc(sel.defaultUnit || "")}" oninput="updateVerdict()"></div>
      </div>
    </div>

    <div id="verdictBox"></div>
    <div id="recipeSuggestBox"></div>

    <div class="footer-link"><a href="prices.html">📊 See all logged prices</a></div>
  `;
}

function updateVerdict() {
  const price = Number(document.getElementById("dPrice").value);
  const packSize = Number(document.getElementById("dPackSize").value);
  const packUnit = document.getElementById("dPackUnit").value.trim();

  const box = document.getElementById("verdictBox");
  const suggestBox = document.getElementById("recipeSuggestBox");

  if (!price || !packSize || !packUnit) {
    box.innerHTML = "";
    suggestBox.innerHTML = "";
    return;
  }

  const unitPrice = price / packSize;
  const guide = computeGuidePrice();
  const verdict = getVerdict(unitPrice, guide);

  box.innerHTML = `
    <div class="verdict ${verdict.key}">
      <div class="verdict-emoji">${verdict.emoji}</div>
      <div class="verdict-label">${esc(verdict.label)}</div>
      <div class="verdict-detail">${esc(verdict.detail)}</div>
      <div class="verdict-detail">£${unitPrice.toFixed(2)} per ${esc(packUnit)}</div>
    </div>

    <div class="card section-card">
      <div class="checkbox-row">
        <input type="checkbox" id="dIsDeal" ${verdict.key === "good" ? "checked" : ""}>
        <label for="dIsDeal">Mark as a deal/promotion</label>
      </div>
      <button class="btn primary" style="width:100%;" onclick="logThisPrice('${verdict.key}')">Log this price</button>
    </div>
  `;

  if (verdict.key === "good" && state.type === "ingredient") {
    renderRecipeSuggestions();
  } else {
    suggestBox.innerHTML = "";
  }
}

async function renderRecipeSuggestions() {
  const suggestBox = document.getElementById("recipeSuggestBox");
  suggestBox.innerHTML = `<p class="meta">Looking for recipes that use this…</p>`;

  try {
    const rows = await supabaseRequest("recipe_ingredients", {
      query: `?select=recipe_id,recipes(id,name,servings,cooking_time_minutes)&ingredient_id=eq.${state.selection.id}`
    });

    const seen = new Set();
    const recipes = [];
    rows.forEach(r => {
      if (r.recipes && !seen.has(r.recipes.id)) { seen.add(r.recipes.id); recipes.push(r.recipes); }
    });

    if (!recipes.length) {
      suggestBox.innerHTML = `<div class="card section-card"><p class="meta" style="margin:0;">No recipes using this yet — worth adding one while it's cheap!</p></div>`;
      return;
    }

    suggestBox.innerHTML = `
      <div class="card section-card recipe-suggest">
        <h3>🍳 Recipes using this — good time to plan one</h3>
        <ul class="suggest-list">
          ${recipes.map(r => `
            <li>
              <span>${esc(r.name)}<br><span class="suggest-sub">Serves ${r.servings || "?"} · ${r.cooking_time_minutes ? r.cooking_time_minutes + " mins" : ""}</span></span>
              <a class="btn" href="recipe-view.html?id=${r.id}">View</a>
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

async function logThisPrice(verdictKey) {
  const store = document.getElementById("dStore").value.trim() || "Unspecified";
  const brand = document.getElementById("dBrand").value.trim();
  const price = Number(document.getElementById("dPrice").value);
  const packSize = Number(document.getElementById("dPackSize").value);
  const packUnit = document.getElementById("dPackUnit").value.trim();
  const isDeal = document.getElementById("dIsDeal").checked;

  const body = {
    store, brand: brand || null,
    product_name: state.selection.name,
    pack_size: packSize, pack_unit: packUnit, price,
    is_deal: isDeal, deal_ends_on: null,
    logged_by: window.currentUserId
  };
  if (state.type === "ingredient") body.ingredient_id = state.selection.id; else body.food_id = state.selection.id;

  try {
    await supabaseRequest("product_prices", { method: "POST", body });
    alert("Price logged — thanks, this helps future deal checks.");
    // Reset for the next check
    state.selection = null;
    document.getElementById("detailsSection").style.display = "none";
    document.getElementById("pickSection").style.display = "block";
    document.getElementById("pickSearch").value = "";
    renderPickOptions();
  } catch (error) {
    console.error(error);
    alert("Couldn't log that price. Check the browser console for details.");
  }
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  try {
    setStatus("Loading…");
    await loadLookups();
    renderPickOptions();
    setStatus("Connected to Supabase");
  } catch (error) {
    console.error(error);
    setStatus("Database connection failed");
  }
})();
