async function loadProfileForm() {
  try {
    const rows = await supabaseRequest("profiles", { query: `?select=display_name,avatar_url,account_type&id=eq.${window.currentUserId}&limit=1` });
    const p = rows[0];
    document.getElementById("sName").value = p?.display_name || "";
    document.getElementById("sAvatar").value = p?.avatar_url || "";
    document.getElementById("sAccountType").value = p?.account_type || "Free";
  } catch (error) {
    console.error(error);
  }
}

async function saveProfile() {
  const display_name = document.getElementById("sName").value.trim() || null;
  const avatar_url = document.getElementById("sAvatar").value.trim() || null;
  const account_type = document.getElementById("sAccountType").value.trim() || "Free";

  try {
    const existing = await supabaseRequest("profiles", { query: `?select=id&id=eq.${window.currentUserId}&limit=1` });
    if (existing.length) {
      await supabaseRequest("profiles", { method: "PATCH", query: `?id=eq.${window.currentUserId}`, body: { display_name, avatar_url, account_type } });
    } else {
      await supabaseRequest("profiles", { method: "POST", body: { id: window.currentUserId, display_name, avatar_url, account_type } });
    }
    alert("Profile saved.");
    await loadProfileIntoShell();
  } catch (error) {
    console.error(error);
    alert("Couldn't save your profile. Check the browser console for details.");
  }
}

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
  setShellStatus("ok", "Connected to Supabase");
})();
