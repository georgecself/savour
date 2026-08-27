const state = {
  ingredients: []
};

const els = {
  table: document.getElementById("ingredientTable"),
  search: document.getElementById("searchInput"),
  add: document.getElementById("addIngredientBtn"),
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
        </tr>
      </thead>
      <tbody>
        ${filtered.map(item => `
          <tr>
            <td><strong>${esc(item.name)}</strong></td>
            <td>${esc(item.category)}</td>
            <td>${esc(item.default_unit || "—")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

els.search.addEventListener("input", renderIngredients);

// The ingredient catalog is shared across everyone using the app, so it's
// read-only here to avoid one person's edits silently affecting everyone
// else's recipes. New ingredients get added via the Supabase Table Editor.
if (els.add) {
  els.add.style.display = "none";
}
els.table.insertAdjacentHTML("beforebegin",
  `<p class="meta" style="color:var(--muted); font-size:13px; margin:-8px 0 16px;">
    This is a shared list used across all recipes — it's read-only here. Got something missing? Let George know and he'll add it.
  </p>`
);

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login
  await loadIngredients();
})();
