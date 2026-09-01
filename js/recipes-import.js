let ingredients = [];
let parsedRows = null;

const RESULT_ICONS = {
  ok: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  fail: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>`
};

function renderDenied() {
  document.querySelector(".import-wrap").innerHTML = `
    <a class="icon-btn" href="recipes.html" title="Back to recipes" aria-label="Back to recipes" style="margin-bottom:16px;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
    </a>
    <div class="card import-card">
      <h2 style="margin-top:0;">Not available</h2>
      <p class="meta">Bulk import is restricted for now. Ask George if you've got a batch of recipes to add.</p>
    </div>
  `;
}

function findIngredientByName(name) {
  const target = name.trim().toLowerCase();
  return ingredients.find(i => i.name.toLowerCase() === target) || null;
}

// ---------- File handling ----------

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");

fileInput.addEventListener("change", () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  document.getElementById("fileName").textContent = `Selected: ${file.name}`;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      parsedRows = results.data;
      document.getElementById("importBtn").disabled = !parsedRows.length;
      document.getElementById("fileName").textContent =
        `Selected: ${file.name} — ${parsedRows.length} row${parsedRows.length === 1 ? "" : "s"} found`;
    },
    error: (error) => {
      console.error(error);
      alert("Couldn't read that CSV. Check the browser console for details.");
    }
  });
}

// ---------- Template download ----------

function downloadTemplate() {
  const csv = Papa.unparse([
    {
      name: "Spaghetti bolognese",
      description: "Weeknight classic",
      servings: 4,
      cooking_time_minutes: 40,
      instructions: "Brown the mince in a large pan.\nAdd onion and garlic, cook until soft.\nStir in chopped tomatoes and simmer 20 minutes.\nServe over cooked spaghetti.",
      image_url: "",
      category: "Dinner",
      ingredients: "500 | Beef mince | g\n1 | Onion | item\n2 | Garlic | clove\n400 | Chopped tomatoes | g\n300 | Spaghetti | g"
    }
  ]);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "savour-recipe-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Per-row parsing/validation ----------

function parseIngredientCell(cell) {
  if (!cell || !cell.trim()) return { rows: [], errors: [] };

  const lines = cell.split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];

  lines.forEach((line, i) => {
    const parts = line.split("|").map(p => p.trim());
    const [qtyRaw, name, unit] = parts;

    if (!name) {
      errors.push(`Ingredient line ${i + 1}: couldn't parse "${line}" (expected "quantity | name | unit")`);
      return;
    }

    const ingredient = findIngredientByName(name);
    if (!ingredient) {
      errors.push(`"${name}" isn't in your Ingredients list`);
      return;
    }

    rows.push({
      ingredient_id: ingredient.id,
      quantity: qtyRaw === "" || qtyRaw === undefined ? null : Number(qtyRaw),
      unit: unit || ingredient.default_unit || null,
      notes: null,
      sort_order: rows.length
    });
  });

  return { rows, errors };
}

function validateRecipeRow(row, index) {
  const name = (row.name || "").trim();
  if (!name) return { valid: false, error: `Row ${index + 1}: missing a recipe name — skipped.` };

  const { rows: ingredientRows, errors: ingredientErrors } = parseIngredientCell(row.ingredients);
  if (ingredientErrors.length) {
    return { valid: false, error: `"${name}": ${ingredientErrors.join("; ")}` };
  }

  return {
    valid: true,
    recipe: {
      name,
      description: (row.description || "").trim() || null,
      servings: Number(row.servings) || 2,
      cooking_time_minutes: Number(row.cooking_time_minutes) || null,
      instructions: (row.instructions || "").trim() || null,
      image_url: (row.image_url || "").trim() || null,
      category: (row.category || "").trim() || null
    },
    ingredientRows
  };
}

// ---------- Import ----------

async function runImport() {
  if (!parsedRows || !parsedRows.length) return;

  const publish = document.getElementById("publishCheckbox").checked;
  const importBtn = document.getElementById("importBtn");
  importBtn.disabled = true;
  importBtn.textContent = "Importing…";

  const results = []; // { name, ok, message }

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const validation = validateRecipeRow(row, i);

    if (!validation.valid) {
      results.push({ name: row.name || `Row ${i + 1}`, ok: false, message: validation.error });
      continue;
    }

    try {
      const created = (await supabaseRequest("recipes", {
        method: "POST",
        body: { ...validation.recipe, user_id: window.currentUserId, is_public: publish }
      }))[0];

      if (validation.ingredientRows.length) {
        try {
          await supabaseRequest("recipe_ingredients", {
            method: "POST",
            body: validation.ingredientRows.map(r => ({ ...r, recipe_id: created.id }))
          });
        } catch (ingredientError) {
          await supabaseRequest("recipes", { method: "DELETE", query: `?id=eq.${created.id}`, prefer: "return=minimal" });
          throw ingredientError;
        }
      }

      results.push({ name: validation.recipe.name, ok: true, message: `Imported (${validation.ingredientRows.length} ingredients)` });
    } catch (error) {
      console.error(error);
      results.push({ name: validation.recipe.name, ok: false, message: `Database error: ${error.message || "unknown"}` });
    }
  }

  renderResults(results);
  importBtn.disabled = false;
  importBtn.textContent = "Import recipes";
}

function renderResults(results) {
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;

  document.getElementById("summaryBar").innerHTML = `
    <div class="summary-pill">${okCount} imported</div>
    ${failCount ? `<div class="summary-pill fail">${failCount} skipped</div>` : ""}
  `;

  document.getElementById("resultsList").innerHTML = results.map(r => `
    <div class="result-row">
      <span class="result-icon ${r.ok ? "result-ok" : "result-fail"}">${r.ok ? RESULT_ICONS.ok : RESULT_ICONS.fail}</span>
      <span><strong>${esc(r.name)}</strong> — ${esc(r.message)}</span>
    </div>
  `).join("");

  document.getElementById("resultsCard").style.display = "block";
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return; // redirecting to login

  if (uid !== ADMIN_USER_ID) {
    renderDenied();
    setShellStatus("ok", "Connected to Server");
    return;
  }

  try {
    ingredients = await supabaseRequest("ingredients", { query: "?select=id,name,default_unit&order=name.asc" });
    setShellStatus("ok", "Connected to Server");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
  }
})();
