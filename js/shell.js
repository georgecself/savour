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
  { href: "dashboard.html", icon: "dashboard", label: "Dashboard" },
  { href: "index.html", icon: "mealplans", label: "Meal Plans" },
  { href: "recipes.html", icon: "recipes", label: "Recipes" },
  { href: "foods.html", icon: "foods", label: "Foods" },
  { href: "pantry.html", icon: "pantry", label: "Pantry" },
  { href: "shopping.html", icon: "shopping", label: "Shopping" },
  { href: "deal-check.html", icon: "deal", label: "Deal Checker" }
];

const NAV_ICON_SVGS = {
  dashboard: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>`,
  mealplans: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>`,
  recipes: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5c2-1 5-1 7 0v14c-2-1-5-1-7 0V5Z"/><path d="M21 5c-2-1-5-1-7 0v14c2-1 5-1 7 0V5Z"/></svg>`,
  foods: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M9 6v12M15 6v12M3 12h18"/></svg>`,
  pantry: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 12h16"/><path d="M8 3v9M16 3v9"/></svg>`,
  shopping: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h14l-1.5 10a2 2 0 0 1-2 1.7H8.5a2 2 0 0 1-2-1.7L5 9Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></svg>`,
  deal: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 12.6 12 21l-9-9V4h8l9.4 8.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/></svg>`
};

const LOGO_SVG = `<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="13" cy="13" r="12" style="stroke:var(--accent)" stroke-width="2"/>
  <path d="M8 14c0-3 2.2-6 5-6s5 3 5 6-2.2 4-5 4-5-1-5-4Z" style="fill:var(--accent)"/>
  <path d="M13 8V5" style="stroke:var(--accent)" stroke-width="2" stroke-linecap="round"/>
</svg>`;

function currentPageName() {
  return window.location.pathname.split("/").pop() || "index.html";
}

function navLinksHtml() {
  const current = currentPageName();
  return NAV_ITEMS.map(item => `
    <a href="${item.href}" class="${item.href === current ? "active" : ""}">
      <span class="icon">${NAV_ICON_SVGS[item.icon]}</span><span class="nav-label">${item.label}</span>
    </a>
  `).join("");
}

// ---------- Step 1: synchronous structural rebuild (runs immediately) ----------

function buildShellStructure() {
  const originalNodes = Array.from(document.body.childNodes);

  document.body.innerHTML = `
    <div class="mobile-topbar">
      <a href="dashboard.html" class="sidebar-logo">${LOGO_SVG}<span class="sidebar-logo-text">Savour</span></a>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="theme-toggle-btn sidebar-collapse-btn" onclick="toggleTheme()" aria-label="Toggle dark mode" title="Toggle dark mode">${themeToggleIcon()}</button>
        <button class="mobile-menu-btn" onclick="toggleMobileMenu()" aria-label="Menu">☰</button>
      </div>
    </div>

    <div class="mobile-menu-popup" id="mobileMenuPopup" onclick="if(event.target===this)toggleMobileMenu()">
      <div class="mobile-menu-sheet">
        <div class="sidebar-nav">${navLinksHtml()}</div>
        <div id="mobileAdminSlot"></div>
        <div class="sidebar-profile" id="mobileProfileSlot"></div>
      </div>
    </div>

    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-top-row">
          <a href="dashboard.html" class="sidebar-logo">${LOGO_SVG}<span class="sidebar-logo-text">Savour</span></a>
          <div class="sidebar-top-btns">
            <button class="theme-toggle-btn sidebar-collapse-btn" onclick="toggleTheme()" aria-label="Toggle dark mode" title="Toggle dark mode">${themeToggleIcon()}</button>
            <button class="sidebar-collapse-btn" onclick="toggleSidebar()" aria-label="Collapse menu" title="Collapse menu">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
            </button>
          </div>
        </div>
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

  if (localStorage.getItem("savour_sidebar_collapsed") === "true") {
    document.getElementById("sidebar").classList.add("collapsed");
  }
}

buildShellStructure();

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const collapsed = sidebar.classList.toggle("collapsed");
  localStorage.setItem("savour_sidebar_collapsed", collapsed ? "true" : "false");
}

// ---------- Step 2: async data population (profile, admin links, status) ----------

function toggleMobileMenu() {
  document.getElementById("mobileMenuPopup").classList.toggle("open");
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function themeToggleIcon() {
  // Icon shown is what clicking will switch TO.
  return currentTheme() === "dark"
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>`;
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  localStorage.setItem("savour_theme", next);
  document.querySelectorAll(".theme-toggle-btn").forEach(btn => { btn.innerHTML = themeToggleIcon(); });
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
      <div class="sidebar-profile-text">
        <div class="sidebar-profile-name">${esc(name)}</div>
        <div class="sidebar-profile-plan">${esc(plan)}</div>
      </div>
    </button>
  `;
  document.getElementById("profileSlot").innerHTML = profileHtml;
  document.getElementById("mobileProfileSlot").innerHTML = profileHtml;

  const extraLinks = [`<a href="ingredients.html" class="sidebar-extra-link">Ingredients</a>`];
  if (window.currentUserId === ADMIN_USER_ID) {
    extraLinks.push(
      `<a href="recipes-import.html" class="sidebar-extra-link">⬆ Import recipes</a>`,
      `<a href="foods-import.html" class="sidebar-extra-link">⬆ Import foods</a>`,
      `<a href="prices.html" class="sidebar-extra-link">📊 All prices</a>`
    );
  }
  const extrasHtml = `<div class="sidebar-admin-label">More</div>${extraLinks.join("")}`;
  document.getElementById("adminSlot").innerHTML = extrasHtml;
  document.getElementById("mobileAdminSlot").innerHTML = extrasHtml;
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
