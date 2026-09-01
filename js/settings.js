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

// ---------- Password / sign out ----------

async function changePassword() {
  const password = document.getElementById("sPassword").value;
  if (!password || password.length < 6) {
    alert("Password must be at least 6 characters.");
    return;
  }
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    alert("Password updated.");
    document.getElementById("sPassword").value = "";
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
