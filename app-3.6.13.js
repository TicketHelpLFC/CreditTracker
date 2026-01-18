const BUILD_VERSION = "3.6.16-gh";
/* TicketHelpLFC Credit Tracker – PWA Starter (Local-only) */

const STORAGE_KEY = "thlfc_credit_tracker_v1";

const $ = (id) => document.getElementById(id);

function setText(id, value){ const el = $(id); if(el) el.textContent = value; }

const state = {
  data: null,
  deferredPrompt: null
};

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "_" + Math.random().toString(16).slice(2);
}

function parseAmount(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // accept "£43.85", "43.85", "43,85"
  const cleaned = s.replace(/[^0-9.,-]/g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function formatGBP(n) {
  if (n == null) return "£0";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
  } catch {
    return "£" + String(n);
  }
}

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


function currentSeasonIdFromDate() {
  // UK football season: Aug->May. In Jan 2026, that is 2025/26.
  const d = new Date();
  const y = d.getFullYear();
  const mth = d.getMonth() + 1; // 1-12
  const startYear = (mth >= 7) ? y : (y - 1); // July+ treat as new season start
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

function seasonLabelFromId(id) {
  // "2025-26" -> "25/26"
  const parts = String(id).split("-");
  if (parts.length !== 2) return id;
  const a = parts[0].slice(-2);
  const b = parts[1].slice(-2);
  return `${a}/${b}`;
}

function generateSeasons(rangeBack = 3, rangeForward = 6) {
  const cur = currentSeasonIdFromDate(); // e.g. "2025-26"
  const startYear = parseInt(cur.split("-")[0], 10);
  const seasons = [];
  for (let y = startYear - rangeBack; y <= startYear + rangeForward; y++) {
    const id = `${y}-${String(y + 1).slice(-2)}`;
    seasons.push({ id, label: seasonLabelFromId(id), createdAt: new Date().toISOString() });
  }
  return { seasons, activeSeasonId: cur };
}

function defaultData() {
  const gen = generateSeasons();
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    settings: {
      ruleForwardedNoCredit: true,
      ruleReturnedNoCredit: true,
      ruleHospitalityNoCredit: true
    },
    seasons: gen.seasons,
    activeSeasonId: gen.activeSeasonId,

    // Multi-account support
    accounts: [], // {id, name, autoCup, createdAt}
    activeAccountId: null,

    matches: [] // MatchEntry[] {accountId, seasonId, ...}
  };
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    state.data = defaultData();
    save();
    return;
  }
  try {
    state.data = JSON.parse(raw);
    if (!state.data || !state.data.seasons) throw new Error("Bad data");
  } catch {
    state.data = defaultData();
    save();
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function activeSeasonId() {
  return state.data.activeSeasonId;
}

function activeAccountId() {
  return state.data.activeAccountId;
}

function setActiveSeason(id) {
  state.data.activeSeasonId = id;
  save();
  renderAll();
}

function setActiveAccount(id) {
  state.data.activeAccountId = id;
  save();
  renderAll();
}

function seasonLabel(id) {
  const s = state.data.seasons.find(x => x.id === id);
  return s ? s.label : id;
}

function getSeasonMatches(seasonId) {
  const accId = activeAccountId();
  return state.data.matches.filter(m => m.seasonId === seasonId && (!accId || m.accountId === accId));
}

function creditIsCounted(match) {
  return match.creditCounts === "yes";
}

function computeSpend(seasonId) {
  const matches = getSeasonMatches(seasonId);
  const paid = matches.map(m => m.amountPaid).filter(v => typeof v === "number" && Number.isFinite(v));
  const total = paid.reduce((a,b) => a + b, 0);
  const avg = paid.length ? total / paid.length : 0;
  return { total, avg, count: paid.length };
}

function computeBreakdownByCompetition(seasonId) {
  const matches = getSeasonMatches(seasonId);
  const comps = ["PL","UCL","FAC","LC","OTHER"];
  const out = {};
  for (const c of comps) out[c] = { H: 0, A: 0 };
  for (const m of matches) {
    const c = out[m.competition] ? m.competition : "OTHER";
    if (m.creditCounts === "yes") {
      if (m.venue === "H") out[c].H += 1;
      if (m.venue === "A") out[c].A += 1;
    }
  }
  return out;
}

function computeTotals(seasonId) {
  const matches = getSeasonMatches(seasonId);
  let home = 0, away = 0;
  for (const m of matches) {
    if (creditIsCounted(m)) {
      if (m.venue === "H") home += 1;
      if (m.venue === "A") away += 1;
    }
  }
  return { home, away, total: home + away };
}

function eligibilityText(totals) {
  const max = Math.max(totals.home, totals.away, totals.total);
  if (max >= 13) return "Likely in a high-credit bracket (tracked).";
  if (max >= 4) return "You’re at 4+ in at least one category (tracked).";
  if (max >= 3) return "You’re at 3+ in at least one category (tracked).";
  if (max >= 2) return "You’re building credits (2+ tracked in a category).";
  if (max >= 1) return "You’ve got 1+ tracked — keep going.";
  return "Start logging matches to see your progress.";
}

function formatMatchTitle(m) {
  return `Liverpool vs ${m.opponent} (${m.venue})`;
}

function formatMeta(m) {
  const compMap = { PL: "PL", UCL: "UCL", FAC: "FA Cup", LC: "League Cup", OTHER: "Other" };
  const comp = compMap[m.competition] || m.competition;
  const date = m.matchDate || "—";
  return `${date} • ${comp}`;
}

function badgeForCredit(m) {
  if (m.creditCounts === "yes") return { text: "🟢 Counts", cls: "good" };
  if (m.creditCounts === "no") return { text: "🔴 No credit", cls: "bad" };
  return { text: "ℹ️ Unsure", cls: "neutral" };
}

function badgeForOutcome(m) {
  const map = { applied: "Applied", successful: "Successful", unsuccessful: "Unsuccessful", na: "Didn’t apply" };
  return { text: `📄 ${map[m.appliedStatus] || "—"}`, cls: "neutral" };
}

function badgeForAction(m) {
  const map = {
    credit: "Credit",
    season_return: "Season Ticket Return",
    fwd_me_credit: "Forwarded (credit)",
    fwd_me_nocredit: "Forwarded (no credit)",
    hosp_credit: "Hospitality (credit)",
    hosp_nocredit: "Hospitality (no credit)",
    scan_nocredit: "Scan in (no credit)"
  };
  return { text: `🎟️ ${map[m.ticketAction] || "—"}`, cls: "neutral" };
}

function setView(viewName) {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(t => t.classList.toggle("active", t.dataset.view === viewName));

  $("viewSetup").classList.toggle("hidden", viewName !== "setup");
  $("viewDash").classList.toggle("hidden", viewName !== "dash");
  $("viewMatches").classList.toggle("hidden", viewName !== "matches");
  $("viewAdd").classList.toggle("hidden", viewName !== "add");
  if (viewName === "fixtures") { setTimeout(() => { bindFixturesControls(); renderFixtures(); }, 0); }
  if (viewName === "setup") { setTimeout(renderSetupNames, 0); }
  $("viewFixtures").classList.toggle("hidden", viewName !== "fixtures");
  if (viewName === "fixtures") { setTimeout(() => { bindFixturesControls(); renderFixtures(); }, 0); }
}


function renderSeasonSelect() {
  const sel = $("seasonSelect");
  sel.innerHTML = "";
  for (const s of state.data.seasons) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    sel.appendChild(opt);
  }
  sel.value = activeSeasonId();

  // mirror into modals if present
  const onboardSeason = $("onboardSeason");
  if (onboardSeason) {
    onboardSeason.innerHTML = sel.innerHTML;
    onboardSeason.value = sel.value;
  }
  const setupSeason = $("setupSeason");
  if (setupSeason) {
    setupSeason.innerHTML = sel.innerHTML;
    setupSeason.value = sel.value;
  }
}

function renderAccountSelect() {
  const sel = $("accountSelect");
  if (!sel) return;
  sel.innerHTML = "";
  for (const a of state.data.accounts) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  }
  sel.value = state.data.activeAccountId || (state.data.accounts[0] ? state.data.accounts[0].id : "");
  if (!state.data.activeAccountId && sel.value) {
    state.data.activeAccountId = sel.value;
    save();
  }
}

function renderDashboard() {
  if (!activeAccountId()) {
    if ($("statHome")) setText("statHome", "0");
    if ($("statAway")) setText("statAway", "0");
    if ($("statTotal")) setText("statTotal", "0");
    setText("statSpend", formatGBP(0));
    setText("statAvgSpend", formatGBP(0));
    const mount = $("compBreakdown");
    if (mount) mount.innerHTML = '<div class="empty">👤 Add an account to start tracking.</div>';
    const root = $("recentList");
    if (root) root.innerHTML = '<div class="empty">No activity yet.</div>';
    return;
  }

  const totals = computeTotals(activeSeasonId());
  const spend = computeSpend(activeSeasonId());
  if ($("statHome")) setText("statHome", String(totals.home));
  if ($("statAway")) setText("statAway", String(totals.away));
  if ($("statTotal")) setText("statTotal", String(totals.total));
  setText("statSpend", formatGBP(spend.total));
  setText("statAvgSpend", formatGBP(spend.avg));

  // Competition breakdown table
  const acc = state.data.accounts.find(a => a.id === activeAccountId());
  const autoCup = (acc && acc.autoCup) ? acc.autoCup : {LC:false,FAC:false,UCL:false};
  const breakdown = computeBreakdownByCompetition(activeSeasonId());
  const labels = { PL: "Premier League", UCL: "UCL", FAC: "FA Cup", LC: "League Cup", OTHER: "Other" };
  const table = document.createElement("table");
  table.className = "breakdownTable";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Competition</th>
        <th>Home</th>
        <th>Away</th>
      </tr>
    </thead>`;
  const tbody = document.createElement("tbody");
  for (const key of Object.keys(breakdown)) {
    const row = document.createElement("tr");
    const comp = document.createElement("td");
    comp.textContent = labels[key] || key;
    const h = document.createElement("td");
    const homeAuto = (key === "LC" && autoCup.LC) || (key === "FAC" && autoCup.FAC) || (key === "UCL" && autoCup.UCL);
    if (homeAuto) {
      h.innerHTML = `<span class="breakdownPill neutral">AutoCup</span>`;
    } else {
      h.innerHTML = `<span class="breakdownPill good">H: ${breakdown[key].H}</span>`;
    }
    const a = document.createElement("td");
    a.innerHTML = `<span class="breakdownPill good">A: ${breakdown[key].A}</span>`;
    row.appendChild(comp);
    row.appendChild(h);
    row.appendChild(a);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  const mount = $("compBreakdown");
  mount.innerHTML = "";
  mount.appendChild(table);

  // Recent list: last 6 updated
  const matches = getSeasonMatches(activeSeasonId())
    .slice()
    .sort((a,b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
    .slice(0, 6);

  const root = $("recentList");
  root.innerHTML = "";

  if (matches.length === 0) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "🎟️ No matches yet — tap ➕ Add match to start tracking.";
    root.appendChild(div);
    return;
  }

  for (const m of matches) {
    root.appendChild(matchCard(m));
  }

}

function matchCard(m) {
  const div = document.createElement("div");
  div.className = "item";
  div.tabIndex = 0;
  div.role = "button";

  const top = document.createElement("div");
  top.className = "itemTop";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "itemTitle";
  title.textContent = formatMatchTitle(m);
  const meta = document.createElement("div");
  meta.className = "itemMeta";
  meta.textContent = formatMeta(m);
  left.appendChild(title);
  left.appendChild(meta);

  const right = document.createElement("div");
  const credit = badgeForCredit(m);
  const creditBadge = document.createElement("div");
  creditBadge.className = `badge ${credit.cls}`;
  creditBadge.textContent = credit.text;
  right.appendChild(creditBadge);

  top.appendChild(left);
  top.appendChild(right);

  const badges = document.createElement("div");
  badges.className = "itemBadges";

  if (typeof m.amountPaid === "number" && Number.isFinite(m.amountPaid)) {
    const cost = document.createElement("div");
    cost.className = "badge neutral";
    cost.textContent = `💷 ${formatGBP(m.amountPaid)}`;
    badges.appendChild(cost);
  }
  const b2 = badgeForAction(m);

  const action = document.createElement("div");
  action.className = `badge ${b2.cls}`;
  action.textContent = b2.text;

  const comp = document.createElement("div");
  comp.className = "badge red";
  comp.textContent = `🏷️ ${m.competition}`;
  badges.appendChild(action);
  badges.appendChild(comp);

  div.appendChild(top);
  div.appendChild(badges);

  if (m.notes && m.notes.trim()) {
    const notes = document.createElement("div");
    notes.className = "itemMeta";
    notes.style.marginTop = "8px";
    notes.textContent = `🗒️ ${m.notes.trim()}`;
    div.appendChild(notes);
  }

  div.addEventListener("click", () => editMatch(m.id));
  div.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") editMatch(m.id);
  });

  return div;
}

function renderMatches() {
  const list = $("matchesList");
  const empty = $("matchesEmpty");

  const q = $("searchInput").value.trim().toLowerCase();
  const v = $("filterVenue").value;
  const c = $("filterComp").value;
  const cr = $("filterCredit").value;

  const matches = getSeasonMatches(activeSeasonId())
    .filter(m => {
      if (v && m.venue !== v) return false;
      if (c && m.competition !== c) return false;
      if (cr && m.creditCounts !== cr) return false;
      if (q) {
        const hay = `${m.opponent} ${m.notes || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .slice()
    .sort((a,b) => {
      const mode = ($("matchSort") ? $("matchSort").value : "matchDate");
      if (mode === "dateAdded") {
        return (Number(b.createdAt||0) - Number(a.createdAt||0));
      }
      return (b.matchDate || "").localeCompare(a.matchDate || "");
    });

  list.innerHTML = "";
  if (matches.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const m of matches) list.appendChild(matchCard(m));
}

function clearForm() {
  $("matchId").value = "";
  $("opponent").value = "";
  $("matchDate").value = todayISODate();
  $("venue").value = "H";
  $("competition").value = "PL";
    $("ticketAction").value = "credit";
  setCreditChip("unsure");
  $("notes").value = "";
  $("amountPaid").value = "";
  $("btnDelete").hidden = true;
}

function setCreditChip(val) {
  $("creditCounts").value = val;
  document.querySelectorAll(".chip").forEach(ch => {
    ch.classList.toggle("active", ch.dataset.credit === val);
  });
}

function defaultCreditFromAction(action) {
  // Default credit behaviour from "Ticket" selection (user can override with chips)
  const map = {
    credit: "yes",
    season_return: "no",
    fwd_me_credit: "yes",
    fwd_me_nocredit: "no",
    hosp_credit: "yes",
    hosp_nocredit: "no",
    scan_nocredit: "no"
  };
  return map[action] || "unsure";
}

function upsertMatchFromForm() {
  const id = $("matchId").value || uid();
  const now = new Date().toISOString();

  const m = {
    id,
    accountId: activeAccountId(),
    seasonId: activeSeasonId(),
    opponent: $("opponent").value.trim(),
    venue: $("venue").value,
    competition: $("competition").value,
    matchDate: $("matchDate").value,
    appliedStatus: "na",
    ticketAction: $("ticketAction").value,
    creditCounts: $("creditCounts").value,
    notes: $("notes").value.trim(),
    amountPaid: parseAmount($("amountPaid").value),
    createdAt: now,
    updatedAt: now
  };

  if (!m.opponent) {
    alert("Please enter an opponent.");
    return null;
  }

  const existingIdx = state.data.matches.findIndex(x => x.id === id);
  if (existingIdx >= 0) {
    m.createdAt = state.data.matches[existingIdx].createdAt;
    state.data.matches[existingIdx] = m;
  } else {
    state.data.matches.push(m);
  }

  save();
  return m;
}

function editMatch(id) {
  const m = state.data.matches.find(x => x.id === id);
  if (!m) return;

  $("matchId").value = m.id;
  $("opponent").value = m.opponent || "";
  $("matchDate").value = m.matchDate || todayISODate();
  $("venue").value = m.venue || "H";
  $("competition").value = m.competition || "PL";
    $("ticketAction").value = m.ticketAction || "used";
  setCreditChip(m.creditCounts || "unsure");
  $("notes").value = m.notes || "";
  $("amountPaid").value = (m.amountPaid ?? "");

  $("btnDelete").hidden = false;
  setView("add");
}

function deleteCurrentMatch() {
  const id = $("matchId").value;
  if (!id) return;
  const ok = confirm("Delete this match entry?");
  if (!ok) return;

  state.data.matches = state.data.matches.filter(m => m.id !== id);
  save();
  clearForm();
  renderAll();
  setView("matches");
}

function downloadFile(filename, text, mime="application/octet-stream") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJSON() {
  const payload = JSON.stringify(state.data, null, 2);
  downloadFile(`thlfc-credits-${activeSeasonId()}-${new Date().toISOString().slice(0,10)}.json`, payload, "application/json");
}

function escapeCSV(s) {
  const str = String(s ?? "");
  if (/[,\"\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function exportCSV() {
  const seasonId = activeSeasonId();
  const rows = getSeasonMatches(seasonId)
    .slice()
    .sort((a,b) => (a.matchDate || "").localeCompare(b.matchDate || ""));

  const header = [
    "season","opponent","venue","competition","matchDate",
    "appliedStatus","ticketAction","creditCounts","amountPaid","notes","createdAt","updatedAt"
  ];

  const lines = [header.join(",")];
  for (const m of rows) {
    lines.push([
      seasonLabel(m.seasonId),
      m.opponent,
      m.venue,
      m.competition,
      m.matchDate,
      m.appliedStatus,
      m.ticketAction,
      m.creditCounts,
      m.amountPaid,
      m.notes,
      m.createdAt,
      m.updatedAt
    ].map(escapeCSV).join(","));
  }

  downloadFile(`thlfc-credits-${seasonId}-${new Date().toISOString().slice(0,10)}.csv`, lines.join("\n"), "text/csv");
}

function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!parsed || !parsed.seasons || !parsed.matches) throw new Error("Bad format");
      state.data = parsed;
      save();
      renderAll();
      alert("Import complete ✅");
    } catch {
      alert("Import failed ❌ (Invalid JSON backup)");
    }
  };
  reader.readAsText(file);
}

function openSettings() {
  $("ruleForwardedNoCredit").checked = !!state.data.settings.ruleForwardedNoCredit;
  $("ruleReturnedNoCredit").checked = !!state.data.settings.ruleReturnedNoCredit;
  $("ruleHospitalityNoCredit").checked = !!state.data.settings.ruleHospitalityNoCredit;
  $("settingsModal").showModal();
}

function closeSettings() {
  $("settingsModal").close();
}

function bindSettings() {
  onEl("ruleForwardedNoCredit","change",(e) => {
    state.data.settings.ruleForwardedNoCredit = e.target.checked;
    save();
  });
  onEl("ruleReturnedNoCredit","change",(e) => {
    state.data.settings.ruleReturnedNoCredit = e.target.checked;
    save();
  });
  onEl("ruleHospitalityNoCredit","change",(e) => {
    state.data.settings.ruleHospitalityNoCredit = e.target.checked;
    save();
  });
}

function addSeason() {
  const label = prompt("Season label (e.g. 2026/27):");
  if (!label) return;
  const id = label.replace(/\s+/g, "-").replace(/\//g, "-").toLowerCase();
  if (state.data.seasons.some(s => s.id === id)) {
    alert("That season already exists.");
    return;
  }
  state.data.seasons.push({ id, label, createdAt: new Date().toISOString() });
  state.data.activeSeasonId = id;
  save();
  renderAll();
}

function renderAll() {
  renderSeasonSelect();
  renderAccountSelect();
  renderDashboard();
  renderMatches();
}

function setupPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    const btn = $("btnInstall");
    btn.hidden = false;
    btn.addEventListener("click", async () => {
      btn.hidden = true;
      state.deferredPrompt.prompt();
      await state.deferredPrompt.userChoice;
      state.deferredPrompt = null;
    }, { once: true });
  });
}

function onEl(id, evt, fn, opts) {
  const el = $(id);
  if (!el) return;
  el.addEventListener(evt, fn, opts);
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      setView(tab.dataset.view);
      if (tab.dataset.view === "fixtures") {
        renderFixtures();
      }
    });
  });

  onEl("accountSelect","change",(e)=> setActiveAccount(e.target.value));
  onEl("seasonSelect","change",(e)=> setActiveSeason(e.target.value));
  onEl("btnAddAccount","click", openSetupForNewAccount);
  onEl("matchSort","change", renderMatches);

  
  $("btnClearForm").addEventListener("click", clearForm);

  document.querySelectorAll(".chip").forEach(ch => {
    ch.addEventListener("click", () => setCreditChip(ch.dataset.credit));
  });

  $("ticketAction").addEventListener("change", (e) => {
    const current = $("creditCounts").value;
    if (current === "unsure") {
      setCreditChip(defaultCreditFromAction(e.target.value));
    }
  });

  onEl("btnReloadFixtures","click", ()=>{ fixturesCache=null; renderFixtures(); });
  onEl("fixtureShow","change", renderFixtures);
  onEl("fixtureComp","change", renderFixtures);

  // Credit chips
  document.querySelectorAll("[data-credit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.getAttribute("data-credit");
      setCreditChip(val);
    });
  });

  // Fixtures import
  const fxInput = document.getElementById("importFixturesFile");
  if (fxInput) {
    fxInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const parsed = parseICSFixtures(text);
      const existing = getImportedFixtures();
      const map = new Map();
      [...existing, ...parsed].forEach(f=>{ if(f && f.id) map.set(f.id, f); });
      setImportedFixtures(Array.from(map.values()));
      fixturesCache = null;
      try { showToast(`Imported ${parsed.length} fixtures`); } catch(e) { alert(`Imported ${parsed.length} fixtures`); }
const ce=document.getElementById("fixturesCount"); if(ce) ce.textContent = `Imported ${parsed.length} fixtures`;
      renderFixtures();
      fxInput.value = "";
    });
  }
  const clearBtn = document.getElementById("btnClearFixtures");
  if (clearBtn) {
    clearBtn.addEventListener("click", ()=>{
      setImportedFixtures([]);
      fixturesCache = null;
      alert("Imported fixtures cleared");
      renderFixtures();
    });
  }

  $("matchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const m = upsertMatchFromForm();
    if (!m) return;
    clearForm();
    renderAll();
    setView("matches");
  });

  $("btnDelete").addEventListener("click", deleteCurrentMatch);

  ["searchInput","filterVenue","filterComp","filterCredit"].forEach(id => {
    $(id).addEventListener("input", renderMatches);
    $(id).addEventListener("change", renderMatches);
  });

  $("btnExportJSON").addEventListener("click", exportJSON);
  $("btnExportCSV").addEventListener("click", exportCSV);
  $("btnExportJSON2").addEventListener("click", exportJSON);
  $("btnExportCSV2").addEventListener("click", exportCSV);

  $("importFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importJSONFile(f);
    e.target.value = "";
  });
  $("importFile2").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importJSONFile(f);
    e.target.value = "";
  });

  onEl("btnSettings","click", openSettings);
  onEl("btnCloseSettings","click", closeSettings);
  bindSettings();

  // Setup screen
  onEl("setupCount","input", renderSetupNames);
  onEl("btnSetupCreate","click", () => { try { saveSetup(); } catch(e){ alert("Setup error: " + (e && e.message ? e.message : e)); console.error(e); } });
}

function init() {
  load();
  setupPWA();
  bindEvents();
  try { bindFixturesControls(); } catch(e) {}
  clearForm();
  renderAll();
  setView("dash");

  if (!state.data.accounts || state.data.accounts.length === 0) {
    setView("setup");
    renderSetupNames();
  try { populateAllSeasonSelects(); } catch(e) {}
}
}
document.addEventListener("DOMContentLoaded", init);
/* ---------- Accounts + Setup ---------- */


function renderSetupNames() {
  const wrap = $("setupNames");
  if (!wrap) return;

  const count = Math.max(1, Math.min(10, parseInt($("setupCount")?.value || "1", 10)));

    wrap.innerHTML = "";
  for (let i = 1; i <= count; i++) {
    const row = document.createElement("div");
    row.className = "item";

    row.innerHTML = `
      <div class="fieldLabel">Account ${i  try { populateAllSeasonSelects(); } catch(e) {}
}</div>
      <input class="input" id="setupName_${i}" placeholder="${i === 1 ? "Me" : "Account " + i}" />

      <div class="fieldLabel" style="margin-top:10px;">AutoCup (Home) for this account</div>
      <div class="row wrap gap">
        <label class="toggle">
          <input type="checkbox" id="setupAccLC_${i}" />
          <span>League Cup</span>
        </label>
        <label class="toggle">
          <input type="checkbox" id="setupAccFAC_${i}" />
          <span>FA Cup</span>
        </label>
        <label class="toggle">
          <input type="checkbox" id="setupAccUCL_${i}" />
          <span>Champions League</span>
        </label>
      </div>

      <div class="hint" style="margin-top:8px;">AutoCup only affects <strong>HOME</strong> credits. Away credits still tracked.</div>
    `;

    wrap.appendChild(row);
  }
}


function openSetupForNewAccount() {
  // Convenience: go to setup screen but keep existing accounts
  setView("setup");
  $("setupCount").value = "1";
  renderSetupNames();
}

function saveSetup() {
  const count = Math.max(1, Math.min(10, parseInt($("setupCount")?.value || "1", 10)));
  const season = $("setupSeason")?.value || activeSeasonId();
  setActiveSeason(season);

  const createdIds = [];

  // Create accounts from inputs (+ per-account AutoCup)
  for (let i = 1; i <= count; i++) {
    const val = ($("setupName_" + i)?.value || "").trim();
    const name = val || (i === 1 ? "Me" : `Account ${i}`);

    const autoCup = {
      LC: !!$("setupAccLC_" + i)?.checked,
      FAC: !!$("setupAccFAC_" + i)?.checked,
      UCL: !!$("setupAccUCL_" + i)?.checked
    };

    const acc = createAccount(name, autoCup);
    createdIds.push(acc.id);
  }

  // If adding a single new account, switch to it
  if (state.isAddingSingle && createdIds.length > 0) {
    setActiveAccount(createdIds[createdIds.length - 1]);
  } else if (!activeAccountId() && createdIds.length > 0) {
    setActiveAccount(createdIds[0]);
  }

  state.isAddingSingle = false;

  // Feedback
  try { showToast(`Saved ${createdIds.length} account(s)`); } catch(e) { if(createdIds.length===0) alert("No accounts were saved."); }

  renderAll();
  setView("dash");
}



function createAccount(name, autoCup={LC:false, FAC:false, UCL:false}) {
  const acc = {
    id: uid(),
    name: name.trim(),
    autoCup: {
      LC: !!autoCup.LC,
      FAC: !!autoCup.FAC,
      UCL: !!autoCup.UCL
    },
    createdAt: new Date().toISOString()
  };
  state.data.accounts.push(acc);
  if (!state.data.activeAccountId) state.data.activeAccountId = acc.id;
  save();
  return acc;
}



/* ---------- Fixtures ---------- */

var fixturesCache = null;




async function loadFixturesData() {
  if (fixturesCache) return fixturesCache;

  // Primary: embedded JSON in index.html (offline + SW-safe)
  try {
    const el = document.getElementById("fixturesData");
    if (el && el.textContent) {
      const arr = JSON.parse(el.textContent);
      fixturesCache = Array.isArray(arr) ? arr : [];
      return fixturesCache;
    }
  } catch(e) {}

  // Fallback: imported fixtures from localStorage
  try {
    const imported = getImportedFixtures();
    if (Array.isArray(imported) && imported.length) {
      fixturesCache = imported.slice();
      return fixturesCache;
    }
  } catch(e) {}

  fixturesCache = [];
  return fixturesCache;
}

function formatFixtureDate(f) {
  // Use date only (app stores matchDate only). Time may be 00:00 in feed.
  return f.date || (f.datetime_utc ? (f.datetime_utc.slice(0,10)) : "");
}

function fixtureRow(f) {
  const when = formatFixtureDate(f);
  const ha = (f.venue === "H") ? "H" : "A";
  const comp = f.competition || "OTHER";
  const opp = f.opponent || "—";
  const time = (f.time && f.time !== "00:00") ? ` • ${f.time}` : "";
  const el = document.createElement("div");
  el.className = "item clickable";
  el.innerHTML = `
    <div class="row space-between">
      <div>
        <div class="itemTitle">${opp}</div>
        <div class="hint">${when}${time} • ${comp} • ${ha}</div>
      </div>
      <div class="pill">${ha}</div>
    </div>
  `;
  el.addEventListener("click", () => prefillFromFixture(f));
  return el;
}

async function renderFixtures() {
  try {
    const listEl = document.getElementById("fixturesList");
    const emptyEl = document.getElementById("fixturesEmpty");
    const countEl = document.getElementById("fixturesCount");

    if (!listEl || !emptyEl) return;

    listEl.innerHTML = "";
    emptyEl.classList.add("hidden");
    if (countEl) countEl.textContent = "";

    const showSel = document.getElementById("fixtureShow");
    const compSel = document.getElementById("fixtureComp");
    const show = showSel ? showSel.value : "upcoming";
    const compFilter = compSel ? compSel.value : "";

    const data = (await loadFixturesData()).slice();
    if (countEl) countEl.textContent = `Loaded ${data.length} fixtures…`;

    const today = new Date();
    today.setUTCHours(0,0,0,0);

    let filtered = data.filter(f => {
      if (compFilter && f.competition !== compFilter) return false;
      const raw = (f.date || (f.datetime_utc||""));
      const d = parseYMD((raw || "").slice(0,10));
      if (!d) return false;
      if (show === "upcoming") return d >= today;
      if (show === "past") return d < today;
      return true;
    });

    filtered.sort((a,b)=> (a.date||"").localeCompare(b.date||""));
    if (show === "past") filtered.reverse();

    if (countEl) countEl.textContent = `Loaded ${data.length} fixtures • Showing ${filtered.length}`;

    if (filtered.length === 0) {
      emptyEl.classList.remove("hidden");
      emptyEl.textContent = (show === "past") ? "No past fixtures found." : "No fixtures match your filters.";
      return;
    }

    if (countEl) countEl.textContent = `Loaded ${data.length} fixtures • Showing ${filtered.length}`;

    listEl.innerHTML = filtered.map(f => {
      const when = (f.date || (f.datetime_utc||"").slice(0,10));
      const ha = (f.venue === "A") ? "A" : "H";
      const comp = f.competition || "OTHER";
      const opp = f.opponent || "—";
      const time = (f.time && f.time !== "00:00") ? ` • ${f.time}` : "";
      const fid = (f.id || "").replace(/"/g,'');
      return `
        <div class="item clickable" data-fixture-id="${fid}">
          <div class="row space-between">
            <div>
              <div class="itemTitle">${opp}</div>
              <div class="hint">${when}${time} • ${comp} • ${ha}</div>
            </div>
            <div class="pill">${ha}</div>
          </div>
        </div>
      `;
    }).join("");

    // Click delegation
    listEl.querySelectorAll("[data-fixture-id]").forEach(el => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-fixture-id");
        const fx = filtered.find(x => x.id === id) || filtered[0];
        prefillFromFixture(fx);
      });
    });

  } catch (e) {
    const emptyEl = document.getElementById("fixturesEmpty");
    if (emptyEl) {
      emptyEl.classList.remove("hidden");
      emptyEl.textContent = "Fixtures error: " + (e && e.message ? e.message : e);
    }
  }
}

function prefillFromFixture(f) {
  // Clear current form, then prefill and switch view
  clearForm();
  $("opponent").value = f.opponent || "";
  $("venue").value = (f.venue === "A") ? "A" : "H";
  // Map competitions to app options
  const comp = f.competition || "OTHER";
  if (["PL","UCL","FAC","LC","OTHER"].includes(comp)) {
    $("competition").value = comp;
  } else {
    $("competition").value = "OTHER";
  }
  $("matchDate").value = f.date || (f.datetime_utc ? f.datetime_utc.slice(0,10) : "");
  $("ticketAction").value = "credit";
  setCreditChip(defaultCreditFromAction("credit"));
  // Optional: store time in notes if provided
  if (f.time && f.time !== "00:00") {
    $("notes").value = `KO ${f.time} — ${$("notes").value || ""}`.trim();
  }
  setView("add");
}


function parseYMD(ymd){
  // ymd: YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd||"");
  if(!m) return null;
  const y=+m[1], mo=+m[2]-1, d=+m[3];
  return new Date(Date.UTC(y,mo,d));
}

function showToast(msg){
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.position="fixed";
  el.style.left="50%";
  el.style.bottom="24px";
  el.style.transform="translateX(-50%)";
  el.style.background="#111";
  el.style.color="#fff";
  el.style.padding="10px 14px";
  el.style.border="1px solid #333";
  el.style.borderRadius="999px";
  el.style.zIndex="9999";
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transition="opacity .25s"; }, 1200);
  setTimeout(()=>{ el.remove(); }, 1600);
}

/* Fixtures: ensure controls always re-render */
(function(){
  const fs = document.getElementById("fixtureShow");
  const fc = document.getElementById("fixtureComp");
  const fr = document.getElementById("btnReloadFixtures");
  if (fs) fs.addEventListener("change", renderFixtures);
  if (fc) fc.addEventListener("change", renderFixtures);
  if (fr) fr.addEventListener("click", ()=>{ fixturesCache=null; renderFixtures(); });
  const clr = document.getElementById("btnClearFixtures");
  if (clr) clr.addEventListener("click", ()=>{ setImportedFixtures([]); fixturesCache=null; try{showToast("Cleared imported fixtures");}catch(e){} renderFixtures(); });
})();


/* ---------- Fixtures Import (ICS) ---------- */

function getImportedFixtures(){
  try {
    const raw = localStorage.getItem("thlfc_importedFixtures");
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(e){ return []; }
}

function setImportedFixtures(arr){
  try { localStorage.setItem("thlfc_importedFixtures", JSON.stringify(arr || [])); } catch(e){}
}

function parseICSDate(line){
  // Supports: DTSTART:20260131T200000Z  or DTSTART:20260131
  const m = line.match(/DTSTART[^:]*:(\d{8})(T(\d{6})Z?)?/);
  if(!m) return null;
  const y=m[1].slice(0,4), mo=m[1].slice(4,6), d=m[1].slice(6,8);
  const dateStr = `${y}-${mo}-${d}`;
  let time="00:00";
  if(m[3]){
    time = `${m[3].slice(0,2)}:${m[3].slice(2,4)}`;
  }
  return { date: dateStr, time };
}

function cleanSummaryForTeams(s){
  return (s||"").replace(/[^\w\s\/\-\.\&]/g,"").trim();
}

function opponentVenueFromSummary(summary){
  const s = cleanSummaryForTeams(summary);
  const parts = s.split(/\s+vs\s+/i);
  if(parts.length!==2) return { opponent:s, venue:"H" };
  const left=parts[0].trim(), right=parts[1].trim();
  if(left.toLowerCase().startsWith("liverpool")) return { opponent:right, venue:"H" };
  return { opponent:left, venue:"A" };
}

function compFromDesc(desc){
  const d=(desc||"").toLowerCase();
  if(d.includes("premier league")) return "PL";
  if(d.includes("champions league")) return "UCL";
  if(d.includes("fa cup")) return "FAC";
  if(d.includes("carabao") || d.includes("league cup")) return "LC";
  return "OTHER";
}

function parseICSFixtures(text){
  const out=[];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  for(const b of blocks){
    const dtLine = (b.match(/DTSTART[^\r\n]*/)||[])[0];
    if(!dtLine) continue;
    const dt=parseICSDate(dtLine);
    if(!dt) continue;
    const summary = (b.match(/SUMMARY:(.+)\r?\n/)||[])[1] || "";
    const desc = (b.match(/DESCRIPTION:(.+)\r?\n/)||[])[1] || "";
    const loc = (b.match(/LOCATION:(.+)\r?\n/)||[])[1] || "";
    const {opponent, venue} = opponentVenueFromSummary(summary);
    const competition = compFromDesc(desc);
    const id = `${dt.date}-${competition.toLowerCase()}-${opponent.replace(/\s+/g,"").toLowerCase()}-${venue.toLowerCase()}-${dt.time.replace(":","")}`;
    out.push({
      id,
      date: dt.date,
      time: dt.time,
      datetime_utc: `${dt.date}T${dt.time}:00Z`,
      competition,
      opponent,
      venue,
      location: loc
    });
  }
  // de-dup
  const seen=new Set();
  return out.filter(f=>{ if(seen.has(f.id)) return false; seen.add(f.id); return true; });
}

// Force SW to check for updates (helps Netlify deploys)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistration().then(reg => { if (reg) reg.update(); });
}

function bindFixturesControls(){
  const fs = document.getElementById("fixtureShow");
  const fc = document.getElementById("fixtureComp");
  const fr = document.getElementById("btnReloadFixtures");
  if (fs) fs.onchange = () => renderFixtures();
  if (fc) fc.onchange = () => renderFixtures();
  if (fr) fr.onclick = () => { fixturesCache = null; renderFixtures(); };
}

function seasonLabel(startYY){
  const a = String(startYY).padStart(2,'0');
  const b = String((startYY+1)%100).padStart(2,'0');
  return `${a}/${b}`;
}
function populateSeasonSelect(sel){
  if(!sel) return;
  if(sel.options && sel.options.length > 0) return;
  const now = new Date();
  const yy = now.getFullYear() % 100;
  for(let i=0;i<8;i++){
    const opt = document.createElement("option");
    opt.value = seasonLabel(yy+i);
    opt.textContent = seasonLabel(yy+i);
    sel.appendChild(opt);
  }
}
function populateAllSeasonSelects(){
  document.querySelectorAll('select.seasonSelect, select[data-role="season"]').forEach(populateSeasonSelect);
}
