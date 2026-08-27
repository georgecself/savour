// Shared Supabase connection for Savour.
// Uses the official supabase-js client (loaded via CDN in each HTML page)
// so that logged-in requests automatically carry the user's session token —
// which is what lets Row Level Security scope data to the right person.
const SUPABASE_URL = "https://mdmcqodaekzdomxzjnfz.supabase.co";
const SUPABASE_KEY = "sb_publishable_9zPAcpqSza9GYjMOGaT1Eg_AFQQXaxt"; // publishable key, safe to expose client-side

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function supabaseRequest(table, options = {}) {
  const { method = "GET", body, query = "", prefer = "return=representation" } = options;

  // If logged in, use the user's own access token so RLS policies apply
  // correctly. Falls back to the publishable key (e.g. on the login page).
  const { data: { session } } = await supabaseClient.auth.getSession();
  const token = session ? session.access_token : SUPABASE_KEY;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": prefer
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}
