const ADMIN_USER_ID = "37926109-b428-45fc-8771-72e16390a649";
let parsedRows = null;

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

function renderDenied() {
  document.getElementById("pageContent").innerHTML = `
    <a href="foods.html" style="display:inline-block; margin-bottom:14px; color:var(--muted); font-size:13px; text-decoration:none;">← Back to foods</a>
    <div class="card import-card">
      <h2 style="margin-top:0;">Not available</h2>
      <p class="meta">Bulk import is restricted for now. Ask George if you've got a batch of foods to add.</p>
    </div>
  `;
}

function renderImporter() {
  document.getElementById("pageContent").innerHTML = `
    <a href="foods.html" style="display:inline-block; margin-bottom:14px; color:var(--muted); font-size:13px; text-decoration:none;">← Back to foods</a>
    <h2>Bulk import foods</h2>

    <div class="card import-card">
      <p class="meta" style="color:var(--muted); font-size:13px;">Upload a CSV with one row per food.</p>
      <p style="margin-top:14px;"><button class="btn" onclick="downloadTemplate()">⬇ Download CSV template</button></p>
      <details style="margin-top:14px;">
        <summary style="cursor:pointer; font-size:13px; color:var(--accent-dark);">Show expected columns</summary>
        <p class="meta" style="font-size:13px; margin-top:10px;">
          <code>name, brand, shopping_category, serving_size, serving_unit, calories, protein_g, carbohydrates_g, fat_g, price, image_url</code><br>
          Only <code>name</code> is required — leave others blank if unknown.
        </p>
      </details>
    </div>

    <div class="card import-card">
      <div class="field">
        <label>CSV file</label>
        <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
          Click to choose a file, or drop it here
          <input type="file" id="fileInput" accept=".csv">
        </div>
        <div id="fileName" class="file-name"></div>
      </div>

      <div class="checkbox-row">
        <input type="checkbox" id="publishCheckbox">
        <label for="publishCheckbox">Publish this batch to the shared library (visible to everyone)</label>
      </div>

      <button class="btn primary" id="importBtn" onclick="runImport()" disabled>Import foods</button>
    </div>

    <div class="card import-card" id="resultsCard" style="display:none;">
      <h3 style="margin-top:0;">Results</h3>
      <div id="summaryBar" class="summary-bar"></div>
      <div id="resultsList" class="results-list"></div>
    </div>
  `;

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
}

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

function downloadTemplate() {
  const csv = Papa.unparse([
    {
      name: "Grenade Protein Bar", brand: "Grenade", shopping_category: "Snacks",
      serving_size: 60, serving_unit: "g", calories: 215, protein_g: 20,
      carbohydrates_g: 15, fat_g: 8, price: 1.5, image_url: ""
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
          image_url: (row.image_url || "").trim() || null,
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
    ${failCount ? `<div class="summary-pill" style="background:#fdf1f0; color:#c0392b;">${failCount} skipped</div>` : ""}
  `;

  document.getElementById("resultsList").innerHTML = results.map(r => `
    <div class="result-row">
      <span class="${r.ok ? "result-ok" : "result-fail"}">${r.ok ? "✓" : "✗"}</span>
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
    setStatus("Connected to Supabase");
    return;
  }

  renderImporter();
  setStatus("Connected to Supabase");
})();
