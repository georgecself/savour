// auth-guard.js — include on every page EXCEPT login.html.
// Redirects to login.html if there's no session, exposes window.currentUserId,
// and injects a "Sign out" link into the nav bar so no HTML file needs manual
// editing for that.
//
// Page scripts should await window.authReady before loading any data:
//   (async function init() {
//     const uid = await window.authReady;
//     if (!uid) return; // already redirecting to login
//     await loadAll();
//   })();

window.authReady = (async function () {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  window.currentUserId = session.user.id;

  const nav = document.querySelector(".nav");
  if (nav && !document.getElementById("signOutLink")) {
    const link = document.createElement("a");
    link.href = "#";
    link.id = "signOutLink";
    link.textContent = "🚪 Sign out";
    link.onclick = async (e) => {
      e.preventDefault();
      await supabaseClient.auth.signOut();
      window.location.href = "login.html";
    };
    nav.appendChild(link);
  }

  // If the session ends elsewhere (expiry, sign-out in another tab), bounce here too.
  supabaseClient.auth.onAuthStateChange((_event, newSession) => {
    if (!newSession) window.location.href = "login.html";
  });

  return session.user.id;
})();
