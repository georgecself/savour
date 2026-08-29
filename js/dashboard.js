function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMondayIso() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return isoDate(monday);
}

async function loadGreeting() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  try {
    const rows = await supabaseRequest("profiles", { query: `?select=display_name&id=eq.${window.currentUserId}&limit=1` });
    const name = rows[0]?.display_name || (user?.email ? user.email.split("@")[0] : "");
    document.getElementById("greetName").textContent = name ? `, ${name}` : "";
  } catch (error) {
    console.error(error);
  }
}

async function loadStats() {
  const weekStart = getMondayIso();

  const [recipes, pantry, plans, deals] = await Promise.all([
    supabaseRequest("recipes", { query: `?select=id&user_id=eq.${window.currentUserId}` }),
    supabaseRequest("pantry_items", { query: `?select=id&user_id=eq.${window.currentUserId}` }),
    supabaseRequest("meal_plans", { query: `?select=id&week_start=eq.${weekStart}&user_id=eq.${window.currentUserId}&limit=1` }),
    supabaseRequest("product_prices", { query: "?select=id,deal_ends_on&is_deal=eq.true" })
  ]);

  document.getElementById("statRecipeCount").textContent = recipes.length;
  document.getElementById("statPantryCount").textContent = pantry.length;

  let weekCount = 0;
  if (plans.length) {
    const items = await supabaseRequest("meal_plan_items", { query: `?select=id&meal_plan_id=eq.${plans[0].id}` });
    weekCount = items.length;
  }
  document.getElementById("statWeekCount").textContent = weekCount;

  const today = isoDate(new Date());
  const activeDeals = deals.filter(d => !d.deal_ends_on || d.deal_ends_on >= today);
  document.getElementById("statDealCount").textContent = activeDeals.length;
}

(async function init() {
  const uid = await window.authReady;
  if (!uid) return;
  try {
    await Promise.all([loadGreeting(), loadStats()]);
    setShellStatus("ok", "Connected to Supabase");
  } catch (error) {
    console.error(error);
    setShellStatus("error", "Database connection failed");
  }
})();
