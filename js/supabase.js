// Shared Supabase connection for Savour.
// This is the publishable frontend key, not a service-role secret.

const SUPABASE_URL = "https://mdmcqodaekzdomxzjnfz.supabase.co";
const SUPABASE_KEY = "sb_publishable_9zPAcpqSza9GYjMOGaT1Eg_AFQQXaxt";

async function supabaseRequest(table, options = {}) {
  const { method = "GET", body, query = "", prefer = "return=representation" } = options;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
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
