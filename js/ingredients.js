const INGREDIENT_CATEGORIES = ["Meat", "Fruit & Veg", "Dairy", "Tinned & Dry", "Frozen", "Snacks", "Drinks", "Herbs & Spices", "Other"];

const state = {
  ingredients: [],
  requests: []
};

const els = {
  table: document.getElementById("ingredientTable"),
  search: document.getElementById("searchInput"),
  requestBtn: document.getElementById("requestBtn"),
  requestsContainer: document.getElementById("requestsContainer"),
  modal: document.getElementById("modal"),
  modalBackdrop: document.getElementById("modalBackdrop")
};

const ICONS = {
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`
};

const isAdmin = () => window.currentUserId === ADMIN_USER_ID;

// grams_per_ml is stored as a true density (g/mL) but presented to people
// as "grams per tablespoon" since that's a far more familiar reference
// point for cooking than a formal density figure.
function gramsPerMlToTbsp(gramsPerMl) {
  return gramsPerMl ? Math.round(gramsPerMl * 15 * 100) / 100 : "";
}
function tbspInputToGramsPerMl(value) {
  const trimmed = String(value).trim();
  return trimmed === "" ? null : Number(trimmed) / 15;
}

// ---------- Loading ----------

async function loadAll() {
  try {
    setShellStatus(undefined, "Loading…");

    const [ingredients, requests] = await Promise.all([
      supabaseRequest("ingredients", { query: "?select=id,name,category,default_unit,is_staple,grams_per_ml&order=name.asc" }),
      supabaseRequest("ingredient_requests", { query: "?select=id,name,category,default_unit,is_staple,grams_per_ml,requested_by,created_at&order=created_at.asc" })
    ]);

    state.ingredients = ingredients;
    state.requests = requests;

    renderRequests();
    renderIngredients();
    setShellStatus("ok", "Connected to Server");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
    els.table.innerHTML = `<div class="empty-state">Couldn't load ingredients. Check the browser console for details.</div>`;
  }
}

// ---------- Ingredient table (view-only, plus an admin-only edit action) ----------

function renderIngredients() {
  const term = els.search.value.trim().toLowerCase();
  const filtered = state.ingredients.filter(item =>
    item.name.toLowerCase().includes(term) || (item.category || "").toLowerCase().includes(term)
  );

  if (!filtered.length) {
    els.table.innerHTML = `<div class="empty-state">${term ? "No ingredients match your search." : "No ingredients found."}</div>`;
    return;
  }

  const admin = isAdmin();

  els.table.innerHTML = `
    <table class="ingredient-table">
      <thead><tr><th>Name</th><th>Category</th><th>Default unit</th><th>≈g per tbsp</th>${admin ? "<th></th>" : ""}</tr></thead>
      <tbody>
        ${filtered.map(item => `
          <tr>
            <td><strong>${esc(item.name)}</strong>${item.is_staple ? `<span class="staple-tag">Staple</span>` : ""}</td>
            <td>${esc(item.category || "—")}</td>
            <td>${esc(item.default_unit || "—")}</td>
            <td>${item.grams_per_ml ? gramsPerMlToTbsp(item.grams_per_ml) : "—"}</td>
            ${admin ? `
              <td>
                <button class="row-icon-btn" onclick="openEditIngredientModal('${item.id}')" title="Edit" aria-label="Edit">${ICONS.edit}</button>
              </td>
            ` : ""}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function openEditIngredientModal(id) {
  const item = state.ingredients.find(i => i.id === id);
  if (!item) return;

  els.modal.innerHTML = `
    <h2>Edit ingredient</h2>
    <div class="field"><label>Name</label><input id="eiName" value="${esc(item.name)}"></div>
    <div class="field">
      <label>Category</label>
      <select id="eiCategory">
        ${INGREDIENT_CATEGORIES.map(c => `<option ${item.category === c ? "selected" : ""}>${c}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>Default unit</label><input id="eiUnit" value="${esc(item.default_unit || "")}" placeholder="e.g. g, item, tin"></div>
    <div class="field">
      <label>≈ grams per tablespoon (optional)</label>
      <input id="eiGramsPerTbsp" type="number" step="any" min="0" value="${gramsPerMlToTbsp(item.grams_per_ml)}" placeholder="e.g. 12">
      <p class="meta" style="margin-top:6px; margin-bottom:0;">Lets the shopping list and pantry understand weight amounts (grams) against volume amounts (tablespoons) for this ingredient. Leave blank if you're not sure — nothing breaks without it, it's just used opportunistically where it's set.</p>
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="eiStaple" ${item.is_staple ? "checked" : ""}>
      <label for="eiStaple">This is a staple</label>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" style="border-radius:999px;" onclick="saveEditIngredient('${id}')">Save</button>
    </div>
  `;
  els.modalBackdrop.classList.add("open");
}

async function saveEditIngredient(id) {
  const name = document.getElementById("eiName").value.trim();
  if (!name) { alert("Please give it a name."); return; }

  const body = {
    name,
    category: document.getElementById("eiCategory").value,
    default_unit: document.getElementById("eiUnit").value.trim() || null,
    is_staple: document.getElementById("eiStaple").checked,
    grams_per_ml: tbspInputToGramsPerMl(document.getElementById("eiGramsPerTbsp").value)
  };

  try {
    await supabaseRequest("ingredients", { method: "PATCH", query: `?id=eq.${id}`, body });
    closeModal();
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't save that change. Check the browser console for details.");
  }
}

// ---------- Pending requests (visible to everyone; only admin can approve/reject) ----------

function renderRequests() {
  if (!state.requests.length) {
    els.requestsContainer.innerHTML = "";
    return;
  }

  const admin = isAdmin();

  els.requestsContainer.innerHTML = `
    <div class="requests-section">
      <h3>Pending requests (${state.requests.length})</h3>
      <div class="card requests-card reminder">
        ${state.requests.map(r => `
          <div class="request-row">
            <div class="request-info">
              <div class="request-name">${esc(r.name)}${r.is_staple ? `<span class="staple-tag">Staple</span>` : ""}</div>
              <div class="request-meta">${esc(r.category || "No category")} · ${esc(r.default_unit || "no default unit")}${r.grams_per_ml ? ` · ≈${gramsPerMlToTbsp(r.grams_per_ml)}g/tbsp` : ""}</div>
            </div>
            ${admin ? `
              <div class="request-actions">
                <button class="row-icon-btn approve" onclick="approveRequest('${r.id}')" title="Approve" aria-label="Approve">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                </button>
                <button class="row-icon-btn reject" onclick="rejectRequest('${r.id}')" title="Reject" aria-label="Reject">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                </button>
              </div>
            ` : ""}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

async function approveRequest(id) {
  const req = state.requests.find(r => r.id === id);
  if (!req) return;

  try {
    await supabaseRequest("ingredients", {
      method: "POST",
      body: {
        name: req.name, category: req.category || "Other", default_unit: req.default_unit || null,
        is_staple: req.is_staple, grams_per_ml: req.grams_per_ml || null
      }
    });
    await supabaseRequest("ingredient_requests", { method: "DELETE", query: `?id=eq.${id}`, prefer: "return=minimal" });
    await loadAll();
  } catch (error) {
    console.error(error);
    if (String(error.message || "").toLowerCase().includes("duplicate")) {
      alert(`"${req.name}" already exists in the ingredients list — you may want to just reject this request instead.`);
    } else {
      alert("Couldn't approve that request. Check the browser console for details.");
    }
  }
}

async function rejectRequest(id) {
  if (!confirm("Reject and remove this request?")) return;
  try {
    await supabaseRequest("ingredient_requests", { method: "DELETE", query: `?id=eq.${id}`, prefer: "return=minimal" });
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't reject that request. Check the browser console for details.");
  }
}

// ---------- Request form (anyone can submit) ----------

function openRequestModal() {
  els.modal.innerHTML = `
    <h2>Request an ingredient</h2>
    <p class="meta">This goes into a review queue — once approved it'll appear in the shared ingredients list.</p>
    <div class="field">
      <label>Name</label>
      <input id="rqName" placeholder="e.g. Smoked paprika">
    </div>
    <div class="field">
      <label>Category</label>
      <select id="rqCategory">
        ${INGREDIENT_CATEGORIES.map(c => `<option ${c === "Other" ? "selected" : ""}>${c}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label>Default unit</label>
      <input id="rqUnit" placeholder="e.g. g, item, tin">
    </div>
    <div class="field">
      <label>≈ grams per tablespoon (optional)</label>
      <input id="rqGramsPerTbsp" type="number" step="any" min="0" placeholder="e.g. 12">
      <p class="meta" style="margin-top:6px; margin-bottom:0;">Only if you know it — lets the shopping list understand weight amounts (grams) against volume amounts (tablespoons) for this ingredient. Leave blank if unsure.</p>
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="rqStaple">
      <label for="rqStaple">This is a staple (something most people already have — salt, oil, flour, etc.)</label>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary" style="border-radius:999px;" onclick="submitRequest()">Send request</button>
    </div>
  `;
  els.modalBackdrop.classList.add("open");
}

async function submitRequest() {
  const name = document.getElementById("rqName").value.trim();
  if (!name) { alert("Please give it a name."); return; }

  const body = {
    name,
    category: document.getElementById("rqCategory").value,
    default_unit: document.getElementById("rqUnit").value.trim() || null,
    grams_per_ml: tbspInputToGramsPerMl(document.getElementById("rqGramsPerTbsp").value),
    is_staple: document.getElementById("rqStaple").checked,
    requested_by: window.currentUserId
  };

  try {
    await supabaseRequest("ingredient_requests", { method: "POST", body });
    closeModal();
    alert("Request sent — thanks! It'll show up in the pending list until it's reviewed.");
    await loadAll();
  } catch (error) {
    console.error(error);
    alert("Couldn't send that request. Check the browser console for details.");
  }
}

function closeModal() {
  els.modalBackdrop.classList.remove("open");
}

els.search.addEventListener("input", renderIngredients);
els.requestBtn.addEventListener("click", openRequestModal);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadAll();
})();
