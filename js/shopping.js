// shopping.js — the regular Shopping page. All the actual "what's needed"
// computation now lives in js/shopping-data.js (shared with Shop Mode), and
// the deal-check popup lives in js/deal-checker-widget.js (also shared).
// This file is just this page's own state and rendering.

const CHECKED_KEY_PREFIX = "savour_shopping_checked_"; // + week start date

let checkedKeys = new Set();
let currentWeekStart = null;
let lastBuyRows = []; // kept around so "Complete shop" can look up ticked rows
let viewedMonday = getMondayOf(new Date());

function loadCheckedFromStorage(weekStart) {
  try {
    const raw = localStorage.getItem(CHECKED_KEY_PREFIX + window.currentUserId + "_" + weekStart);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveCheckedToStorage() {
  try {
    localStorage.setItem(CHECKED_KEY_PREFIX + window.currentUserId + "_" + currentWeekStart, JSON.stringify([...checkedKeys]));
  } catch (e) {
    console.warn("Couldn't persist checked items", e);
  }
}

async function loadShoppingList() {
  try {
    setShellStatus(undefined, "Loading…");
    currentWeekStart = isoDate(viewedMonday);
    checkedKeys = loadCheckedFromStorage(currentWeekStart);
    updateWeekHeading();

    const plans = await supabaseRequest("meal_plans", {
      query: `?select=id&week_start=eq.${currentWeekStart}&user_id=eq.${window.currentUserId}&limit=1`
    });

    if (!plans.length) {
      renderEmpty();
      setShellStatus("ok", "Connected to Server");
      return;
    }

    const { buyRows, coveredRows, reminderRows } = await computeShoppingList(plans[0].id);
    render(buyRows, coveredRows, reminderRows);
    setShellStatus("ok", "Connected to Server");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
    document.getElementById("listContainer").innerHTML =
      `<div class="empty-state">Couldn't load the shopping list. Check the browser console for details.</div>`;
  }
}

// ---------- Rendering ----------

function render(buyRows, coveredRows, reminderRows) {
  lastBuyRows = buyRows;
  const allRows = [...buyRows, ...coveredRows, ...reminderRows];

  if (!allRows.length) {
    renderEmpty();
    document.getElementById("completeShopBar").style.display = "none";
    return;
  }

  if (!buyRows.length) {
    document.getElementById("listContainer").innerHTML =
      `<div class="empty-state">Everything planned this week is already covered.</div>` + renderReminderSection(reminderRows) + renderCoveredSection(coveredRows);
    renderSummary(buyRows, coveredRows, reminderRows);
    document.getElementById("completeShopBar").style.display = "none";
    return;
  }

  const categories = {};
  buyRows.forEach(row => {
    if (!categories[row.category]) categories[row.category] = [];
    categories[row.category].push(row);
  });

  const sortedCategoryNames = Object.keys(categories).sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  const buyHtml = sortedCategoryNames.map(cat => {
    const rows = categories[cat].sort((a, b) => a.label.localeCompare(b.label));
    return `
      <div class="category">
        <h3>${esc(cat)}</h3>
        <div class="card category-card">
          ${rows.map(row => `
            <div class="shop-row ${checkedKeys.has(row.key) ? "checked" : ""}">
              <input type="checkbox" ${checkedKeys.has(row.key) ? "checked" : ""} onchange="toggleChecked('${row.key.replace(/'/g, "\\'")}', this)">
              <div class="shop-label">
                ${esc(row.label)}
                ${row.priceHint ? `<div style="font-size:11px; color:var(--muted);">${esc(row.priceHint)}</div>` : ""}
              </div>
              <div class="shop-qty">${esc(row.qtyLabel)}</div>
              ${row.price !== null ? `<div class="shop-price">£${row.price.toFixed(2)}${row.priceSource ? `<br><span style="font-weight:400; font-size:10px; color:var(--muted);">${esc(row.priceSource)}</span>` : ""}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");

  document.getElementById("listContainer").innerHTML = buyHtml + renderReminderSection(reminderRows) + renderCoveredSection(coveredRows);
  renderSummary(buyRows, coveredRows, reminderRows);
  document.getElementById("completeShopBar").style.display = "block";
}

function renderReminderSection(reminderRows) {
  if (!reminderRows.length) return "";
  return `
    <div class="category reminder">
      <h3>Worth checking — staples you should already have</h3>
      <div class="card category-card reminder">
        ${reminderRows.map(row => `
          <div class="shop-row">
            <div class="shop-label">${esc(row.label)}</div>
            <div class="shop-qty">${esc(row.qtyLabel)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderCoveredSection(coveredRows) {
  if (!coveredRows.length) return "";
  return `
    <div class="category covered">
      <h3>Already covered by pantry</h3>
      <div class="card category-card covered">
        ${coveredRows.map(row => `
          <div class="shop-row">
            <div class="shop-label">${esc(row.label)}</div>
            <div class="shop-qty">${esc(row.qtyLabel)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderSummary(buyRows, coveredRows, reminderRows) {
  const totalCost = buyRows.reduce((sum, r) => sum + (r.price || 0), 0);
  const summary = document.getElementById("summaryBar");

  const stats = [
    { value: buyRows.length, label: "To buy" },
    { value: coveredRows.length, label: "Covered by pantry" },
    { value: reminderRows.length, label: "Worth checking" },
    { value: totalCost > 0 ? `£${totalCost.toFixed(2)}` : "—", label: "Estimated cost" }
  ];

  summary.innerHTML = `
    <div class="shopping-stats">
      ${stats.map(s => `<div class="shopping-stat"><span class="shopping-stat-value">${esc(String(s.value))}</span><span class="shopping-stat-label">${esc(s.label)}</span></div>`).join("")}
    </div>
    <div class="summary-note">Estimated cost only covers items with a logged price on the Prices page (or foods with a price set) — everything else is unpriced for now.</div>
  `;
}

function renderEmpty() {
  document.getElementById("summaryBar").innerHTML = "";
  document.getElementById("listContainer").innerHTML =
    `<div class="empty-state">Nothing planned for this week yet — add recipes or foods on the Week page and they'll show up here.</div>`;
}

function updateWeekHeading() {
  const monday = new Date(viewedMonday);
  const sunday = new Date(viewedMonday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = d => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const isCurrentWeek = isoDate(viewedMonday) === isoDate(getMondayOf(new Date()));
  const rangeLabel = `${fmt(monday)} – ${fmt(sunday)}`;
  const heading = document.getElementById("weekHeading");
  if (heading) heading.textContent = isCurrentWeek ? `Shopping List (${rangeLabel})` : `Shopping List — ${rangeLabel}`;
}

async function navigateWeek(delta) {
  viewedMonday.setDate(viewedMonday.getDate() + delta * 7);
  await loadShoppingList();
}

async function jumpToToday() {
  viewedMonday = getMondayOf(new Date());
  await loadShoppingList();
}

function toggleChecked(key, checkbox) {
  if (checkbox.checked) checkedKeys.add(key); else checkedKeys.delete(key);
  checkbox.closest(".shop-row").classList.toggle("checked", checkbox.checked);
  saveCheckedToStorage();
}

function clearChecked() {
  checkedKeys.clear();
  saveCheckedToStorage();
  document.querySelectorAll(".shop-row").forEach(row => {
    row.classList.remove("checked");
    const box = row.querySelector("input[type=checkbox]");
    if (box) box.checked = false;
  });
}

// ---------- Complete shop modal — reviews quantities, then calls addItemsToPantry ----------

let pendingShopRows = null;

function openCompleteShopModal() {
  pendingShopRows = lastBuyRows.filter(r => checkedKeys.has(r.key));

  if (!pendingShopRows.length) {
    alert("Tick some items off the list first — this adds whatever's ticked to your pantry.");
    return;
  }

  document.getElementById("modal").innerHTML = `
    <h2>Complete shop</h2>
    <p class="meta">These will be added to your pantry. Adjust any amounts first — e.g. if you bought more or less than planned.</p>
    <div>
      ${pendingShopRows.map((r, i) => `
        <div class="mark-row">
          <div class="mark-row-name">${esc(r.label)}</div>
          <input type="number" step="any" min="0" id="shopQty_${i}" value="${r.needQty !== null ? formatQty(r.needQty) : ""}" placeholder="0">
          <div class="mark-row-unit">${esc(r.unit || "")}</div>
        </div>
      `).join("")}
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" onclick="confirmCompleteShop()">Add to pantry</button>
    </div>
  `;
  document.getElementById("modalBackdrop").classList.add("open");
}

async function confirmCompleteShop() {
  try {
    const items = pendingShopRows.map((r, i) => {
      const qtyRaw = document.getElementById(`shopQty_${i}`).value;
      return {
        ingredientId: r.type === "ingredient" ? r.refId : null,
        foodId: r.type === "food" ? r.refId : null,
        unit: r.unit,
        qty: qtyRaw === "" ? 0 : Number(qtyRaw)
      };
    });

    await addItemsToPantry(items);

    pendingShopRows.forEach(r => checkedKeys.delete(r.key));
    saveCheckedToStorage();
    closeModal();
    alert("Pantry updated.");
    await loadShoppingList();
  } catch (error) {
    console.error(error);
    alert("Couldn't update your pantry. Check the browser console for details.");
  }
}

function closeModal() {
  document.getElementById("modalBackdrop").classList.remove("open");
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadShoppingList();
})();
