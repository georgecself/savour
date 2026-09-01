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

const isAdmin = () => window.currentUserId === ADMIN_USER_ID;

// ---------- Loading ----------

async function loadAll() {
  try {
    setShellStatus(undefined, "Loading…");

    const [ingredients, requests] = await Promise.all([
      supabaseRequest("ingredients", { query: "?select=id,name,category,default_unit,is_staple&order=name.asc" }),
      supabaseRequest("ingredient_requests", { query: "?select=id,name,category,default_unit,is_staple,requested_by,created_at&order=created_at.asc" })
    ]);

    state.ingredients = ingredients;
    state.requests = requests;

    renderRequests();
    renderIngredients();
    setShellStatus("ok", "Connected to Supabase");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
    els.table.innerHTML = `<div class="empty-state">Couldn't load ingredients. Check the browser console for details.</div>`;
  }
}

// ---------- Ingredient table (read-only) ----------

function renderIngredients() {
  const term = els.search.value.trim().toLowerCase();
  const filtered = state.ingredients.filter(item =>
    item.name.toLowerCase().includes(term) || (item.category || "").toLowerCase().includes(term)
  );

  if (!filtered.length) {
    els.table.innerHTML = `<div class="empty-state">${term ? "No ingredients match your search." : "No ingredients found."}</div>`;
    return;
  }

  els.table.innerHTML = `
    <table class="ingredient-table">
      <thead><tr><th>Name</th><th>Category</th><th>Default unit</th></tr></thead>
      <tbody>
        ${filtered.map(item => `
          <tr>
            <td><strong>${esc(item.name)}</strong>${item.is_staple ? `<span class="staple-tag">Staple</span>` : ""}</td>
            <td>${esc(item.category || "—")}</td>
            <td>${esc(item.default_unit || "—")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
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
              <div class="request-meta">${esc(r.category || "No category")} · ${esc(r.default_unit || "no default unit")}</div>
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
      body: { name: req.name, category: req.category || "Other", default_unit: req.default_unit || null, is_staple: req.is_staple }
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
