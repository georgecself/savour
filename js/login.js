let mode = "signin"; // or "signup"

// Mirrors what's set on the Supabase project (uppercase, lowercase, digit,
// min 6 chars) — checked live so people find out before submitting, not
// just from a rejected signup.
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

function onAuthPasswordInput() {
  if (mode === "signup") {
    renderPasswordChecklist(document.getElementById("authPassword").value, "authPasswordChecklist");
  }
}

function showMessage(text, type) {
  const box = document.getElementById("authMessage");
  box.className = `auth-message ${type}`;
  box.textContent = text;
}

function clearMessage() {
  const box = document.getElementById("authMessage");
  box.className = "";
  box.textContent = "";
}

function switchMode() {
  mode = mode === "signin" ? "signup" : "signin";
  clearMessage();

  document.getElementById("nameFields").style.display = mode === "signup" ? "block" : "none";
  document.getElementById("authPasswordChecklist").style.display = mode === "signup" ? "flex" : "none";
  if (mode === "signup") renderPasswordChecklist(document.getElementById("authPassword").value, "authPasswordChecklist");
  document.getElementById("authSubtitle").textContent =
    mode === "signin" ? "Sign in to your account" : "Create an account";
  document.getElementById("authSubmitBtn").textContent =
    mode === "signin" ? "Sign in" : "Sign up";
  document.getElementById("switchModeText").innerHTML =
    mode === "signin"
      ? `Don't have an account? <a onclick="switchMode()">Sign up</a>`
      : `Already have an account? <a onclick="switchMode()">Sign in</a>`;
}

async function handleSubmit() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  clearMessage();

  if (!email || !password) {
    showMessage("Please enter both an email and a password.", "error");
    return;
  }

  const btn = document.getElementById("authSubmitBtn");
  btn.disabled = true;

  try {
    if (mode === "signin") {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = "dashboard.html";
    } else {
      const firstName = document.getElementById("authFirstName").value.trim();
      const lastName = document.getElementById("authLastName").value.trim();

      if (!firstName) {
        showMessage("Please enter your first name.", "error");
        btn.disabled = false;
        return;
      }
      if (!passwordMeetsAllRequirements(password)) {
        showMessage("Your password doesn't meet all the requirements yet — check the list under the field.", "error");
        btn.disabled = false;
        return;
      }

      // Passed as auth metadata rather than written to profiles directly —
      // there's no session yet if email confirmation is required, so we
      // can't satisfy RLS to write a profile row until they actually log
      // in. shell.js picks this metadata up and creates the profile then,
      // whether that's immediately or after confirming days later.
      const { data, error } = await supabaseClient.auth.signUp({
        email, password,
        options: { data: { first_name: firstName, last_name: lastName || null } }
      });
      if (error) throw error;

      if (data.session) {
        window.location.href = "dashboard.html";
      } else {
        showMessage("Account created — check your email to confirm before signing in.", "success");
      }
    }
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Something went wrong.", "error");
  } finally {
    btn.disabled = false;
  }
}

// If already signed in, skip straight past the login page.
(async function checkExistingSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) window.location.href = "dashboard.html";
})();

document.getElementById("authPassword").addEventListener("keydown", e => {
  if (e.key === "Enter") handleSubmit();
});
