async function loadProfileForm() {
  try {
    const rows = await supabaseRequest("profiles", { query: `?select=first_name,last_name,avatar_url,account_type&id=eq.${window.currentUserId}&limit=1` });
    const p = rows[0];
    document.getElementById("sFirstName").value = p?.first_name || "";
    document.getElementById("sLastName").value = p?.last_name || "";
    document.getElementById("sAvatar").value = p?.avatar_url || "";
    document.getElementById("sAccountTypeDisplay").textContent = p?.account_type || "Free";
  } catch (error) {
    console.error(error);
  }
}

async function saveProfile() {
  const first_name = document.getElementById("sFirstName").value.trim() || null;
  const last_name = document.getElementById("sLastName").value.trim() || null;
  const avatar_url = document.getElementById("sAvatar").value.trim() || null;

  try {
    const existing = await supabaseRequest("profiles", { query: `?select=id&id=eq.${window.currentUserId}&limit=1` });
    if (existing.length) {
      // account_type deliberately never sent from here — it's not editable
      // by the user, and the database would reject the change anyway.
      await supabaseRequest("profiles", { method: "PATCH", query: `?id=eq.${window.currentUserId}`, body: { first_name, last_name, avatar_url } });
    } else {
      await supabaseRequest("profiles", { method: "POST", body: { id: window.currentUserId, first_name, last_name, avatar_url, account_type: "Free" } });
    }
    alert("Profile saved.");
    await loadProfileIntoShell();
  } catch (error) {
    console.error(error);
    alert("Couldn't save your profile. Check the browser console for details.");
  }
}

// ---------- Appearance (3-way theme) ----------
// getStoredThemePref() / setThemePref() already live in shell.js, shared
// with the flash-prevention script every page runs.

function renderThemePill() {
  const current = getStoredThemePref();
  const options = [
    { key: "light", label: "Light" },
    { key: "dark", label: "Dark" },
    { key: "system", label: "Match system" }
  ];
  document.getElementById("themePill").innerHTML = options.map(o =>
    `<button class="${current === o.key ? "active" : ""}" onclick="chooseTheme('${o.key}')">${o.label}</button>`
  ).join("");
}

function chooseTheme(pref) {
  setThemePref(pref);
  renderThemePill();
}

// ---------- Password ----------
// Requirements mirror what's set on the Supabase project (uppercase,
// lowercase, digit, min 6 chars) — checked live here to catch mistakes
// before submitting, not just after Supabase rejects it.

const PASSWORD_REQUIREMENTS = [
  { label: "At least 6 characters", test: v => v.length >= 6 },
  { label: "One uppercase letter", test: v => /[A-Z]/.test(v) },
  { label: "One lowercase letter", test: v => /[a-z]/.test(v) },
  { label: "One number", test: v => /[0-9]/.test(v) }
];

function renderPasswordChecklist(value, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = PASSWORD_REQUIREMENTS.map(r => {
    const met = r.test(value);
    return `<div class="req ${met ? "met" : ""}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${met ? '<path d="M20 6L9 17l-5-5"/>' : '<circle cx="12" cy="12" r="9"/>'}</svg>
      ${r.label}
    </div>`;
  }).join("");
}

function passwordMeetsAllRequirements(value) {
  return PASSWORD_REQUIREMENTS.every(r => r.test(value));
}

async function changePassword() {
  const currentPassword = document.getElementById("sCurrentPassword").value;
  const password = document.getElementById("sPassword").value;

  if (!currentPassword) {
    alert("Please enter your current password.");
    return;
  }
  if (!passwordMeetsAllRequirements(password)) {
    alert("Your new password doesn't meet all the requirements yet — check the list under the field.");
    return;
  }

  try {
    // current_password is only actually enforced if that's turned on for
    // this Supabase project — harmless to always send either way.
    const { error } = await supabaseClient.auth.updateUser({ password, current_password: currentPassword });
    if (error) throw error;
    alert("Password updated.");
    document.getElementById("sCurrentPassword").value = "";
    document.getElementById("sPassword").value = "";
    renderPasswordChecklist("", "sPasswordChecklist");
  } catch (error) {
    console.error(error);
    alert("Couldn't update your password: " + (error.message || "unknown error"));
  }
}

async function handleSignOut() {
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return;
  await loadProfileForm();
  renderThemePill();
  setShellStatus("ok", "Connected to Server");
})();
