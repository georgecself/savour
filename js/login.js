let mode = "signin"; // or "signup"

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
      window.location.href = "index.html";
    } else {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;

      if (data.session) {
        // Email confirmation is off — signed in immediately.
        window.location.href = "index.html";
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
  if (session) window.location.href = "index.html";
})();

document.getElementById("authPassword").addEventListener("keydown", e => {
  if (e.key === "Enter") handleSubmit();
});
