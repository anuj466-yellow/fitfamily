import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";

// ═══════════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════
const GOALS = [
  "Lose Weight",
  "Gain Muscle",
  "Maintain Weight",
  "Improve Fitness",
  "Increase Stamina",
];
const ACTIVITY_LEVELS = [
  { label: "Sedentary (desk job, no exercise)", value: 1.2 },
  { label: "Lightly Active (1–3 days/week)", value: 1.375 },
  { label: "Moderately Active (3–5 days/week)", value: 1.55 },
  { label: "Very Active (6–7 days/week)", value: 1.725 },
];
const MOODS = ["Excellent", "Good", "Okay", "Tired", "Stressed", "Bad"];

function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function weekStart() {
  const d = new Date();
  const day = d.getDay();
  return new Date(
    new Date().setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  )
    .toISOString()
    .split("T")[0];
}
function calcBMR(w, h, a, g) {
  return g === "male"
    ? 10 * w + 6.25 * h - 5 * a + 5
    : 10 * w + 6.25 * h - 5 * a - 161;
}
function calcTDEE(w, h, a, g, act) {
  return Math.round(calcBMR(w, h, a, g) * act);
}
function calcTarget(tdee, goal) {
  if (goal === "Lose Weight") return tdee - 500;
  if (goal === "Gain Muscle") return tdee + 300;
  return tdee;
}
function calcBMI(w, h) {
  return (w / (h / 100) ** 2).toFixed(1);
}
function bmiCat(bmi) {
  const b = +bmi;
  if (b < 18.5) return { label: "Underweight", c: "#60a5fa" };
  if (b < 25) return { label: "Normal", c: "#22c55e" };
  if (b < 30) return { label: "Overweight", c: "#fbbf24" };
  return { label: "Obese", c: "#ef4444" };
}
function pTarget(w, goal) {
  return goal === "Gain Muscle"
    ? Math.round(w * 2.2)
    : goal === "Lose Weight"
    ? Math.round(w * 2)
    : Math.round(w * 1.6);
}
function cTarget(tdee, goal) {
  return Math.round(calcTarget(tdee, goal) * 0.45 / 4);
}
function fTarget(tdee, goal) {
  return Math.round(calcTarget(tdee, goal) * 0.25 / 9);
}
function calcPts(log, user) {
  if (!log) return 0;
  let p = 0;
  const w = log.water || 0,
    sl = log.sleep || 0;
  if (w >= 8) p += 20;
  else if (w >= 6) p += 10;
  else if (w >= 4) p += 5;
  if (sl >= 7) p += 20;
  else if (sl >= 6) p += 10;
  if (log.exercise && log.exercise.trim().length > 3) p += 30;
  const meals = Array.isArray(log.meals) ? log.meals : [];
  if (meals.length > 0) p += 5;
  if (user && meals.length > 0) {
    const tdee = calcTDEE(
      user.weight,
      user.height,
      user.age,
      user.gender,
      user.activity
    );
    const tgt = calcTarget(tdee, user.goal);
    const pt = pTarget(user.weight, user.goal);
    const totalCal = meals.reduce(
      (s, m) => s + (m.nutrition?.calories || 0),
      0
    );
    const totalPro = meals.reduce(
      (s, m) => s + (m.nutrition?.protein || 0),
      0
    );
    if (totalCal > 0 && Math.abs(totalCal - tgt) < 300) p += 15;
    if (totalPro > 0 && totalPro >= pt * 0.8) p += 15;
  }
  return Math.max(0, p);
}
function dayColor(log, user) {
  if (!log) return null;
  const p = calcPts(log, user);
  return p >= 60 ? "#22c55e" : p >= 35 ? "#fbbf24" : "#ef4444";
}
function getDaysInMonth(yr, mo) {
  const days = [];
  const d = new Date(yr, mo, 1);
  while (d.getMonth() === mo) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ═══════════════════════════════════════════════════
// SUPABASE DB HELPERS
// ═══════════════════════════════════════════════════
async function dbLogin(username, password) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", username)
    .eq("password", password)
    .single();
  if (error || !data) throw new Error("Invalid credentials");
  return data;
}
async function dbGetAllUsers() {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_admin", false)
    .order("name");
  return data || [];
}
async function dbCreateUser(user) {
  const { error } = await supabase.from("profiles").insert(user);
  if (error) throw new Error(error.message);
}
async function dbDeleteUser(id) {
  await supabase.from("profiles").delete().eq("id", id);
}
async function dbGetLog(userId, date) {
  const { data } = await supabase
    .from("daily_logs")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .single();
  return data;
}
async function dbSaveLog(userId, date, logData) {
  const { error } = await supabase
    .from("daily_logs")
    .upsert({ user_id: userId, date, ...logData }, { onConflict: "user_id,date" });
  if (error) throw new Error(error.message);
}
async function dbGetAllLogs(userId) {
  const { data } = await supabase
    .from("daily_logs")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false });
  return data || [];
}
async function dbGetWeight(userId, date) {
  const { data } = await supabase
    .from("weight_logs")
    .select("weight")
    .eq("user_id", userId)
    .eq("date", date)
    .single();
  return data?.weight || null;
}
async function dbSaveWeight(userId, date, weight) {
  await supabase
    .from("weight_logs")
    .upsert({ user_id: userId, date, weight }, { onConflict: "user_id,date" });
}
async function dbGetAllWeights(userId) {
  const { data } = await supabase
    .from("weight_logs")
    .select("*")
    .eq("user_id", userId)
    .order("date");
  return data || [];
}
async function dbGetMeasurement(userId, week) {
  const { data } = await supabase
    .from("measurements")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start", week)
    .single();
  return data;
}
async function dbSaveMeasurement(userId, week, meas) {
  await supabase
    .from("measurements")
    .upsert(
      { user_id: userId, week_start: week, ...meas },
      { onConflict: "user_id,week_start" }
    );
}
async function dbGetAllMeasurements(userId) {
  const { data } = await supabase
    .from("measurements")
    .select("*")
    .eq("user_id", userId)
    .order("week_start", { ascending: false });
  return data || [];
}
async function dbGetNotifTime(userId) {
  const { data } = await supabase
    .from("notifications")
    .select("notif_time")
    .eq("user_id", userId)
    .single();
  return data?.notif_time || "";
}
async function dbSaveNotifTime(userId, time) {
  await supabase
    .from("notifications")
    .upsert({ user_id: userId, notif_time: time }, { onConflict: "user_id" });
}
async function dbGetWeeklyPoints(users, weekStartDate) {
  if (!users.length) return {};
  const ids = users.map((u) => u.id);
  const { data } = await supabase
    .from("daily_logs")
    .select("user_id,meals,exercise,water,sleep")
    .gte("date", weekStartDate)
    .in("user_id", ids);
  const pts = {};
  ids.forEach((id) => (pts[id] = 0));
  (data || []).forEach((log) => {
    const u = users.find((u) => u.id === log.user_id);
    pts[log.user_id] = (pts[log.user_id] || 0) + calcPts(log, u);
  });
  return pts;
}

// ═══════════════════════════════════════════════════
// AI FUNCTIONS
// ═══════════════════════════════════════════════════
async function callClaude(prompt, maxTokens = 1000) {
  // Use /api/claude proxy in production, direct call in development
  const url = process.env.NODE_ENV === 'production'
    ? '/api/claude'
    : 'https://api.anthropic.com/v1/messages';

  const headers = { "Content-Type": "application/json" };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const e = await res.text();
    throw new Error(`API ${res.status}: ${e}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function estimateMealNutrition(mealText) {
  const raw = await callClaude(
    `Nutrition expert. Estimate macros for: "${mealText}"
Reply with ONLY raw JSON, no markdown:
{"calories":0,"protein":0,"carbs":0,"fats":0,"items":[{"name":"food","calories":0,"protein":0,"carbs":0,"fats":0}],"note":""}
Reference: 1 egg=70cal/6gP/0gC/5gF, 1 roti=80cal/3gP/15gC/1gF, 1 cup rice=200cal/4gP/44gC/0gF, 1 bowl dal=130cal/8gP/20gC/1gF, 1 scoop whey=120cal/25gP/3gC/1gF, 100g chicken=165cal/31gP/0gC/3gF, 1 bowl sabzi=100cal/3gP/12gC/4gF, 1 glass milk=150cal/8gP/12gC/8gF, 1 banana=90cal/1gP/23gC/0gF`,
    500
  );
  const s = raw.indexOf("{"),
    e = raw.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("Bad JSON from AI");
  return JSON.parse(raw.slice(s, e + 1));
}

async function generateReport(
  user,
  mealsList,
  exercise,
  water,
  sleep,
  mood,
  notes,
  tCal,
  pTgt,
  cTgt,
  fTgt,
  streak
) {
  const totalCal = mealsList.reduce(
    (s, m) => s + (m.nutrition?.calories || 0),
    0
  );
  const totalPro = mealsList.reduce(
    (s, m) => s + (m.nutrition?.protein || 0),
    0
  );
  const totalCarb = mealsList.reduce(
    (s, m) => s + (m.nutrition?.carbs || 0),
    0
  );
  const totalFat = mealsList.reduce(
    (s, m) => s + (m.nutrition?.fats || 0),
    0
  );
  const mealsDesc =
    mealsList.length > 0
      ? mealsList
          .map(
            (m, i) =>
              `Meal ${i + 1}: ${m.description} → ${
                m.nutrition?.calories || 0
              }kcal, P:${m.nutrition?.protein || 0}g`
          )
          .join("\n")
      : "No meals logged";

  return await callClaude(
    `You are a warm Indian health coach. Write a daily health report.
User: ${user.name}, ${user.age}y, ${user.weight}kg, Goal: ${user.goal}
Daily targets: ${tCal}kcal | Protein ${pTgt}g | Carbs ${cTgt}g | Fats ${fTgt}g
Meals: ${mealsDesc}
Totals: ${totalCal}kcal, ${totalPro}g protein, ${totalCarb}g carbs, ${totalFat}g fats
Exercise: ${exercise || "none"} | Water: ${water}gl | Sleep: ${sleep}h | Mood: ${mood} | Streak: ${streak}d
Notes: ${notes || "none"}

Write with these EXACT headers:
🌅 DAILY SUMMARY
✅ GOOD HIGHLIGHTS
⚠️ AREAS TO IMPROVE
🍽️ NUTRITION VERDICT
💪 EXERCISE VERDICT
🎯 GOAL PROGRESS
📋 TOMORROW'S FOCUS

Warm, Indian-context, specific. Max 350 words.`,
    1000
  );
}

// ═══════════════════════════════════════════════════
// NOTIFICATION HELPER
// ═══════════════════════════════════════════════════
function checkNotif(userId, timeStr) {
  if (
    !timeStr ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  )
    return;
  const [h, m] = timeStr.split(":").map(Number);
  const now = new Date(),
    target = new Date();
  target.setHours(h, m, 0, 0);
  const lastKey = `notif_last_${userId}`;
  if (
    Math.abs(now - target) < 60000 &&
    localStorage.getItem(lastKey) !== todayStr()
  ) {
    new Notification("⚖️ FitFamily — Time to weigh in!", {
      body: "Log your weight to track progress 💪",
    });
    localStorage.setItem(lastKey, todayStr());
  }
}

// ═══════════════════════════════════════════════════
// STYLES (defined once at module level — never recreated)
// ═══════════════════════════════════════════════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
input:focus,select:focus,textarea:focus{outline:none!important;border-color:rgba(251,191,36,0.5)!important;}
button:active{transform:scale(0.97);}
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-thumb{background:rgba(251,191,36,0.2);border-radius:4px;}
`;
const BG =
  "radial-gradient(ellipse at 20% 60%, #0a2010 0%, #060c08 65%, #0a1812 100%)";
const IS = {
  width: "100%",
  padding: "10px 13px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 9,
  color: "#fff",
  fontSize: 14,
  fontFamily: "'DM Sans',sans-serif",
  boxSizing: "border-box",
};
const TS = { ...IS, resize: "vertical", minHeight: 80 };
const SS = { ...IS, background: "#0d1f0d" };
const CARD = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
};
const LBL = {
  display: "block",
  color: "rgba(255,255,255,0.42)",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.9,
  textTransform: "uppercase",
  marginBottom: 5,
};
const SECTION = { ...CARD, padding: "1.1rem 1.4rem", marginBottom: 12 };
const STITLE = {
  color: "rgba(255,255,255,0.42)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.9,
  marginBottom: 10,
};

// ═══════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════
function Spin({ s = 32, c = "#fbbf24" }) {
  return (
    <div
      style={{
        width: s,
        height: s,
        border: `2.5px solid ${c}30`,
        borderTop: `2.5px solid ${c}`,
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }}
    />
  );
}
function Tag({ children, color = "#fbbf24" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 9px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        background: color + "1a",
        color,
        border: `1px solid ${color}35`,
      }}
    >
      {children}
    </span>
  );
}
function Card({ children, style = {} }) {
  return (
    <div style={{ ...CARD, padding: "1.1rem 1.3rem", ...style }}>
      {children}
    </div>
  );
}


// ═══════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [un, setUn] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function go() {
    if (!un || !pw) return;
    setLoading(true);
    setErr("");
    try {
      const user = await dbLogin(un.trim(), pw);
      onLogin(user);
    } catch (e) {
      setErr("Invalid username or password.");
    }
    setLoading(false);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans',sans-serif",
      }}
    >
      <style>{CSS}</style>
      <div style={{ width: 360, animation: "fadeUp 0.5s ease" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>🏆</div>
          <h1
            style={{
              fontFamily: "'Playfair Display',serif",
              color: "#fbbf24",
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "-0.5px",
            }}
          >
            FitFamily
          </h1>
          <p
            style={{
              color: "rgba(255,255,255,0.28)",
              fontSize: 12,
              marginTop: 5,
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            Family Fitness Competition
          </p>
        </div>
        <Card style={{ padding: "1.8rem" }}>
          <div style={{ marginBottom: 14 }}>
            <label style={LBL}>Username</label>
            <input
              value={un}
              onChange={(e) => setUn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              placeholder="Enter username"
              style={IS}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={LBL}>Password</label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              placeholder="Enter password"
              style={IS}
            />
          </div>
          {err && (
            <p style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
              {err}
            </p>
          )}
          <button
            onClick={go}
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px",
              background: "linear-gradient(135deg,#fbbf24,#f59e0b)",
              border: "none",
              borderRadius: 11,
              color: "#0d1a00",
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans',sans-serif",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Signing in..." : "Sign In →"}
          </button>
          <p
            style={{
              color: "rgba(255,255,255,0.18)",
              fontSize: 11,
              textAlign: "center",
              marginTop: 12,
            }}
          >
            Contact your admin for login credentials
          </p>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════
function AdminPanel({ currentUser, onLogout }) {
  const [tab, setTab] = useState("members");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    id: "", name: "", password: "", age: "", weight: "",
    height: "", gender: "male", goal: "Lose Weight", activity: 1.55,
  });
  const [msg, setMsg] = useState("");
  const [viewUser, setViewUser] = useState(null);
  const [userLogs, setUserLogs] = useState([]);
  const [weekPts, setWeekPts] = useState({});
  const wk = weekStart();
  const F = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const u = await dbGetAllUsers();
    setUsers(u);
    if (u.length > 0) {
      const pts = await dbGetWeeklyPoints(u, wk);
      setWeekPts(pts);
    }
    setLoading(false);
  }, [wk]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function create() {
    if (!form.id || !form.name || !form.password || !form.age || !form.weight || !form.height) {
      setMsg("Please fill all fields.");
      return;
    }
    try {
      await dbCreateUser({
        id: form.id.trim(), name: form.name, password: form.password,
        age: +form.age, weight: +form.weight, height: +form.height,
        gender: form.gender, goal: form.goal, activity: +form.activity,
        is_admin: false,
      });
      setMsg("✅ Account created for " + form.name + "!");
      setForm({ id: "", name: "", password: "", age: "", weight: "", height: "", gender: "male", goal: "Lose Weight", activity: 1.55 });
      loadUsers();
    } catch (e) {
      setMsg("Error: " + e.message);
    }
  }

  async function del(id) {
    if (!window.confirm("Delete " + id + "?")) return;
    await dbDeleteUser(id);
    loadUsers();
  }

  async function viewLogs(user) {
    setViewUser(user);
    setTab("logs");
    const logs = await dbGetAllLogs(user.id);
    setUserLogs(logs);
  }

  const lb = [...users]
    .map((u) => ({ ...u, pts: weekPts[u.id] || 0 }))
    .sort((a, b) => b.pts - a.pts);

  const NAV = [
    { id: "members", l: "👥 Members" },
    { id: "create", l: "➕ Add Member" },
    { id: "leaderboard", l: "🏆 Leaderboard" },
    { id: "logs", l: "📋 Logs" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: BG, color: "#fff", fontFamily: "'DM Sans',sans-serif" }}>
      <style>{CSS}</style>
      {/* Header */}
      <div style={{ background: "rgba(0,0,0,0.45)", borderBottom: "1px solid rgba(251,191,36,0.1)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 55 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 20 }}>🏆</span>
          <span style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", fontWeight: 700, fontSize: 17 }}>FitFamily</span>
          <Tag color="#fbbf24">Admin</Tag>
        </div>
        <button onClick={onLogout} style={{ padding: "5px 13px", borderRadius: 9, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.22)", color: "#f87171", cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans',sans-serif" }}>Sign Out</button>
      </div>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, padding: "0.8rem 1.5rem 0", borderBottom: "1px solid rgba(255,255,255,0.05)", overflowX: "auto" }}>
        {NAV.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background: tab === t.id ? "rgba(251,191,36,0.1)" : "transparent", border: tab === t.id ? "1px solid rgba(251,191,36,0.22)" : "1px solid transparent", color: tab === t.id ? "#fbbf24" : "rgba(255,255,255,0.38)", borderRadius: "7px 7px 0 0", padding: "7px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'DM Sans',sans-serif", fontWeight: tab === t.id ? 600 : 400, whiteSpace: "nowrap" }}>
            {t.l}
          </button>
        ))}
      </div>
      <div style={{ padding: "1.5rem", maxWidth: 860, margin: "0 auto" }}>

        {/* MEMBERS */}
        {tab === "members" && (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", marginBottom: "1.2rem", fontSize: 21 }}>
              Family Members ({users.length})
            </h2>
            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "2rem" }}><Spin /></div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {users.map((u) => {
                  const bmi = calcBMI(u.weight, u.height), cat = bmiCat(bmi);
                  const tdee = calcTDEE(u.weight, u.height, u.age, u.gender, u.activity);
                  return (
                    <Card key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 15 }}>{u.name}</span>
                          <Tag color="#60a5fa">@{u.id}</Tag>
                          <Tag color={cat.c}>{cat.label}</Tag>
                          <Tag color="#a78bfa">{u.goal}</Tag>
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <span>{u.age}y · {u.gender} · {u.weight}kg · {u.height}cm</span>
                          <span>BMI {bmi} · Target {calcTarget(tdee, u.goal)}kcal/day</span>
                          <span>This week: {weekPts[u.id] || 0} pts</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 7 }}>
                        <button onClick={() => viewLogs(u)} style={{ padding: "5px 11px", borderRadius: 8, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24", cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans',sans-serif" }}>Logs</button>
                        <button onClick={() => del(u.id)} style={{ padding: "5px 11px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans',sans-serif" }}>Delete</button>
                      </div>
                    </Card>
                  );
                })}
                {users.length === 0 && <p style={{ color: "rgba(255,255,255,0.3)" }}>No members yet. Add one!</p>}
              </div>
            )}
          </div>
        )}

        {/* ADD MEMBER */}
        {tab === "create" && (
          <div style={{ animation: "fadeUp 0.3s ease", maxWidth: 460 }}>
            <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", marginBottom: "1.2rem", fontSize: 21 }}>Add Family Member</h2>
            {msg && (
              <div style={{ background: msg.startsWith("✅") ? "rgba(34,197,94,0.09)" : "rgba(239,68,68,0.09)", border: `1px solid ${msg.startsWith("✅") ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`, borderRadius: 9, padding: "9px 13px", marginBottom: 14, color: msg.startsWith("✅") ? "#22c55e" : "#f87171", fontSize: 13 }}>
                {msg}
              </div>
            )}
            <Card>
              {[["Full Name", "name", "text", "e.g. Priya Sharma"], ["Username (login ID)", "id", "text", "e.g. priya123"], ["Password", "password", "password", "Create a password"], ["Age", "age", "number", "e.g. 28"], ["Weight (kg)", "weight", "number", "e.g. 65"], ["Height (cm)", "height", "number", "e.g. 165"]].map(([l, k, t, ph]) => (
                <div key={k} style={{ marginBottom: 12 }}>
                  <label style={LBL}>{l}</label>
                  <input type={t} placeholder={ph} value={form[k]} onChange={(e) => F(k, e.target.value)} style={IS} />
                </div>
              ))}
              <div style={{ marginBottom: 12 }}>
                <label style={LBL}>Gender</label>
                <select value={form.gender} onChange={(e) => F("gender", e.target.value)} style={SS}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={LBL}>Fitness Goal</label>
                <select value={form.goal} onChange={(e) => F("goal", e.target.value)} style={SS}>
                  {GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={LBL}>Activity Level</label>
                <select value={form.activity} onChange={(e) => F("activity", e.target.value)} style={SS}>
                  {ACTIVITY_LEVELS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <button onClick={create} style={{ width: "100%", padding: "12px", background: "linear-gradient(135deg,#fbbf24,#f59e0b)", border: "none", borderRadius: 10, color: "#0d1a00", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                Create Account →
              </button>
            </Card>
          </div>
        )}

        {/* LEADERBOARD */}
        {tab === "leaderboard" && (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", marginBottom: 5, fontSize: 21 }}>🏆 Weekly Leaderboard</h2>
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginBottom: "1.2rem" }}>Week of {wk}</p>
            <div style={{ display: "grid", gap: 9 }}>
              {lb.map((u, i) => (
                <Card key={u.id} style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <span style={{ fontSize: 24, minWidth: 32 }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{u.name}</div>
                    <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>{u.goal}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 18 }}>{u.pts}</div>
                    <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10 }}>pts</div>
                  </div>
                </Card>
              ))}
              {lb.length === 0 && <p style={{ color: "rgba(255,255,255,0.3)" }}>No members yet.</p>}
            </div>
          </div>
        )}

        {/* LOGS */}
        {tab === "logs" && (
          <div style={{ animation: "fadeUp 0.3s ease" }}>
            {!viewUser ? (
              <div>
                <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", marginBottom: "1.2rem", fontSize: 21 }}>All Member Logs</h2>
                <div style={{ display: "grid", gap: 9 }}>
                  {users.map((u) => (
                    <Card key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => viewLogs(u)}>
                      <span style={{ fontWeight: 600 }}>{u.name} <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>@{u.id}</span></span>
                      <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>View logs →</span>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <button onClick={() => setViewUser(null)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)", borderRadius: 7, padding: "5px 12px", fontSize: 12, marginBottom: 14, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>← Back</button>
                <h3 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", marginBottom: 12, fontSize: 17 }}>Logs — {viewUser.name}</h3>
                <div style={{ display: "grid", gap: 8 }}>
                  {userLogs.map((log) => {
                    const col = dayColor(log, viewUser);
                    const pts = calcPts(log, viewUser);
                    return (
                      <Card key={log.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div style={{ width: 9, height: 9, borderRadius: "50%", background: col || "rgba(255,255,255,0.15)" }} />
                          <span>{log.date}</span>
                          {log.exercise && <Tag color="#34d399">Exercised</Tag>}
                        </div>
                        <Tag color="#fbbf24">{pts} pts</Tag>
                      </Card>
                    );
                  })}
                  {userLogs.length === 0 && <p style={{ color: "rgba(255,255,255,0.3)" }}>No logs yet.</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// CALENDAR VIEW
// ═══════════════════════════════════════════════════
function CalView({ logs, user, onSelect, selected }) {
  const now = new Date();
  const [yr, setYr] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth());
  const today = todayStr();
  const days = getDaysInMonth(yr, mo);
  const firstDow = new Date(yr, mo, 1).getDay();
  const cells = Array(firstDow).fill(null).concat(days);
  const mName = new Date(yr, mo, 1).toLocaleString("default", { month: "long" });

  function prev() { if (mo === 0) { setYr((y) => y - 1); setMo(11); } else setMo((m) => m - 1); }
  function next() { if (mo === 11) { setYr((y) => y + 1); setMo(0); } else setMo((m) => m + 1); }

  const logMap = {};
  logs.forEach((l) => { logMap[l.date] = l; });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={prev} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", borderRadius: 6, padding: "3px 10px", fontSize: 14, cursor: "pointer" }}>‹</button>
        <span style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", fontSize: 15, fontWeight: 700 }}>{mName} {yr}</span>
        <button onClick={next} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", borderRadius: 6, padding: "3px 10px", fontSize: 14, cursor: "pointer" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3, marginBottom: 3 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", color: "rgba(255,255,255,0.22)", fontSize: 10, fontWeight: 600, padding: "3px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const ds = `${yr}-${String(mo + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const log = logMap[ds];
          const col = log ? dayColor(log, user) : null;
          const isToday = ds === today, isSel = ds === selected, isFuture = ds > today;
          return (
            <button key={i} onClick={() => !isFuture && onSelect(ds)} style={{ aspectRatio: "1", borderRadius: 7, border: isSel ? "2px solid #fbbf24" : "1px solid transparent", background: isToday ? "rgba(255,255,255,0.12)" : col ? col + "20" : "rgba(255,255,255,0.02)", color: isToday ? "#fff" : col ? col : "rgba(255,255,255,0.2)", fontSize: 12, fontWeight: isSel || isToday ? 700 : 400, cursor: isFuture ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, position: "relative" }}>
              {d.getDate()}
              {col && <div style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", width: 3, height: 3, borderRadius: "50%", background: col }} />}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 10, justifyContent: "center" }}>
        {[["#22c55e", "Great"], ["#fbbf24", "Good"], ["#ef4444", "Poor"], ["rgba(255,255,255,0.15)", "Today"]].map(([c, l]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: c }} />
            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// DAY REPORT DETAIL
// ═══════════════════════════════════════════════════
function DayReport({ log, user, wt, tCal, tPro, tCar, tFat }) {
  if (!log) return <p style={{ color: "rgba(255,255,255,0.3)", padding: "2rem", textAlign: "center" }}>No data for this day.</p>;
  const mealsList = Array.isArray(log.meals) ? log.meals : [];
  const displayWt = wt || user.weight;
  const bmi = calcBMI(displayWt, user.height), cat = bmiCat(bmi);
  const pts = calcPts(log, user), col = dayColor(log, user);
  const totalCal = mealsList.reduce((s, m) => s + (m.nutrition?.calories || 0), 0);
  const totalPro = mealsList.reduce((s, m) => s + (m.nutrition?.protein || 0), 0);
  const totalCarb = mealsList.reduce((s, m) => s + (m.nutrition?.carbs || 0), 0);
  const totalFat = mealsList.reduce((s, m) => s + (m.nutrition?.fats || 0), 0);

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
        <Tag color={col || "#888"}>{col === "#22c55e" ? "Great Day" : col === "#fbbf24" ? "Good Day" : "Needs Work"}</Tag>
        <Tag color="#fbbf24">{pts} pts</Tag>
      </div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8, marginBottom: 12 }}>
        {[["⚖️", displayWt + "kg", "Weight", "#60a5fa"], ["📊", bmi + " (" + cat.label + ")", "BMI", cat.c], ["💧", (log.water || 0) + " gl", "Water", "#38bdf8"], ["😴", (log.sleep || 0) + "h", "Sleep", "#a78bfa"], ["😊", log.mood || "—", "Mood", "#22c55e"]].map(([icon, val, label, color]) => (
          <Card key={label} style={{ padding: "0.8rem", textAlign: "center" }}>
            <div style={{ fontSize: 18, marginBottom: 2 }}>{icon}</div>
            <div style={{ color, fontWeight: 700, fontSize: 13 }}>{val}</div>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>{label}</div>
          </Card>
        ))}
      </div>
      {/* Nutrition */}
      <Card style={{ marginBottom: 10 }}>
        <p style={STITLE}>📊 Nutrition vs Target</p>
        {mealsList.length === 0 || totalCal === 0 ? (
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, textAlign: "center", padding: "0.5rem 0" }}>No meals logged for this day.</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
              {[["🔥 Cal", totalCal, tCal, "kcal", "#fbbf24"], ["💪 Pro", totalPro, tPro, "g", "#60a5fa"], ["🌾 Carbs", totalCarb, tCar, "g", "#34d399"], ["🥑 Fats", totalFat, tFat, "g", "#f97316"]].map(([label, val, tgt, unit, color]) => (
                <div key={label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "0.65rem 0.4rem", textAlign: "center" }}>
                  <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, marginBottom: 2 }}>{label}</div>
                  <div style={{ color, fontWeight: 700, fontSize: 17 }}>{val}<span style={{ fontSize: 10, fontWeight: 400 }}>{unit}</span></div>
                  <div style={{ color: "rgba(255,255,255,0.22)", fontSize: 10 }}>/ {tgt}{unit}</div>
                  <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 2, marginTop: 4 }}>
                    <div style={{ height: 3, background: color, borderRadius: 2, width: Math.min(100, tgt > 0 ? Math.round((val / tgt) * 100) : 0) + "%" }} />
                  </div>
                </div>
              ))}
            </div>
            <p style={{ ...STITLE, marginBottom: 8 }}>📋 Meal Breakdown</p>
            <div style={{ display: "grid", gap: 8 }}>
              {mealsList.map((meal, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "0.75rem 1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Meal {i + 1}</span>
                      <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 1 }}>{meal.description}</p>
                    </div>
                    <div style={{ textAlign: "right", paddingLeft: 8, flexShrink: 0 }}>
                      <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 14 }}>{meal.nutrition?.calories || 0}<span style={{ fontSize: 10, fontWeight: 400 }}> kcal</span></div>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <span style={{ color: "#60a5fa", fontSize: 11 }}>P:{meal.nutrition?.protein || 0}g</span>
                        <span style={{ color: "#34d399", fontSize: 11 }}>C:{meal.nutrition?.carbs || 0}g</span>
                        <span style={{ color: "#f97316", fontSize: 11 }}>F:{meal.nutrition?.fats || 0}g</span>
                      </div>
                    </div>
                  </div>
                  {meal.nutrition?.items && meal.nutrition.items.length > 0 && (
                    <div style={{ paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.07)", marginTop: 4 }}>
                      {meal.nutrition.items.map((item, j) => (
                        <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{item.name}</span>
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: "rgba(251,191,36,0.7)", fontSize: 11 }}>{item.calories}cal</span>
                            <span style={{ color: "rgba(96,165,250,0.7)", fontSize: 11 }}>P:{item.protein}g</span>
                            <span style={{ color: "rgba(52,211,153,0.7)", fontSize: 11 }}>C:{item.carbs}g</span>
                            <span style={{ color: "rgba(249,115,22,0.7)", fontSize: 11 }}>F:{item.fats}g</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
      {log.exercise && (
        <Card style={{ marginBottom: 10 }}>
          <p style={STITLE}>🏋️ Exercise</p>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, lineHeight: 1.6 }}>{log.exercise}</p>
        </Card>
      )}
      {log.report && (
        <Card style={{ border: "1px solid rgba(251,191,36,0.15)" }}>
          <p style={{ color: "#fbbf24", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>🤖 AI Coach Report</p>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 13, lineHeight: 1.85, whiteSpace: "pre-wrap" }}>{log.report}</div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// LOG TAB — all raw HTML inputs, no wrapper components
// ═══════════════════════════════════════════════════
function LogTab({ currentUser, user, tCal, tPro, tCar, tFat, streak, today, onSaved }) {
  const [ready, setReady] = useState(false);
  const [meals, setMeals] = useState([]);
  const [newMeal, setNewMeal] = useState("");
  const [exercise, setExercise] = useState("");
  const [water, setWater] = useState(4);
  const [sleep, setSleep] = useState(7);
  const [mood, setMood] = useState("Good");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [todayWt, setTodayWt] = useState("");
  const [wtSaved, setWtSaved] = useState(false);
  const [waist, setWaist] = useState("");
  const [chest, setChest] = useState("");
  const [hips, setHips] = useState("");
  const [mSaved, setMSaved] = useState(false);
  const [notifTime, setNotifTime] = useState("");
  const [notifSaved, setNotifSaved] = useState(false);
  const wk = weekStart();

  useEffect(() => {
    async function load() {
      const [log, wt, meas, nt] = await Promise.all([
        dbGetLog(currentUser.id, today),
        dbGetWeight(currentUser.id, today),
        dbGetMeasurement(currentUser.id, wk),
        dbGetNotifTime(currentUser.id),
      ]);
      if (log) {
        setMeals(Array.isArray(log.meals) ? log.meals : []);
        setExercise(log.exercise || "");
        setWater(log.water || 4);
        setSleep(log.sleep || 7);
        setMood(log.mood || "Good");
        setNotes(log.notes || "");
        setSaved(true);
      }
      if (wt) { setTodayWt(String(wt)); setWtSaved(true); }
      if (meas) { setWaist(String(meas.waist || "")); setChest(String(meas.chest || "")); setHips(String(meas.hips || "")); setMSaved(true); }
      if (nt) { setNotifTime(nt); setNotifSaved(true); }
      setReady(true);
    }
    load();
  }, [currentUser.id, today, wk]);

  useEffect(() => {
    if (!notifTime) return;
    const iv = setInterval(() => checkNotif(currentUser.id, notifTime), 10000);
    return () => clearInterval(iv);
  }, [notifTime, currentUser.id]);

  async function persistMeals(updated) {
    await dbSaveLog(currentUser.id, today, { meals: updated, exercise, water, sleep, mood, notes });
    onSaved();
  }

  async function addMeal() {
    if (!newMeal.trim()) return;
    const meal = { description: newMeal.trim(), nutrition: null, estimating: true };
    const updated = [...meals, meal];
    setMeals(updated);
    setNewMeal("");
    setSaved(false);
    const idx = updated.length - 1;
    try {
      const n = await estimateMealNutrition(meal.description);
      const withN = updated.map((m, i) => (i === idx ? { ...m, nutrition: n, estimating: false } : m));
      setMeals(withN);
      await persistMeals(withN);
    } catch (e) {
      const failed = updated.map((m, i) => (i === idx ? { ...m, estimating: false, error: true } : m));
      setMeals(failed);
    }
  }

  async function removeMeal(idx) {
    const updated = meals.filter((_, i) => i !== idx);
    setMeals(updated);
    await persistMeals(updated);
  }

  async function saveWt() {
    if (!todayWt) return;
    await dbSaveWeight(currentUser.id, today, +todayWt);
    setWtSaved(true);
    onSaved();
  }

  async function saveMeas() {
    if (!waist && !chest && !hips) return;
    await dbSaveMeasurement(currentUser.id, wk, { waist: +waist, chest: +chest, hips: +hips });
    setMSaved(true);
    onSaved();
  }

  async function saveNotif() {
    if (!notifTime) return;
    if ("Notification" in window && Notification.permission !== "granted") {
      await Notification.requestPermission();
    }
    await dbSaveNotifTime(currentUser.id, notifTime);
    setNotifSaved(true);
  }

  async function saveLog() {
    setSaving(true);
    const readyMeals = meals.filter((m) => !m.estimating);
    const logData = { meals: readyMeals, exercise, water, sleep, mood, notes };
    try {
      logData.report = await generateReport(user, readyMeals, exercise, water, sleep, mood, notes, tCal, tPro, tCar, tFat, streak);
    } catch (e) {
      logData.report = "Report unavailable — " + e.message;
    }
    await dbSaveLog(currentUser.id, today, logData);
    setSaved(true);
    setSaving(false);
    onSaved();
  }

  const totalCal = meals.reduce((s, m) => s + (m.nutrition?.calories || 0), 0);
  const totalPro = meals.reduce((s, m) => s + (m.nutrition?.protein || 0), 0);
  const totalCarb = meals.reduce((s, m) => s + (m.nutrition?.carbs || 0), 0);
  const totalFat = meals.reduce((s, m) => s + (m.nutrition?.fats || 0), 0);

  if (!ready) return <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Spin /></div>;

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
        <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", fontSize: 21 }}>Today — {today}</h2>
        {saved && <Tag color="#22c55e">✓ Logged</Tag>}
      </div>

      {/* WEIGHT */}
      <div style={SECTION}>
        <p style={STITLE}>⚖️ Today's Weight</p>
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <input type="number" placeholder="e.g. 94.5" value={todayWt} onChange={(e) => { setTodayWt(e.target.value); setWtSaved(false); }} style={{ ...IS, flex: 1 }} />
          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>kg</span>
          <button onClick={saveWt} style={{ padding: "9px 14px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", background: wtSaved ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#22c55e,#16a34a)", color: wtSaved ? "rgba(255,255,255,0.65)" : "#fff" }}>
            {wtSaved ? "✓ Saved" : "Save"}
          </button>
        </div>
        <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, marginTop: 6 }}>Weigh first thing in the morning for accuracy</p>
      </div>

      {/* MEASUREMENTS */}
      <div style={SECTION}>
        <p style={STITLE}>📏 Weekly Measurements (cm) — week of {wk}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9, marginBottom: 10 }}>
          <div><label style={LBL}>Waist</label><input type="number" placeholder="cm" value={waist} onChange={(e) => { setWaist(e.target.value); setMSaved(false); }} style={IS} /></div>
          <div><label style={LBL}>Chest</label><input type="number" placeholder="cm" value={chest} onChange={(e) => { setChest(e.target.value); setMSaved(false); }} style={IS} /></div>
          <div><label style={LBL}>Hips</label><input type="number" placeholder="cm" value={hips} onChange={(e) => { setHips(e.target.value); setMSaved(false); }} style={IS} /></div>
        </div>
        <button onClick={saveMeas} style={{ padding: "8px 14px", borderRadius: 9, border: mSaved ? "1px solid rgba(255,255,255,0.1)" : "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 12, background: mSaved ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#fbbf24,#f59e0b)", color: mSaved ? "rgba(255,255,255,0.65)" : "#0d1a00" }}>
          {mSaved ? "✓ Measurements Saved" : "Save Measurements"}
        </button>
      </div>

      {/* MEALS */}
      <div style={SECTION}>
        <p style={STITLE}>🍽️ Meals Today</p>
        <p style={{ color: "rgba(255,255,255,0.28)", fontSize: 11, marginBottom: 10 }}>Add each meal separately — AI estimates nutrition instantly</p>
        {meals.length > 0 && (
          <div style={{ marginBottom: 12, display: "grid", gap: 8 }}>
            {meals.map((meal, i) => (
              <div key={i} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.75rem 1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>Meal {i + 1}</span>
                    <p style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 2, lineHeight: 1.4 }}>{meal.description}</p>
                  </div>
                  <button onClick={() => removeMeal(i)} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.25)", cursor: "pointer", fontSize: 16, padding: "0 0 0 10px" }}>✕</button>
                </div>
                {meal.estimating && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}><Spin s={12} /><span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>Estimating nutrition...</span></div>}
                {meal.error && <p style={{ color: "#f87171", fontSize: 11, marginTop: 4 }}>⚠ Could not estimate — check connection</p>}
                {meal.nutrition && !meal.estimating && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ color: "#fbbf24", fontSize: 12, fontWeight: 600 }}>{meal.nutrition.calories} kcal</span>
                      <span style={{ color: "#60a5fa", fontSize: 12 }}>P: {meal.nutrition.protein}g</span>
                      <span style={{ color: "#34d399", fontSize: 12 }}>C: {meal.nutrition.carbs}g</span>
                      <span style={{ color: "#f97316", fontSize: 12 }}>F: {meal.nutrition.fats}g</span>
                    </div>
                    {meal.nutrition.items && meal.nutrition.items.length > 0 && (
                      <div style={{ paddingLeft: 8, borderLeft: "2px solid rgba(255,255,255,0.07)" }}>
                        {meal.nutrition.items.map((item, j) => (
                          <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                            <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{item.name}</span>
                            <div style={{ display: "flex", gap: 8 }}>
                              <span style={{ color: "rgba(251,191,36,0.7)", fontSize: 11 }}>{item.calories}cal</span>
                              <span style={{ color: "rgba(96,165,250,0.7)", fontSize: 11 }}>P:{item.protein}g</span>
                              <span style={{ color: "rgba(52,211,153,0.7)", fontSize: 11 }}>C:{item.carbs}g</span>
                              <span style={{ color: "rgba(249,115,22,0.7)", fontSize: 11 }}>F:{item.fats}g</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {meals.length > 0 && totalCal > 0 && (
          <div style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)", borderRadius: 9, padding: "0.7rem 1rem", marginBottom: 10 }}>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Daily Total ({meals.length} meals)</p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: 14 }}>{totalCal}<span style={{ fontSize: 11, fontWeight: 400 }}> / {tCal} kcal</span></span>
              <span style={{ color: "#60a5fa", fontWeight: 700, fontSize: 14 }}>{totalPro}g<span style={{ fontSize: 11, fontWeight: 400 }}> / {tPro}g protein</span></span>
              <span style={{ color: "#34d399", fontWeight: 700, fontSize: 14 }}>{totalCarb}g<span style={{ fontSize: 11, fontWeight: 400 }}> / {tCar}g carbs</span></span>
              <span style={{ color: "#f97316", fontWeight: 700, fontSize: 14 }}>{totalFat}g<span style={{ fontSize: 11, fontWeight: 400 }}> / {tFat}g fats</span></span>
            </div>
            <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, marginTop: 8 }}>
              <div style={{ height: 4, background: "linear-gradient(90deg,#fbbf24,#f59e0b)", borderRadius: 2, width: Math.min(100, Math.round((totalCal / tCal) * 100)) + "%", transition: "width 0.5s" }} />
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input value={newMeal} onChange={(e) => setNewMeal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMeal()} placeholder="e.g. 2 rotis with dal and sabzi, chai with milk..." style={{ ...IS, flex: 1 }} />
          <button onClick={addMeal} disabled={!newMeal.trim()} style={{ padding: "10px 16px", borderRadius: 9, border: "none", cursor: newMeal.trim() ? "pointer" : "not-allowed", fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13, background: newMeal.trim() ? "linear-gradient(135deg,#fbbf24,#f59e0b)" : "rgba(255,255,255,0.07)", color: newMeal.trim() ? "#0d1a00" : "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
            + Add Meal
          </button>
        </div>
        <p style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, marginTop: 5 }}>Press Enter or click + Add Meal · AI estimates nutrition automatically</p>
      </div>

      {/* EXERCISE */}
      <div style={SECTION}>
        <p style={STITLE}>🏋️ Exercise Today</p>
        <textarea value={exercise} onChange={(e) => { setExercise(e.target.value); setSaved(false); }} placeholder="e.g. 45 min gym — chest + triceps. Bench press 4x10, cable flyes 3x12, 15 min incline walk..." style={{ ...TS, minHeight: 70 }} />
      </div>

      {/* WATER + SLEEP */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div style={{ ...CARD, padding: "1rem 1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>💧 Water</span>
            <span style={{ color: "#38bdf8", fontWeight: 700, fontSize: 16 }}>{water}<span style={{ fontSize: 11 }}> glasses</span></span>
          </div>
          <input type="range" min={0} max={16} value={water} onChange={(e) => { setWater(+e.target.value); setSaved(false); }} style={{ width: "100%", accentColor: "#38bdf8" }} />
        </div>
        <div style={{ ...CARD, padding: "1rem 1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>😴 Sleep</span>
            <span style={{ color: "#a78bfa", fontWeight: 700, fontSize: 16 }}>{sleep}<span style={{ fontSize: 11 }}> hrs</span></span>
          </div>
          <input type="range" min={0} max={12} value={sleep} onChange={(e) => { setSleep(+e.target.value); setSaved(false); }} style={{ width: "100%", accentColor: "#a78bfa" }} />
        </div>
      </div>

      {/* MOOD + NOTES */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div style={{ ...CARD, padding: "1rem 1.2rem" }}>
          <label style={LBL}>😊 Mood</label>
          <select value={mood} onChange={(e) => { setMood(e.target.value); setSaved(false); }} style={SS}>
            {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ ...CARD, padding: "1rem 1.2rem" }}>
          <label style={LBL}>📝 Notes</label>
          <input value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} placeholder="Anything else..." style={IS} />
        </div>
      </div>

      {/* NOTIFICATION */}
      <div style={SECTION}>
        <p style={STITLE}>🔔 Daily Weight Reminder</p>
        <p style={{ color: "rgba(255,255,255,0.28)", fontSize: 11, marginBottom: 9 }}>Set once — get a browser notification every day at this time to log your weight</p>
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <input type="time" value={notifTime} onChange={(e) => { setNotifTime(e.target.value); setNotifSaved(false); }} style={{ ...IS, flex: 1 }} />
          <button onClick={saveNotif} style={{ padding: "9px 14px", borderRadius: 9, border: notifSaved ? "1px solid rgba(255,255,255,0.1)" : "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", background: notifSaved ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg,#fbbf24,#f59e0b)", color: notifSaved ? "rgba(255,255,255,0.65)" : "#0d1a00" }}>
            {notifSaved ? "✓ Reminder Set" : "Set Reminder"}
          </button>
        </div>
      </div>

      <button onClick={saveLog} disabled={saving} style={{ width: "100%", padding: "13px", fontSize: 15, fontFamily: "'DM Sans',sans-serif", fontWeight: 700, border: "none", borderRadius: 12, cursor: saving ? "not-allowed" : "pointer", background: saving ? "rgba(251,191,36,0.35)" : "linear-gradient(135deg,#fbbf24,#f59e0b)", color: "#0d1a00", opacity: saving ? 0.7 : 1 }}>
        {saving ? "⏳ Generating AI Coach Report..." : saved ? "✅ Saved! Update Log" : "💾 Save Log & Generate AI Report →"}
      </button>
      {saved && !saving && <p style={{ color: "#22c55e", textAlign: "center", marginTop: 9, fontSize: 13 }}>✅ Saved! Switch to Reports tab to see your AI health report.</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// REPORT TAB
// ═══════════════════════════════════════════════════
function ReportTab({ currentUser, user, tCal, tPro, tCar, tFat }) {
  const [logs, setLogs] = useState([]);
  const [weights, setWeights] = useState({});
  const [sel, setSel] = useState(todayStr());
  const [selLog, setSelLog] = useState(null);
  const [selWt, setSelWt] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [allLogs, allWts] = await Promise.all([dbGetAllLogs(currentUser.id), dbGetAllWeights(currentUser.id)]);
      setLogs(allLogs);
      const wtMap = {};
      allWts.forEach((w) => { wtMap[w.date] = w.weight; });
      setWeights(wtMap);
      const todayLog = allLogs.find((l) => l.date === todayStr());
      if (todayLog) { setSelLog(todayLog); setSelWt(wtMap[todayStr()] || null); }
      setLoading(false);
    }
    load();
  }, [currentUser.id]);

  function handleSelect(date) {
    setSel(date);
    const log = logs.find((l) => l.date === date) || null;
    setSelLog(log);
    setSelWt(weights[date] || null);
  }

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Spin /></div>;

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", marginBottom: "1rem", fontSize: 21 }}>📊 My Reports</h2>
      <Card style={{ marginBottom: 14 }}>
        <CalView logs={logs} user={user} onSelect={handleSelect} selected={sel} />
      </Card>
      {sel && (selLog
        ? <DayReport log={selLog} user={user} wt={selWt} tCal={tCal} tPro={tPro} tCar={tCar} tFat={tFat} />
        : <Card style={{ padding: "1.5rem", textAlign: "center" }}><p style={{ color: "rgba(255,255,255,0.3)" }}>{sel > todayStr() ? "Future date — nothing here yet." : "No log for this date."}</p></Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// RANKINGS TAB
// ═══════════════════════════════════════════════════
function RankingsTab({ currentUser, user }) {
  const [lb, setLb] = useState([]);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const wk = weekStart(), today = todayStr();

  useEffect(() => {
    async function load() {
      const users = await dbGetAllUsers();
      const allUsers = [...users, { ...user, id: currentUser.id }];
      const pts = await dbGetWeeklyPoints(allUsers, wk);
      const todayLogs = await Promise.all(allUsers.map((u) => dbGetLog(u.id, today)));
      const ranked = allUsers.map((u, i) => ({
        ...u, pts: pts[u.id] || 0, done: !!todayLogs[i], bmi: calcBMI(u.weight, u.height),
      })).sort((a, b) => b.pts - a.pts);
      setLb(ranked);
      setLoading(false);
    }
    load();
  }, [currentUser.id, user, wk, today]);

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Spin /></div>;
  const leader = lb[0];

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", marginBottom: 5, fontSize: 21 }}>🏆 Family Rankings</h2>
      <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginBottom: "1rem" }}>Week of {wk} · Click any member to see their stats</p>
      {leader && (
        <Card style={{ marginBottom: 12, border: "1px solid rgba(251,191,36,0.2)", background: "rgba(251,191,36,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 26 }}>👑</span>
            <div>
              <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 15 }}>{leader.id === currentUser.id ? `${leader.name} (You)` : leader.name} is leading!</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>{leader.goal} · {leader.pts} pts this week</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "rgba(255,255,255,0.38)" }}>
            <span>BMI: {leader.bmi}</span><span>Weight: {leader.weight}kg</span><span>{leader.done ? "✅ Logged today" : "⏳ Not logged"}</span>
          </div>
        </Card>
      )}
      <div style={{ display: "grid", gap: 9, marginBottom: 14 }}>
        {lb.map((e, i) => (
          <Card key={e.id} onClick={() => e.id !== currentUser.id && setModal(e)} style={{ display: "flex", alignItems: "center", gap: 12, border: e.id === currentUser.id ? "1px solid rgba(251,191,36,0.2)" : "1px solid rgba(255,255,255,0.07)", cursor: e.id !== currentUser.id ? "pointer" : "default" }}>
            <span style={{ fontSize: 22, minWidth: 30 }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{e.id === currentUser.id ? `${e.name} (You)` : e.name}{e.id !== currentUser.id && <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, marginLeft: 7 }}>tap to view →</span>}</div>
              <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 12 }}>{e.goal} · {e.done ? "✅ Logged" : "⏳ Pending"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 17 }}>{e.pts}</div>
              <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 10 }}>pts</div>
            </div>
          </Card>
        ))}
      </div>
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem" }} onClick={() => setModal(null)}>
          <Card style={{ width: 360, padding: "1.4rem", animation: "fadeUp 0.2s ease", border: "1px solid rgba(251,191,36,0.18)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", fontSize: 17 }}>{modal.name}</h3>
              <button onClick={() => setModal(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 17 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              {[["🎯 Goal", modal.goal], ["⚖️ Weight", modal.weight + "kg"], ["📊 BMI", modal.bmi + " (" + bmiCat(modal.bmi).label + ")"], ["⚡ This Week", modal.pts + " pts"], ["🎂 Age", modal.age + "y"], ["Today", modal.done ? "✅ Logged" : "⏳ Pending"]].map(([l, v]) => (
                <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{l}</div>
                  <div style={{ color: "#fff", fontWeight: 600, fontSize: 12, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      <Card>
        <p style={STITLE}>How Points Work</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, color: "rgba(255,255,255,0.38)", fontSize: 12 }}>
          <span>💧 8+ glasses water: +20</span><span>😴 7+ hrs sleep: +20</span>
          <span>🏋️ Exercise logged: +30</span><span>🍽️ Meals logged: +5</span>
          <span>🎯 Hit calorie target: +15</span><span>💪 Hit protein target: +15</span>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════
function SettingsTab({ currentUser, user, tCal, tPro, curBMI, bmiI }) {
  const [weights, setWeights] = useState([]);
  const [meas, setMeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const tdee = calcTDEE(user.weight, user.height, user.age, user.gender, user.activity);
  const tgt = calcTarget(tdee, user.goal);

  useEffect(() => {
    async function load() {
      const [wts, ms] = await Promise.all([dbGetAllWeights(currentUser.id), dbGetAllMeasurements(currentUser.id)]);
      setWeights(wts.slice(-14));
      setMeas(ms.slice(0, 6));
      setLoading(false);
    }
    load();
  }, [currentUser.id]);

  const wtVals = weights.map((w) => w.weight);
  const wMin = wtVals.length ? Math.min(...wtVals) - 1 : 50;
  const wMax = wtVals.length ? Math.max(...wtVals) + 1 : 100;
  const cW = 400, cH = 90;

  if (loading) return <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Spin /></div>;

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      <h2 style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", marginBottom: "1.1rem", fontSize: 21 }}>⚙️ Profile & Settings</h2>
      <Card style={{ marginBottom: 12 }}>
        <p style={STITLE}>My Stats</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
          {[["🎯 Goal", user.goal], ["⚖️ Weight", user.weight + "kg"], ["📏 Height", user.height + "cm"], ["🎂 Age", user.age + "y"], ["📊 BMI", curBMI + " (" + bmiI.label + ")"], ["⚡ TDEE", tdee + "kcal"], ["🍽️ Target", tgt + "kcal/day"], ["💪 Protein", tPro + "g/day"]].map(([l, v]) => (
            <div key={l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: "9px 11px" }}>
              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{l}</div>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>
      {weights.length > 1 && (
        <Card style={{ marginBottom: 12 }}>
          <p style={STITLE}>⚖️ Weight Trend (last 14 days)</p>
          <div style={{ overflowX: "auto" }}>
            <svg width="100%" viewBox={`0 0 ${cW} ${cH + 24}`} style={{ display: "block" }}>
              {weights.map((w, i) => {
                const x = (i / (weights.length - 1)) * cW;
                const y = cH - ((w.weight - wMin) / (wMax - wMin || 1)) * cH;
                return (
                  <g key={w.date}>
                    {i > 0 && (() => { const px = ((i - 1) / (weights.length - 1)) * cW, py = cH - ((weights[i - 1].weight - wMin) / (wMax - wMin || 1)) * cH; return <line x1={px} y1={py} x2={x} y2={y} stroke="rgba(251,191,36,0.45)" strokeWidth={1.5} />; })()}
                    <circle cx={x} cy={y} r={3.5} fill="#fbbf24" />
                    <text x={x} y={y - 7} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="8">{w.weight}kg</text>
                    {(i === 0 || i === weights.length - 1) && <text x={x} y={cH + 18} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="8">{w.date.slice(5)}</text>}
                  </g>
                );
              })}
            </svg>
          </div>
        </Card>
      )}
      {meas.length > 0 && (
        <Card>
          <p style={STITLE}>📏 Measurement History</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "6px 14px", fontSize: 12 }}>
            {["Week", "Waist", "Chest", "Hips"].map((h) => <span key={h} style={{ color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{h}</span>)}
            {meas.map((m) => [
              <span key={m.week_start + "d"} style={{ color: "rgba(255,255,255,0.45)" }}>{m.week_start}</span>,
              <span key={m.week_start + "w"} style={{ color: "#fbbf24", fontWeight: 600 }}>{m.waist}cm</span>,
              <span key={m.week_start + "c"} style={{ color: "#60a5fa", fontWeight: 600 }}>{m.chest}cm</span>,
              <span key={m.week_start + "h"} style={{ color: "#34d399", fontWeight: 600 }}>{m.hips}cm</span>,
            ])}
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// USER DASHBOARD
// ═══════════════════════════════════════════════════
function UserDashboard({ currentUser, onLogout }) {
  const [tab, setTab] = useState("log");
  const [refreshKey, setRefreshKey] = useState(0);
  const onSaved = useCallback(() => setRefreshKey((k) => k + 1), []);

  const today = todayStr();
  const user = currentUser;
  const tdee = calcTDEE(user.weight, user.height, user.age, user.gender, user.activity);
  const tCal = calcTarget(tdee, user.goal);
  const tPro = pTarget(user.weight, user.goal);
  const tCar = cTarget(tdee, user.goal);
  const tFat = fTarget(tdee, user.goal);

  const [streak, setStreak] = useState(0);
  const [myPts, setMyPts] = useState(0);
  const [myRank, setMyRank] = useState(1);
  const [latestWt, setLatestWt] = useState(user.weight);

  useEffect(() => {
    async function loadStats() {
      const wk = weekStart();
      const [allLogs, allUsers, allWts] = await Promise.all([
        dbGetAllLogs(currentUser.id),
        dbGetAllUsers(),
        dbGetAllWeights(currentUser.id),
      ]);
      // Streak
      let s = 0;
      const logDates = new Set(allLogs.map((l) => l.date));
      let chk = new Date();
      for (let i = 0; i < 365; i++) {
        const k = chk.toISOString().split("T")[0];
        if (logDates.has(k)) { s++; chk.setDate(chk.getDate() - 1); } else break;
      }
      setStreak(s);
      // Latest weight
      if (allWts.length > 0) setLatestWt(allWts[allWts.length - 1].weight);
      // Points & rank
      const weekLogs = allLogs.filter((l) => l.date >= wk);
      const myP = weekLogs.reduce((sum, l) => sum + calcPts(l, user), 0);
      setMyPts(myP);
      const allUsersWithMe = [...allUsers, { ...user, id: currentUser.id }];
      const pts = await dbGetWeeklyPoints(allUsersWithMe, wk);
      const ranked = Object.entries(pts).sort(([, a], [, b]) => b - a);
      const rank = ranked.findIndex(([id]) => id === currentUser.id) + 1;
      setMyRank(rank || 1);
    }
    loadStats();
  }, [currentUser.id, refreshKey, user]);

  const curBMI = calcBMI(latestWt, user.height);
  const bmiI = bmiCat(curBMI);
  const NAV = [
    { id: "log", l: "📝 Log Today" },
    { id: "report", l: "📊 Reports" },
    { id: "rankings", l: "🏆 Rankings" },
    { id: "settings", l: "⚙️ Settings" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: BG, color: "#fff", fontFamily: "'DM Sans',sans-serif" }}>
      <style>{CSS}</style>
      {/* Header */}
      <div style={{ background: "rgba(0,0,0,0.45)", borderBottom: "1px solid rgba(251,191,36,0.09)", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 54 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🏆</span>
          <span style={{ fontFamily: "'Playfair Display',serif", color: "#fbbf24", fontWeight: 700, fontSize: 16 }}>FitFamily</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Tag color="#22c55e">#{myRank}</Tag>
          <Tag color="#fbbf24">{myPts}pts</Tag>
          <Tag color="#f97316">🔥{streak}d</Tag>
          <button onClick={onLogout} style={{ padding: "4px 11px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.22)", color: "#f87171", cursor: "pointer", fontSize: 11, marginLeft: 4, fontFamily: "'DM Sans',sans-serif" }}>Out</button>
        </div>
      </div>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, padding: "0.7rem 1.5rem 0", borderBottom: "1px solid rgba(255,255,255,0.05)", overflowX: "auto" }}>
        {NAV.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ background: tab === t.id ? "rgba(251,191,36,0.09)" : "transparent", border: tab === t.id ? "1px solid rgba(251,191,36,0.2)" : "1px solid transparent", color: tab === t.id ? "#fbbf24" : "rgba(255,255,255,0.38)", borderRadius: "7px 7px 0 0", padding: "6px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'DM Sans',sans-serif", fontWeight: tab === t.id ? 600 : 400, whiteSpace: "nowrap" }}>
            {t.l}
          </button>
        ))}
      </div>
      {/* Stats strip */}
      <div style={{ background: "rgba(0,0,0,0.25)", borderBottom: "1px solid rgba(255,255,255,0.04)", padding: "0.5rem 1.5rem", display: "flex", gap: 18, overflowX: "auto", fontSize: 12, color: "rgba(255,255,255,0.38)" }}>
        <span>⚡ <strong style={{ color: "#fbbf24" }}>{tCal}kcal</strong> target</span>
        <span>💪 <strong style={{ color: "#60a5fa" }}>{tPro}g</strong> protein</span>
        <span>📊 BMI <strong style={{ color: bmiI.c }}>{curBMI} {bmiI.label}</strong></span>
        <span>⚖️ <strong style={{ color: "#34d399" }}>{latestWt}kg</strong></span>
        <span>🎯 <strong style={{ color: "#a78bfa" }}>{user.goal}</strong></span>
      </div>
      <div style={{ padding: "1.3rem 1.5rem", maxWidth: 800, margin: "0 auto" }}>
        {/* Keep LogTab mounted to avoid losing form state */}
        <div style={{ display: tab === "log" ? "block" : "none" }}>
          <LogTab currentUser={currentUser} user={user} tCal={tCal} tPro={tPro} tCar={tCar} tFat={tFat} streak={streak} today={today} onSaved={onSaved} />
        </div>
        {tab === "report" && <ReportTab key={refreshKey} currentUser={currentUser} user={user} tCal={tCal} tPro={tPro} tCar={tCar} tFat={tFat} />}
        {tab === "rankings" && <RankingsTab currentUser={currentUser} user={user} />}
        {tab === "settings" && <SettingsTab currentUser={currentUser} user={user} tCal={tCal} tPro={tPro} curBMI={curBMI} bmiI={bmiI} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState(null);

  // Restore session from localStorage on page load
  useEffect(() => {
    const saved = localStorage.getItem("fitfamily_session");
    if (saved) {
      try { setSession(JSON.parse(saved)); } catch {}
    }
  }, []);

  function handleLogin(user) {
    localStorage.setItem("fitfamily_session", JSON.stringify(user));
    setSession(user);
  }
  function handleLogout() {
    localStorage.removeItem("fitfamily_session");
    setSession(null);
  }

  if (!session) return <LoginScreen onLogin={handleLogin} />;
  if (session.is_admin) return <AdminPanel currentUser={session} onLogout={handleLogout} />;
  return <UserDashboard currentUser={session} onLogout={handleLogout} />;
}