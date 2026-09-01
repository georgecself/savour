let parsedRows = null;

const RESULT_ICONS = {
  ok: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  fail: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>`
};

function renderDenied() {
  document.querySelector(".import-wrap").innerHTML = `
    <a class="icon-btn" href="foods.html" title="Back to foods" aria-label="Back to foods" style="margin-bottom:16px;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
    </a>
    <div class="card import-card">
      <h2 style="margin-top:0;">Not available</h2>
      <p class="meta">Bulk import is restricted for now. Ask George if you've got a batch of foods to add.</p>
    </div>
  `;
}

// ---------- File handling ----------

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");

fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });
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
      name: "Grenade Protein Bar", brand: "Grenade", shopping_category: "Snacks",
      serving_size: 60, serving_unit: "g", calories: 215, protein_g: 20,
      carbohydrates_g: 15, fat_g: 8, price: 1.5
    }
  ]);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "savour-food-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function numOrNull(value) {
  return value === undefined || value === null || value === "" ? null : Number(value);
}

// ---------- Import ----------

async function runImport() {
  if (!parsedRows || !parsedRows.length) return;

  const publish = document.getElementById("publishCheckbox").checked;
  const importBtn = document.getElementById("importBtn");
  importBtn.disabled = true;
  importBtn.textContent = "Importing…";

  const results = [];

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const name = (row.name || "").trim();

    if (!name) {
      results.push({ name: `Row ${i + 1}`, ok: false, message: "Missing a name — skipped." });
      continue;
    }

    try {
      await supabaseRequest("foods", {
        method: "POST",
        body: {
          name,
          brand: (row.brand || "").trim() || null,
          shopping_category: (row.shopping_category || "").trim() || "Other",
          serving_size: numOrNull(row.serving_size),
          serving_unit: (row.serving_unit || "").trim() || null,
          calories: numOrNull(row.calories),
          protein_g: numOrNull(row.protein_g),
          carbohydrates_g: numOrNull(row.carbohydrates_g),
          fat_g: numOrNull(row.fat_g),
          price: numOrNull(row.price),
          user_id: window.currentUserId,
          is_public: publish
        }
      });
      results.push({ name, ok: true, message: "Imported" });
    } catch (error) {
      console.error(error);
      results.push({ name, ok: false, message: `Database error: ${error.message || "unknown"}` });
    }
  }

  renderResults(results);
  importBtn.disabled = false;
  importBtn.textContent = "Import foods";
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

  setShellStatus("ok", "Connected to Server");
})();
