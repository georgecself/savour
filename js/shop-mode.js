// shop-mode.js — a mobile-first, hands-free way to work through the same
// shopping list, confirming what you actually bought item by item as you
// go, rather than one big edit-all at the end. Uses the shared computation
// engine in shopping-data.js — same categories, same pantry logic, same
// pricing — just a different, phone-friendly way of working through it.

let viewedMonday = getMondayOf(new Date());
let lastRows = { buyRows: [], coveredRows: [], reminderRows: [] };
const doneKeys = new Set(); // session-only — a real pantry write already happened per item

async function loadShoppingList() {
  try {
    setShellStatus(undefined, "Loading…");
    updateWeekHeading();

    const weekStart = isoDate(viewedMonday);
    const plans = await supabaseRequest("meal_plans", {
      query: `?select=id&week_start=eq.${weekStart}&user_id=eq.${window.currentUserId}&limit=1`
    });

    if (!plans.length) {
      renderEmpty();
      setShellStatus("ok", "Connected to Server");
      return;
    }

    lastRows = await computeShoppingList(plans[0].id);
    render();
    setShellStatus("ok", "Connected to Server");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
    document.getElementById("listContainer").innerHTML =
      `<div class="empty-state">Couldn't load the shopping list. Check the browser console for details.</div>`;
  }
}

function updateWeekHeading() {
  const monday = new Date(viewedMonday);
  const sunday = new Date(viewedMonday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = d => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const isCurrentWeek = isoDate(viewedMonday) === isoDate(getMondayOf(new Date()));
  const rangeLabel = `${fmt(monday)} – ${fmt(sunday)}`;
  document.getElementById("weekHeading").textContent = isCurrentWeek ? `Shop Mode (${rangeLabel})` : `Shop Mode — ${rangeLabel}`;
}

async function navigateWeek(delta) {
  viewedMonday.setDate(viewedMonday.getDate() + delta * 7);
  doneKeys.clear();
  await loadShoppingList();
}

async function jumpToToday() {
  viewedMonday = getMondayOf(new Date());
  doneKeys.clear();
  await loadShoppingList();
}

// ---------- Rendering ----------

function render() {
  const { buyRows, coveredRows, reminderRows } = lastRows;
  const allRows = [...buyRows, ...coveredRows, ...reminderRows];

  renderSummary();

  if (!allRows.length) {
    renderEmpty();
    return;
  }

  if (!buyRows.length) {
    document.getElementById("listContainer").innerHTML =
      `<div class="empty-state">Everything planned this week is already covered.</div>` +
      renderQuietSection(reminderRows, "reminder", "Worth checking") +
      renderQuietSection(coveredRows, "covered", "Already covered by pantry");
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
      <div class="sm-category">
        <h3>${esc(cat)}</h3>
        <div class="sm-list">
          ${rows.map(row => renderRow(row)).join("")}
        </div>
      </div>
    `;
  }).join("");

  document.getElementById("listContainer").innerHTML = buyHtml +
    renderQuietSection(reminderRows, "reminder", "Worth checking") +
    renderQuietSection(coveredRows, "covered", "Already covered by pantry");
}

function renderRow(row) {
  const done = doneKeys.has(row.key);
  return `
    <div class="sm-item-row ${done ? "done" : ""}" onclick="handleRowTap('${row.key.replace(/'/g, "\\'")}')">
      <div class="sm-check">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <div class="sm-item-body">
        <div class="sm-item-label">${esc(row.label)}</div>
        <div class="sm-item-qty">${esc(row.qtyLabel)}</div>
      </div>
      ${row.price !== null ? `<div class="sm-item-price">£${row.price.toFixed(2)}</div>` : ""}
    </div>
  `;
}

function renderQuietSection(rows, type, heading) {
  if (!rows.length) return "";
  return `
    <div class="sm-category quiet ${type}">
      <h3>${esc(heading)}</h3>
      <div class="sm-list quiet ${type}">
        ${rows.map(row => `
          <div class="sm-item-row">
            <div class="sm-item-body">
              <div class="sm-item-label">${esc(row.label)}</div>
              <div class="sm-item-qty">${esc(row.qtyLabel)}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderSummary() {
  const { buyRows, coveredRows, reminderRows } = lastRows;
  const remaining = buyRows.filter(r => !doneKeys.has(r.key)).length;
  document.getElementById("summaryBar").innerHTML = `
    <div class="sm-summary">
      <div class="sm-summary-stat"><span class="sm-summary-value">${remaining}</span><span class="sm-summary-label">Left to get</span></div>
      <div class="sm-summary-stat"><span class="sm-summary-value">${doneKeys.size}</span><span class="sm-summary-label">Got so far</span></div>
      <div class="sm-summary-stat"><span class="sm-summary-value">${coveredRows.length}</span><span class="sm-summary-label">Covered</span></div>
      <div class="sm-summary-stat"><span class="sm-summary-value">${reminderRows.length}</span><span class="sm-summary-label">Worth checking</span></div>
    </div>
  `;
}

function renderEmpty() {
  document.getElementById("summaryBar").innerHTML = "";
  document.getElementById("listContainer").innerHTML =
    `<div class="empty-state">Nothing planned for this week yet — add recipes or foods on the Meal Plans page and they'll show up here.</div>`;
}

// ---------- Tap-to-confirm-quantity flow ----------

let pendingRow = null;

function handleRowTap(key) {
  if (doneKeys.has(key)) return; // already confirmed — avoid accidental double-add
  const row = lastRows.buyRows.find(r => r.key === key);
  if (!row) return;
  pendingRow = row;
  openQtyModal();
}

function smStepSize(baseQty) {
  if (baseQty >= 1000) return 100;
  if (baseQty >= 200) return 25;
  if (baseQty >= 20) return 5;
  if (baseQty >= 5) return 1;
  return 0.5;
}

function openQtyModal() {
  const row = pendingRow;
  const startQty = row.needQty !== null ? Math.round(row.needQty * 100) / 100 : 1;

  document.getElementById("modal").innerHTML = `
    <div class="sm-qty-modal">
      <h2>${esc(row.label)}</h2>
      <div class="sm-qty-need">Needed: ${esc(row.qtyLabel)}</div>
      <div class="sm-stepper">
        <button onclick="adjustQty(-1)" aria-label="Decrease">−</button>
        <input type="number" step="any" class="sm-qty-input" id="smQtyInput" value="${startQty}">
        <button onclick="adjustQty(1)" aria-label="Increase">+</button>
      </div>
      <div class="sm-qty-unit-label">${esc(row.unit || (row.type === "food" ? "items" : ""))}</div>
      <div class="sm-qty-actions">
        <button class="btn primary" onclick="confirmShopModeItem()">Got it — confirm</button>
        <button class="btn" onclick="skipShopModeItem()">Didn't get this</button>
        <button class="btn" onclick="closeModal()">Cancel</button>
      </div>
    </div>
  `;
  document.getElementById("modalBackdrop").classList.add("open");
}

function adjustQty(direction) {
  const input = document.getElementById("smQtyInput");
  const current = Number(input.value) || 0;
  const step = smStepSize(current);
  const next = Math.max(0, Math.round((current + direction * step) * 100) / 100);
  input.value = next;
}

async function confirmShopModeItem() {
  const row = pendingRow;
  const qty = Number(document.getElementById("smQtyInput").value) || 0;

  try {
    await addItemsToPantry([{
      ingredientId: row.type === "ingredient" ? row.refId : null,
      foodId: row.type === "food" ? row.refId : null,
      unit: row.unit,
      qty
    }]);
    doneKeys.add(row.key);
    closeModal();
    render();
  } catch (error) {
    console.error(error);
    alert("Couldn't update your pantry. Check the browser console for details.");
  }
}

function skipShopModeItem() {
  doneKeys.add(pendingRow.key);
  closeModal();
  render();
}

function closeModal() {
  document.getElementById("modalBackdrop").classList.remove("open");
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadShoppingList();
})();
