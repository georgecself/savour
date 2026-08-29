// shell.js — builds the sidebar (desktop) / top bar + popup (mobile) shell.
//
// Include this script tag EARLY in the page — right after auth-guard.js and
// BEFORE the page's own script. The structural rebuild below runs
// synchronously and immediately (no await), so it always finishes before
// the next <script> tag starts running. It works by RELOCATING the
// existing body content into the new layout (not re-stringifying it),
// which is what keeps any event listeners the page's own script attaches
// intact regardless of whether that script runs before or after this.
//
// Nothing else needs to change in a page — no wrapper div required, this
// just picks up whatever was already in <body>.

const ADMIN_USER_ID = "37926109-b428-45fc-8771-72e16390a649";

const NAV_ITEMS = [
  { href: "dashboard.html", icon: "🏠", label: "Dashboard" },
  { href: "index.html", icon: "📅", label: "Week" },
  { href: "recipes.html", icon: "🍳", label: "Recipes" },
  { href: "ingredients.html", icon: "🥕", label: "Ingredients" },
  { href: "foods.html", icon: "🥫", label: "Foods" },
  { href: "shopping.html", icon: "🛒", label: "Shopping" },
  { href: "pantry.html", icon: "📦", label: "Pantry" },
  { href: "deal-check.html", icon: "🎯", label: "Deal Check" }
];

const LOGO_SVG = `<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="13" cy="13" r="12" stroke="#4B5D32" stroke-width="2"/>
  <path d="M8 14c0-3 2.2-6 5-6s5 3 5 6-2.2 4-5 4-5-1-5-4Z" fill="#4B5D32"/>
  <path d="M13 8V5" stroke="#4B5D32" stroke-width="2" stroke-linecap="round"/>
</svg>`;

function currentPageName() {
  return window.location.pathname.split("/").pop() || "index.html";
}

function navLinksHtml() {
  const current = currentPageName();
  return NAV_ITEMS.map(item => `
    <a href="${item.href}" class="${item.href === current ? "active" : ""}">
      <span class="icon">${item.icon}</span>${item.label}
    </a>
  `).join("");
}

// ---------- Step 1: synchronous structural rebuild (runs immediately) ----------

function buildShellStructure() {
  const originalNodes = Array.from(document.body.childNodes);

  document.body.innerHTML = `
    <div class="mobile-topbar">
      <a href="dashboard.html" class="sidebar-logo">${LOGO_SVG}<span class="sidebar-logo-text">Savour</span></a>
      <button class="mobile-menu-btn" onclick="toggleMobileMenu()" aria-label="Menu">☰</button>
    </div>

    <div class="mobile-menu-popup" id="mobileMenuPopup" onclick="if(event.target===this)toggleMobileMenu()">
      <div class="mobile-menu-sheet">
        <div class="sidebar-nav">${navLinksHtml()}</div>
        <div id="mobileAdminSlot"></div>
        <div class="sidebar-profile" id="mobileProfileSlot"></div>
      </div>
    </div>

    <div class="app-shell">
      <aside class="sidebar">
        <a href="dashboard.html" class="sidebar-logo">${LOGO_SVG}<span class="sidebar-logo-text">Savour</span></a>
        <nav class="sidebar-nav">${navLinksHtml()}</nav>
        <div id="adminSlot"></div>
        <div class="sidebar-profile" id="profileSlot"></div>
        <div class="status-dot-row" id="statusDotRow" title="Connecting…">
          <span class="status-dot" id="statusDot"></span>
          <span id="statusDotText">Connecting…</span>
        </div>
      </aside>
      <main class="app-main">
        <div id="shellMainSlot"></div>
      </main>
    </div>
  `;

  const slot = document.getElementById("shellMainSlot");
  originalNodes.forEach(node => slot.appendChild(node));
}

buildShellStructure();

// ---------- Step 2: async data population (profile, admin links, status) ----------

function toggleMobileMenu() {
  document.getElementById("mobileMenuPopup").classList.toggle("open");
}

function initials(name, email) {
  if (name && name.trim()) {
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  }
  return (email || "?")[0].toUpperCase();
}

async function loadProfileIntoShell() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  let profile = null;
  try {
    const rows = await supabaseRequest("profiles", { query: `?select=display_name,avatar_url,account_type&id=eq.${window.currentUserId}&limit=1` });
    profile = rows[0] || null;
  } catch (error) {
    console.error(error);
  }

  const name = profile?.display_name || (user?.email ? user.email.split("@")[0] : "Account");
  const plan = profile?.account_type || "Free";
  const avatarInner = profile?.avatar_url
    ? `<img src="${profile.avatar_url}" alt="" onerror="this.parentElement.textContent='${initials(profile?.display_name, user?.email)}'">`
    : initials(profile?.display_name, user?.email);

  const profileHtml = `
    <button class="sidebar-profile-btn" onclick="window.location.href='settings.html'">
      <div class="sidebar-avatar">${avatarInner}</div>
      <div>
        <div class="sidebar-profile-name">${esc(name)}</div>
        <div class="sidebar-profile-plan">${esc(plan)}</div>
      </div>
    </button>
  `;
  document.getElementById("profileSlot").innerHTML = profileHtml;
  document.getElementById("mobileProfileSlot").innerHTML = profileHtml;

  if (window.currentUserId === ADMIN_USER_ID) {
    const adminHtml = `<div class="sidebar-admin-label">Admin</div>
      <a href="recipes-import.html" style="display:block; padding:8px 10px; font-size:13px; color:var(--muted); text-decoration:none;">⬆ Import recipes</a>
      <a href="foods-import.html" style="display:block; padding:8px 10px; font-size:13px; color:var(--muted); text-decoration:none;">⬆ Import foods</a>
      <a href="prices.html" style="display:block; padding:8px 10px; font-size:13px; color:var(--muted); text-decoration:none;">📊 All prices</a>`;
    document.getElementById("adminSlot").innerHTML = adminHtml;
    document.getElementById("mobileAdminSlot").innerHTML = adminHtml;
  }
}

function setShellStatus(state, text) {
  const dot = document.getElementById("statusDot");
  const label = document.getElementById("statusDotText");
  const row = document.getElementById("statusDotRow");
  if (!dot) return;
  dot.className = "status-dot" + (state === "ok" ? " ok" : state === "error" ? " error" : "");
  const message = text || (state === "ok" ? "Connected" : state === "error" ? "Connection issue" : "Connecting…");
  if (label) label.textContent = message;
  if (row) row.title = message;
}

(async function initShellData() {
  const uid = await window.authReady;
  if (!uid) return;
  await loadProfileIntoShell();
  setShellStatus("ok", "Connected to Supabase");
})();
