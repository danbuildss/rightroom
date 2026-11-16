// Rightroom back office. Plain JavaScript, no build step.
// It only calls the admin API with Dan's key; every rule (what can be verified, with which page)
// is enforced by the server. The key lives in sessionStorage: this tab only, gone when it closes.
"use strict";

const KEY_NAME = "rr_admin_key";
const SECTIONS = [
  ["overview", "Overview"],
  ["engine", "Engine status"],
  ["candidates", "New companies"],
  ["contacts", "Contacts"],
  ["inbox", "Signals inbox"],
  ["review", "Review queue"],
  ["companies", "All companies"],
  ["sources", "Sources"],
  ["requests", "Access requests"],
  ["founders", "Founders"],
  ["grok", "Grok"],
  ["ai", "AI helpers"],
  ["spend", "Spend"],
];
// The menu: 5 sections, each with tabs (the pages above).
const SEGMENTS = [
  ["home", "Home", ["overview", "engine"]],
  ["toreview", "To review", ["candidates", "contacts", "inbox", "review"]],
  ["companiesSeg", "Companies", ["companies", "sources"]],
  ["people", "People", ["requests", "founders"]],
  ["research", "Research & AI", ["grok", "ai", "spend"]],
];
const tabLabel = (id) => SECTIONS.find(([k]) => k === id)?.[1] ?? id;
const segmentOf = (id) => SEGMENTS.find(([, , tabs]) => tabs.includes(id)) ?? SEGMENTS[0];

// ---------- small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? esc(u) : "#");
const link = (u, text) =>
  `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${esc(text ?? u)} ↗</a>`;
const day = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const ago = (iso) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

function getKey() {
  try {
    return sessionStorage.getItem(KEY_NAME);
  } catch {
    return memoryKey;
  }
}
let memoryKey = null;
function setKey(k) {
  memoryKey = k;
  try {
    if (k) sessionStorage.setItem(KEY_NAME, k);
    else sessionStorage.removeItem(KEY_NAME);
  } catch {
    /* private mode: keep it in memory only */
  }
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(method, path, body) {
  const res = await fetch(path.startsWith("/api/") ? path : `/api/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getKey()}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    lock("Your key wasn't accepted. Paste it again.");
    throw new ApiError(401, "Signed out");
  }
  if (!res.ok) {
    const e = data?.error;
    const details = Array.isArray(e?.details) ? ` (${e.details.map((d) => d.message).join("; ")})` : "";
    throw new ApiError(res.status, `${e?.message ?? `Error ${res.status}`}${details}`);
  }
  return data;
}

function toast(message, opts = {}) {
  const el = document.createElement("div");
  el.className = `toast${opts.bad ? " bad" : ""}`;
  el.innerHTML = `<span class="dot"></span><span>${esc(message)}</span>`;
  if (opts.undo) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Undo";
    b.addEventListener("click", () => {
      el.remove();
      opts.undo();
    });
    el.append(b);
  }
  $("#toasts").append(el);
  setTimeout(() => el.remove(), opts.undo ? 8000 : 4500);
}

// Same idea as shared/evidence.ts: the claim's meaningful words, to highlight them in a sentence.
const STOP = new Set(
  "a an and are as at be been but by can for from has have in into is it its of on or our that the their them they this to was we were will with you your new now more all any about after also than then there these which who what when where how not no one two over out up so".split(" "),
);
const keywords = (t) => (String(t).toLowerCase().match(/[a-z0-9][a-z0-9.\-+]*[a-z0-9]|[a-z0-9]/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));
function highlight(sentence, claim) {
  const words = new Set(keywords(claim));
  return esc(sentence).replace(/[A-Za-z0-9][A-Za-z0-9.\-+]*[A-Za-z0-9]|[A-Za-z0-9]/g, (w) =>
    words.has(w.toLowerCase()) ? `<mark>${w}</mark>` : w,
  );
}
const needsExact = (excerpt) => !excerpt || String(excerpt).trim().startsWith("Search summary");

// ---------- shell, sign-in and routing ----------
let counts = {};

function renderNav() {
  const active = currentSection();
  const [activeSeg] = segmentOf(active);
  // What's waiting, per tab, and summed per section.
  const badge = {
    candidates: counts.engine?.waiting?.teams,
    contacts: counts.engine?.waiting?.contacts,
    inbox: counts.inbox_new,
    review: counts.waiting,
    requests: counts.access_requests_new,
  };
  const html = SEGMENTS.map(([id, label, tabs]) => {
    const n = tabs.reduce((sum, t) => sum + (Number(badge[t]) || 0), 0);
    return `<a href="#${tabs[0]}"${id === activeSeg ? ' class="on" aria-current="page"' : ""}>${label}${n ? ` <span class="count">${n}</span>` : ""}</a>`;
  }).join("");
  for (const nav of document.querySelectorAll("[data-nav]")) nav.innerHTML = html;
  const tabs = $("#tabs");
  if (tabs) {
    const [, , ids] = segmentOf(active);
    tabs.innerHTML = ids
      .map((t) => {
        const n = Number(badge[t]) || 0;
        return `<a href="#${t}"${t === active ? ' class="on" aria-current="page"' : ""}>${tabLabel(t)}${n ? ` <span class="count">${n}</span>` : ""}</a>`;
      })
      .join("");
  }
}

function currentSection() {
  const h = location.hash.replace("#", "");
  return SECTIONS.some(([id]) => id === h) ? h : "overview";
}

async function refreshCounts() {
  try {
    const [overview, engine] = await Promise.all([api("GET", "/overview"), api("GET", "/engine").catch(() => null)]);
    counts = { ...overview, engine };
  } catch {
    /* the page will show its own error */
  }
  renderNav();
  return counts;
}

function lock(message = "") {
  setKey(null);
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#login-err").textContent = message;
  $("#key").value = "";
  $("#key").focus();
}

async function unlock() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  try {
    const me = await api("GET", "/api/me");
    $("#who").textContent = me.email;
  } catch {
    return;
  }
  route();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("#key").value.trim();
  setKey(key);
  const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${key}` } }).catch(() => null);
  if (!res || !res.ok) {
    setKey(null);
    $("#login-err").textContent =
      res?.status === 401 ? "That key wasn't accepted." : "Couldn't reach the server. Try again.";
    return;
  }
  unlock();
});

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=lock]")) lock("Locked. Paste your key to continue.");
});

window.addEventListener("hashchange", route);

const views = {};
async function route() {
  if (!getKey()) return lock();
  const section = currentSection();
  renderNav();
  // A fresh element per page, so listeners from the previous page don't pile up.
  const old = $("#view");
  const main = old.cloneNode(false);
  old.replaceWith(main);
  main.innerHTML = `<nav class="subtabs" id="tabs" aria-label="Pages in this section"></nav><div class="viewbody"></div>`;
  renderNav();
  const view = $(".viewbody", main);
  view.innerHTML = `<div class="skel w40"></div><div class="skel w80"></div><div class="skel w60"></div>`;
  refreshCounts();
  try {
    await views[section](view);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    view.innerHTML = `<div class="empty"><b>Couldn't load this page</b>${esc(err.message)}</div>`;
  }
  main.focus({ preventScroll: true });
}

const header = (title, sub, right = "") =>
  `<div class="top"><div><h1>${esc(title)}</h1>${sub ? `<p class="subtle">${sub}</p>` : ""}</div>${right}</div>`;

// ---------- Engine status ----------
const RUN_STATE = { ok: ["ok", "Did work"], idle: ["grey", "Nothing to do"], failed: ["bad", "Failed"], running: ["blue", "Running"], cut_short: ["warn", "Started, didn't finish"] };
views.engine = async (view) => {
  const render = async () => {
    const e = await api("GET", "/engine");
    const ago = e.last_run_at ? Math.round((Date.now() - Date.parse(e.last_run_at)) / 60000) : null;
    const healthy = ago !== null && ago <= 25;
    view.innerHTML = `${header("Engine status", "Every 10 minutes Rightroom does one small job, taking turns: finding new teams, reading their websites, collecting signals, links, logos, contacts and AI checks. Each run is listed here.")}
      <div class="notice ${healthy ? "ok" : "warn"}">${
        ago === null
          ? "<b>No runs yet.</b> The first one starts within 10 minutes of this update going live. You can also press “Run one step now”."
          : healthy
            ? `<b>Running.</b> Last run ${ago <= 1 ? "just now" : `${ago} minutes ago`}.`
            : `<b>Not running on schedule.</b> Last run was ${ago} minutes ago. Check Cloudflare → Workers → rightroom → Settings → Triggers.`
      }</div>
      <div class="stats">
        <div class="stat"><div class="n">${e.today.teams}</div><div class="l">New teams found today</div></div>
        <div class="stat"><div class="n">${e.today.inbox_items}</div><div class="l">Signals collected today</div></div>
        <div class="stat"><div class="n">${e.today.contacts}</div><div class="l">Contacts found today</div></div>
        <div class="stat"><div class="n">${e.today.logos}</div><div class="l">Logos found today</div></div>
      </div>
      <div class="panel"><h2>Waiting for you</h2><div class="pad waitrow">
        <a href="#candidates"><b>${e.waiting.teams}</b> new companies</a>
        <a href="#contacts"><b>${e.waiting.contacts}</b> contacts</a>
        <a href="#inbox"><b>${e.waiting.inbox}</b> signals in the Inbox</a>
        <a href="#review"><b>${e.waiting.review}</b> in the review queue</a>
      </div></div>
      <div class="panel"><h2>Recent runs <span><button class="btn sm" type="button" data-tick>Run one step now</button></span></h2>
        ${
          e.runs.length
            ? `<table><tr><th>When</th><th>Job</th><th>Result</th></tr>${e.runs
                .map(
                  (r) => `<tr><td>${day(r.started_at)} ${new Date(r.started_at).toISOString().slice(11, 16)} UTC</td><td>${esc(r.label)}</td>
                  <td><span class="pill ${RUN_STATE[r.status]?.[0] ?? "grey"}">${RUN_STATE[r.status]?.[1] ?? esc(r.status)}</span> ${esc(r.summary ?? "")}${r.error ? `<br><span class="warn-t">${esc(r.error)}</span>` : ""}</td></tr>`,
                )
                .join("")}</table>`
            : `<div class="pad meta">No runs yet.</div>`
        }
      </div>`;
  };
  await render();
  view.onclick = async (ev) => {
    if (!ev.target.closest("[data-tick]")) return;
    const b = ev.target.closest("[data-tick]");
    b.disabled = true;
    b.textContent = "Running…";
    try {
      const { done } = await api("POST", "/engine/run");
      toast(done.map((d) => d.summary || d.task).join(" · "));
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
    }
    await render();
    refreshCounts();
  };
};

// ---------- Overview ----------
views.overview = async (view) => {
  const [o, req] = await Promise.all([api("GET", "/overview"), api("GET", "/access-requests?status=new&limit=5")]);
  counts = o;
  renderNav();
  const s = o.sources;
  view.innerHTML = `
    ${header("Overview", "Everything that needs you, in one place", o.waiting ? `<a class="btn blue" href="#review">Start reviewing →</a>` : "")}
    <div class="stats">
      <div class="stat"><div class="n">${o.public_companies}</div><div class="l">Companies verified (public)</div></div>
      <div class="stat"><div class="n">${o.waiting}</div><div class="l">Waiting for review</div></div>
      <div class="stat"><div class="n">${o.inbox_new}</div><div class="l">New in inbox</div></div>
      <div class="stat"><div class="n">${o.access_requests_new}</div><div class="l">New access requests</div></div>
    </div>
    <div class="panel">
      <h2>Access requests <span>you contact people yourself; Rightroom never emails</span></h2>
      ${requestTable(req.requests, "No new requests.")}
    </div>
    <div class="grid2">
      <div class="panel">
        <h2>Collector <span>checks due sources every hour</span></h2>
        <div class="pad">
          <p>${s.enabled} of ${s.total} sources on${s.paused ? ` · ${s.paused} paused` : ""}${s.failing ? ` · <span class="pill warn">${s.failing} failing</span>` : ""}</p>
          <p class="meta">Last run: ${o.last_run ? `${ago(o.last_run.started_at)} (${esc(o.last_run.status)})` : "none yet"}</p>
          <a class="btn sm" href="#sources">See sources</a>
        </div>
      </div>
      <div class="panel">
        <h2>Spend <span>Grok signal search</span></h2>
        <div class="pad">${spendBlock(o.spend)}</div>
      </div>
    </div>`;
  fillMeters(view);
  bindRequestActions(view, () => views.overview(view));
};

function spendBlock(sp) {
  const pct = sp.cap_usd ? Math.min(100, (sp.estimated_usd / sp.cap_usd) * 100) : 0;
  return `<div class="spend-n">$${sp.estimated_usd.toFixed(2)} <span>of $${sp.cap_usd} this month (${esc(sp.month)})</span></div>
    <div class="meter"><i data-width="${pct.toFixed(1)}"></i></div>
    <p class="meta">${sp.key_configured ? "On. Paid sources stop automatically at the cap; the xAI console limit is the hard stop." : "Off: no xAI key is set, so Grok sources are skipped and nothing is spent."}</p>`;
}
function fillMeters(root) {
  for (const i of root.querySelectorAll(".meter i")) i.style.width = `${i.dataset.width}%`;
}

// ---------- Requests ----------
function requestTable(rows, emptyText) {
  if (!rows.length) return `<div class="pad meta">${esc(emptyText)}</div>`;
  const pill = { new: "blue", invited: "ok", declined: "grey" };
  return `<table><tr><th>Founder</th><th class="hide-m">Looking for</th><th>Status</th><th><span class="sr">Actions</span></th></tr>
    ${rows
      .map(
        (r) => `<tr data-id="${esc(r.id)}">
        <td><b>${esc(r.name)}</b><br><span class="meta">${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ""}${r.email && r.x_handle ? " · " : ""}${r.x_handle ? link(`https://x.com/${r.x_handle}`, `@${r.x_handle}`) : ""}${r.website ? ` · ${link(r.website, r.website.replace(/^https?:\/\//, ""))}` : ""}</span><br><span class="meta">${day(r.created_at)}</span></td>
        <td class="goal hide-m">${esc(r.goal)}${r.note ? `<br><span class="meta">Note: ${esc(r.note)}</span>` : ""}</td>
        <td><span class="pill ${pill[r.status]}">${esc(r.status[0].toUpperCase() + r.status.slice(1))}</span></td>
        <td>${r.status === "new" ? `<span class="acts"><button class="btn sm" type="button" data-req="declined">Decline</button><button class="btn sm dark" type="button" data-req="invited">Mark invited</button></span>` : `<button class="btn sm" type="button" data-req="new">Move back to new</button>`}</td>
      </tr>`,
      )
      .join("")}</table>`;
}
function bindRequestActions(root, reload) {
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-req]");
    if (!b) return;
    const id = b.closest("tr").dataset.id;
    b.disabled = true;
    try {
      await api("PATCH", `/access-requests/${encodeURIComponent(id)}`, { status: b.dataset.req });
      toast(b.dataset.req === "invited" ? "Marked as invited." : b.dataset.req === "declined" ? "Declined." : "Moved back to new.");
      reload();
    } catch (err) {
      b.disabled = false;
      if (err.status !== 401) toast(err.message, { bad: true });
    }
  });
}
views.requests = async (view) => {
  const status = new URLSearchParams(location.search).get("status") ?? "new";
  const render = async (st) => {
    const { requests } = await api("GET", `/access-requests?status=${st}&limit=200`);
    view.innerHTML = `${header("Access requests", "From the Request access form. You contact people yourself; Rightroom never emails.")}
      <form class="panel pad invite-form" id="invite-form">
        <b>Invite someone directly</b>
        <div class="form-grid">
          <div><label for="inv-email">Email</label><input id="inv-email" name="email" type="email" maxlength="200" placeholder="name@company.com"></div>
          <div><label for="inv-x">or X handle</label><input id="inv-x" name="x_handle" maxlength="20" placeholder="@handle"></div>
          <div class="full"><label for="inv-name">Name (optional)</label><input id="inv-name" name="name" maxlength="100"></div>
        </div>
        <p class="help">They can then sign in at /app with that Google or email account, or that X account. Tell them yourself.</p>
        <button class="btn sm dark" type="submit">Add to the invited list</button>
      </form>
      <div class="tabs" role="group" aria-label="Show requests">${["new", "invited", "declined"].map((s) => `<button class="tab${s === st ? " on" : ""}" type="button" aria-pressed="${s === st}" data-tab="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}</div>
      <div class="panel mt">${requestTable(requests, `No ${st} requests.`)}</div>`;
  };
  await render(status);
  view.onclick = async (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) await render(t.dataset.tab);
  };
  view.addEventListener("submit", async (e) => {
    if (e.target.id !== "invite-form") return;
    e.preventDefault();
    const data = Object.fromEntries([...new FormData(e.target).entries()].filter(([, v]) => String(v).trim() !== ""));
    try {
      await api("POST", "/access-requests", data);
      toast("Added to the invited list.");
      await render("invited");
      refreshCounts();
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
    }
  });
  bindRequestActions(view, () => render(view.querySelector(".tab.on")?.dataset.tab ?? "new"));
};

// ---------- Review ----------
const REVIEW_PAGE = 15;
views.review = async (view) => {
  const { items } = await api("GET", "/queue");
  const state = { items, filter: "all", shown: REVIEW_PAGE, selected: new Set(), detail: new Map() };

  const filtered = () => state.items.filter((i) => state.filter === "all" || i.subject_type === state.filter);
  const n = (t) => state.items.filter((i) => t === "all" || i.subject_type === t).length;

  function render() {
    const list = filtered();
    view.innerHTML = `${header("Review queue", `${state.items.length} waiting · approve only what the page really says`,
      `<div class="tabs">${[["all", "All"], ["company", "Companies"], ["signal", "Signals"]].map(([k, l]) => `<button class="tab${state.filter === k ? " on" : ""}" type="button" data-filter="${k}">${l} ${n(k)}</button>`).join("")}</div>`)}
      ${list.length ? `<div class="toolbar"><span class="check meta">Tick items whose checks all passed to approve them together. Each approval records who, when and which page was checked.</span></div>` : `<div class="empty"><b>Nothing waiting 🎉</b>New imports and inbox items you turn into signals appear here.</div>`}
      <div id="cards">${list.slice(0, state.shown).map(cardShell).join("")}</div>
      ${list.length > state.shown ? `<div class="more"><button class="btn" type="button" data-more>Show ${Math.min(REVIEW_PAGE, list.length - state.shown)} more</button></div>` : ""}
      <div class="bar" id="bar" hidden><span id="bar-text"></span><span class="acts"><button class="btn sm" type="button" data-clear>Clear</button><button class="btn sm blue" type="button" data-batch>Approve</button></span></div>`;
    for (const item of list.slice(0, state.shown)) loadCard(item);
    updateBar();
  }

  function cardShell(item) {
    return `<article class="item" id="card-${esc(item.id)}" data-id="${esc(item.id)}" data-type="${item.subject_type}">
      <div class="ih"><button class="box" type="button" disabled aria-label="Select" data-select></button><div class="grow">
        <div class="kind">${item.subject_type === "company" ? "Company" : "Signal"}</div>
        <div class="title">${esc(item.label)}</div>
        <div class="meta">${item.check_url ? link(item.check_url) : "no page to check"} · added ${day(item.created_at)}</div>
      </div></div>
      <div class="ib" data-body><div class="skel w80"></div><div class="skel w60"></div><span class="reading">Reading the page…</span></div>
      <div class="if"><span class="hint" data-hint></span><div class="acts"><button class="btn sm danger" type="button" data-reject>Reject…</button><button class="btn sm blue" type="button" data-approve>✓ Approve</button></div></div>
    </article>`;
  }

  // Load details and evidence a few at a time, so the page doesn't hammer outside sites.
  const queue = [];
  let running = 0;
  function loadCard(item) {
    if (state.detail.has(item.id)) return paint(item);
    queue.push(item);
    pump();
  }
  function pump() {
    while (running < 3 && queue.length) {
      const item = queue.shift();
      running += 1;
      fetchDetail(item)
        .then((d) => {
          state.detail.set(item.id, d);
          paint(item);
        })
        .catch((err) => {
          const card = $(`#card-${CSS.escape(item.id)}`);
          if (card && err.status !== 401) $("[data-body]", card).innerHTML = `<p class="err-text">Couldn't load: ${esc(err.message)}</p>`;
        })
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  }
  async function fetchDetail(item) {
    if (item.subject_type === "company") {
      const [{ company }, evidence] = await Promise.all([
        api("GET", `/companies/${encodeURIComponent(item.id)}`),
        api("POST", `/companies/${encodeURIComponent(item.id)}/evidence`).catch((e) => ({ error: e.message })),
      ]);
      const eligible = Boolean(evidence.page?.reachable && evidence.name_found);
      return { company, evidence, eligible, checked: item.check_url };
    }
    const [{ signal }, evidence] = await Promise.all([
      api("GET", `/signals/${encodeURIComponent(item.id)}`),
      api("POST", `/signals/${encodeURIComponent(item.id)}/evidence`).catch((e) => ({ error: e.message })),
    ]);
    const companyOk = signal.company_status === "verified";
    const exact = !needsExact(signal.source_excerpt);
    const eligible = Boolean(companyOk && exact && evidence.page?.reachable);
    return { signal, evidence, eligible, companyOk, exact, checked: signal.primary_source?.url ?? item.check_url };
  }

  function paint(item) {
    const card = $(`#card-${CSS.escape(item.id)}`);
    const d = state.detail.get(item.id);
    if (!card || !d) return;
    const body = $("[data-body]", card);
    const hint = $("[data-hint]", card);
    const box = $("[data-select]", card);
    const approve = $("[data-approve]", card);
    box.disabled = !d.eligible;
    box.title = d.eligible ? "Select" : "Only items whose checks all passed can be approved together";
    approve.disabled = item.subject_type === "signal" && (!d.companyOk || !d.exact);

    if (item.subject_type === "company") {
      const c = d.company;
      const ev = d.evidence;
      const pageOk = ev.page?.reachable;
      body.innerHTML = `
        <div class="field"><span class="k">Website</span><span>${link(`https://${c.primary_domain}`, c.primary_domain)}</span></div>
        <div class="field"><span class="k">Description</span><span>${esc(c.description ?? "(none)")}</span></div>
        ${c.categories?.length ? `<div class="field"><span class="k">Sectors</span><span class="checks">${c.categories.map((x) => `<span class="pill grey">${esc(x.label)}</span>`).join("")}</span></div>` : ""}
        <div class="field"><span class="k">Checked now</span><span class="checks">
          ${ev.error ? `<span class="pill warn">Couldn't check: ${esc(ev.error)}</span>` : `
          <span class="pill ${pageOk ? "ok" : "bad"}">${pageOk ? "✓ Site loads" : `✗ ${esc(ev.page?.error ?? "Site didn't load")}`}</span>
          ${pageOk ? `<span class="pill ${ev.name_found ? "ok" : "bad"}">${ev.name_found ? `✓ Page names “${esc(c.name)}”` : `✗ Page doesn't mention “${esc(c.name)}”`}</span>` : ""}`}
        </span></div>
        ${ev.intro ? `<div class="field"><span class="k">Page starts</span><span class="meta">${esc(ev.intro.slice(0, 220))}…</span></div>` : ""}`;
      hint.textContent = d.eligible
        ? `Approving records: page checked = ${c.primary_domain}, by ${$("#who").textContent}, now`
        : "Open the site and check it's the right company before approving.";
      return;
    }

    const s = d.signal;
    const ev = d.evidence;
    const best = ev.matches?.[0];
    let proof;
    if (ev.error) {
      proof = `<div class="proof"><div class="ph"><span>Couldn't read the page: ${esc(ev.error)}</span></div>${d.exact ? `<div class="quote plain">“${esc(s.source_excerpt)}”</div>` : ""}</div>`;
    } else if (d.exact) {
      proof = `<div class="proof"><div class="ph"><span>Stored excerpt${ev.page?.reachable ? "" : ` · page didn't load (${esc(ev.page?.error ?? "error")})`}</span><span class="pill ok">✓ The page's own words</span></div>
        <div class="quote">“${highlight(s.source_excerpt, s.factual_claim)}”</div>
        ${best && best.sentence !== s.source_excerpt ? `<p class="help">Best match on the page today (${Math.round(best.score * 100)}%): “${esc(best.sentence)}”</p>` : ""}</div>`;
    } else {
      proof = `<div class="proof"><div class="ph"><span>The stored excerpt is a search summary, not the page's words</span><span class="pill warn">Needs the exact sentence</span></div>
        ${best ? `<div class="quote">“${highlight(best.sentence, s.factual_claim)}”</div><p class="help">Suggested from the page · ${Math.round(best.score * 100)}% of the claim's key words</p>` : `<p class="help">${ev.page?.reachable ? "No sentence on the page matches the claim well. Open it and paste the right sentence, or reject." : `The page didn't load (${esc(ev.page?.error ?? "error")}).`}</p>`}
        <div class="row-actions">${best ? `<button class="btn sm dark" type="button" data-use>Use this sentence</button>` : ""}<button class="btn sm" type="button" data-paste>Paste my own</button></div>
        <div data-paste-form hidden><label>Exact sentence from the page<textarea maxlength="2000" data-paste-text></textarea></label><button class="btn sm dark" type="button" data-save-paste>Save sentence</button></div></div>`;
    }
    body.innerHTML = `
      <div class="field"><span class="k">Company</span><span>${esc(s.company_name)} <span class="pill ${d.companyOk ? "ok" : "warn"}">${d.companyOk ? "company verified" : "company not verified yet"}</span></span></div>
      ${s.event_date ? `<div class="field"><span class="k">Date</span><span>${day(s.event_date)}</span></div>` : ""}
      <div class="field"><span class="k">Claim</span><span>${esc(s.factual_claim)}</span></div>
      <div class="field"><span class="k">From the page</span><div>${proof}</div></div>
      ${s.opportunity_note ? `<div class="field"><span class="k">Our view</span><span class="meta">${esc(s.opportunity_note)} (shown as our suggestion, never as fact)</span></div>` : ""}`;
    hint.textContent = !d.companyOk
      ? "Verify the company first; this signal stays hidden until it is."
      : !d.exact
        ? "Replace the search summary with the page's exact words first."
        : `Approving records: page checked = the source above, by ${$("#who").textContent}, now`;
    if (best) card.dataset.best = best.sentence;
  }

  function updateBar() {
    const bar = $("#bar");
    if (!bar) return;
    for (const card of view.querySelectorAll(".item")) {
      const on = state.selected.has(card.dataset.id);
      card.classList.toggle("sel", on);
      const box = $("[data-select]", card);
      box.classList.toggle("on", on);
      box.textContent = on ? "✓" : "";
      box.setAttribute("aria-pressed", String(on));
    }
    bar.hidden = state.selected.size === 0;
    $("#bar-text").textContent = `${state.selected.size} selected · all checks passed`;
    $("[data-batch]", bar).textContent = `✓ Approve ${state.selected.size}`;
  }

  function removeItems(ids) {
    state.items = state.items.filter((i) => !ids.includes(i.id));
    for (const id of ids) state.selected.delete(id);
    render();
    refreshCounts();
  }

  async function undo(reviewed) {
    try {
      const r = await api("POST", "/review/batch", {
        items: reviewed.map((i) => ({ subject_type: i.subject_type, id: i.id, action: "reopen" })),
      });
      toast(`${r.ok} moved back to the queue.`);
      const { items } = await api("GET", "/queue");
      state.items = items;
      render();
      refreshCounts();
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
    }
  }

  async function approve(itemsToApprove) {
    const payload = itemsToApprove.map((i) => ({
      subject_type: i.subject_type,
      id: i.id,
      action: "verify",
      checked_url: state.detail.get(i.id)?.checked ?? i.check_url,
    }));
    const r = await api("POST", "/review/batch", { items: payload });
    const okIds = r.results.filter((x) => x.ok).map((x) => x.id);
    const done = itemsToApprove.filter((i) => okIds.includes(i.id));
    for (const f of r.results.filter((x) => !x.ok)) toast(`Not approved: ${f.error}`, { bad: true });
    if (done.length) {
      toast(`${done.length} approved.`, { undo: () => undo(done) });
      removeItems(okIds);
    }
  }

  view.onclick = async (e) => {
    const t = e.target;
    const card = t.closest(".item");
    const item = card && state.items.find((i) => i.id === card.dataset.id);
    try {
      if (t.closest("[data-filter]")) {
        state.filter = t.closest("[data-filter]").dataset.filter;
        state.shown = REVIEW_PAGE;
        render();
      } else if (t.closest("[data-more]")) {
        state.shown += REVIEW_PAGE;
        render();
      } else if (t.closest("[data-select]") && item) {
        if (state.selected.has(item.id)) state.selected.delete(item.id);
        else state.selected.add(item.id);
        updateBar();
      } else if (t.closest("[data-clear]")) {
        state.selected.clear();
        updateBar();
      } else if (t.closest("[data-batch]")) {
        t.closest("[data-batch]").disabled = true;
        await approve(state.items.filter((i) => state.selected.has(i.id)));
      } else if (t.closest("[data-approve]") && item) {
        t.closest("[data-approve]").disabled = true;
        await approve([item]);
      } else if (t.closest("[data-reject]") && item) {
        showReject(card, item);
      } else if (t.closest("[data-confirm-reject]") && item) {
        const reason = $("[data-reason]", card).value.trim();
        if (!reason) return toast("Give a reason for rejecting.", { bad: true });
        const path = item.subject_type === "company" ? "companies" : "signals";
        await api("POST", `/${path}/${encodeURIComponent(item.id)}/review`, { action: "reject", reason });
        toast("Rejected.", { undo: () => undo([item]) });
        removeItems([item.id]);
      } else if (t.closest("[data-cancel-reject]") && card) {
        card.querySelector(".inline-form")?.remove();
      } else if (t.closest("[data-use]") && item) {
        await saveExcerpt(item, card.dataset.best);
      } else if (t.closest("[data-paste]") && card) {
        $("[data-paste-form]", card).hidden = false;
        $("[data-paste-text]", card).focus();
      } else if (t.closest("[data-save-paste]") && item) {
        const text = $("[data-paste-text]", card).value.trim();
        if (!text) return toast("Paste the sentence first.", { bad: true });
        await saveExcerpt(item, text);
      }
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
      for (const b of view.querySelectorAll("button[disabled][data-approve],button[disabled][data-batch]")) b.disabled = false;
    }
  };

  function showReject(card, item) {
    if (card.querySelector(".inline-form")) return;
    const f = document.createElement("div");
    f.className = "inline-form";
    f.innerHTML = `<label for="reason-${esc(item.id)}">Reason for rejecting</label>
      <input id="reason-${esc(item.id)}" data-reason maxlength="500" placeholder="e.g. page doesn't say this · wrong company · duplicate">
      <div class="row-actions"><button class="btn sm" type="button" data-cancel-reject>Cancel</button><button class="btn sm danger" type="button" data-confirm-reject>Reject</button></div>`;
    card.append(f);
    $("[data-reason]", f).focus();
  }

  async function saveExcerpt(item, sentence) {
    await api("PATCH", `/signals/${encodeURIComponent(item.id)}`, { source_excerpt: sentence });
    toast("Saved the page's sentence.");
    state.detail.delete(item.id);
    loadCard(item);
  }

  render();
};

// ---------- Inbox ----------
let signalTypes = null;
views.inbox = async (view) => {
  const [{ items }, types] = await Promise.all([
    api("GET", "/inbox?status=new"),
    signalTypes ? Promise.resolve({ types: signalTypes }) : api("GET", "/signal-types"),
  ]);
  signalTypes = types.types;
  const render = (list) => {
    view.innerHTML = `${header("Inbox", `${list.length} new · found by the collector. Turn one into a signal for review, or dismiss it.`)}
      ${list.length ? "" : `<div class="empty"><b>Inbox is empty</b>The collector checks due sources every hour.</div>`}
      ${list
        .map(
          (i) => `<article class="item" data-id="${esc(i.id)}">
        <div class="ih"><div class="grow">
          <div class="kind">${esc(i.source_name)}${i.suggested_signal_type ? ` · suggested: ${esc(signalTypes.find((t) => t.slug === i.suggested_signal_type)?.label ?? i.suggested_signal_type)}` : ""}</div>
          <div class="title">${esc(i.title)}</div>
          <div class="meta">${link(i.url)} · ${i.published_at ? `published ${day(i.published_at)}` : `found ${day(i.found_at)}`}</div>
        </div></div>
        ${i.excerpt ? `<div class="ib"><div class="quote plain">${esc(i.excerpt)}</div></div>` : ""}
        ${i.from_grok ? `<div class="if rate"><span class="hint">Grok test: was this worth finding?</span><div class="acts" role="group" aria-label="Rate this Grok result"><button class="btn sm${i.useful === 1 ? " blue" : ""}" type="button" data-rate="1" aria-pressed="${i.useful === 1}">👍 Useful</button><button class="btn sm${i.useful === 0 ? " dark" : ""}" type="button" data-rate="0" aria-pressed="${i.useful === 0}">👎 Not useful</button></div></div>` : ""}
        <div class="if"><span class="hint">Nothing is published from here: a new signal goes to the review queue.</span><div class="acts"><button class="btn sm" type="button" data-dismiss>Dismiss</button><button class="btn sm dark" type="button" data-promote>Make a signal…</button></div></div>
      </article>`,
        )
        .join("")}`;
  };
  render(items);

  view.onclick = async (e) => {
    const t = e.target;
    const card = t.closest(".item");
    const item = card && items.find((i) => i.id === card.dataset.id);
    if (!item) return;
    try {
      if (t.closest("[data-rate]")) {
        const useful = t.closest("[data-rate]").dataset.rate === "1";
        const next = item.useful === (useful ? 1 : 0) ? null : useful;
        await api("POST", `/inbox/${encodeURIComponent(item.id)}/rate`, { useful: next });
        item.useful = next === null ? null : next ? 1 : 0;
        render(items);
      } else if (t.closest("[data-dismiss]")) {
        await api("POST", `/inbox/${encodeURIComponent(item.id)}/dismiss`);
        toast("Dismissed.");
        items.splice(items.indexOf(item), 1);
        render(items);
        refreshCounts();
      } else if (t.closest("[data-promote]")) {
        if (card.querySelector(".inline-form")) return;
        const f = document.createElement("form");
        f.className = "inline-form";
        f.innerHTML = `<div class="form-grid">
          <div class="full"><label>Title<input name="title" required maxlength="200" value="${esc(item.title)}"></label></div>
          <div><label>Company domain<input name="company_domain" required placeholder="example.com" value="${esc(item.suggested_domain ?? "")}"></label><p class="help">The company must already be in the registry.</p></div>
          <div><label>Signal type<select name="signal_type" required>${signalTypes.map((st) => `<option value="${esc(st.slug)}"${st.slug === item.suggested_signal_type ? " selected" : ""}>${esc(st.label)}</option>`).join("")}</select></label></div>
          <div class="full"><label>Factual claim<textarea name="factual_claim" required maxlength="1000" placeholder="Exactly what the page supports, in one sentence."></textarea></label></div>
          <div class="full"><label>Exact words from the page<textarea name="source_excerpt" required maxlength="2000">${esc(item.excerpt ?? "")}</textarea></label><p class="help">Copy the sentence from the page itself.</p></div>
          <div><label>Event date (optional)<input name="event_date" type="date" value="${esc((item.published_at ?? "").slice(0, 10))}"></label></div>
          <div><label>Our view (optional)<input name="opportunity_note" maxlength="1000" placeholder="Why it might matter"></label></div>
        </div>
        <div class="row-actions"><button class="btn sm" type="button" data-cancel>Cancel</button><button class="btn sm blue" type="submit">Send to review</button></div>`;
        card.append(f);
        f.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const data = Object.fromEntries(new FormData(f).entries());
          for (const k of ["event_date", "opportunity_note"]) if (!data[k]) delete data[k];
          try {
            await api("POST", `/inbox/${encodeURIComponent(item.id)}/promote`, data);
            toast("Sent to the review queue.");
            items.splice(items.indexOf(item), 1);
            render(items);
            refreshCounts();
          } catch (err) {
            if (err.status !== 401) toast(err.message, { bad: true });
          }
        });
        f.querySelector("[name=factual_claim]").focus();
      } else if (t.closest("[data-cancel]")) {
        card.querySelector(".inline-form")?.remove();
      }
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
    }
  };
};

// ---------- Sources ----------
views.sources = async (view) => {
  const { sources } = await api("GET", "/watched-sources");
  const render = () => {
    view.innerHTML = `${header("Sources", `${sources.filter((s) => s.enabled).length} of ${sources.length} on · checked on their own schedule by the hourly collector`)}
      <div class="panel"><table>
        <tr><th>Source</th><th class="hide-m">Last success</th><th>Status</th><th><span class="sr">Actions</span></th></tr>
        ${sources
          .map((s) => {
            const status = !s.enabled
              ? `<span class="pill grey">Paused</span>`
              : s.consecutive_failures
                ? `<span class="pill warn">Failed ${s.consecutive_failures}×</span>`
                : `<span class="pill ok">OK</span>`;
            return `<tr data-id="${esc(s.id)}">
              <td><b>${esc(s.name)}</b><br><span class="meta">${esc(s.adapter)} · every ${s.interval_hours} h · ${link(s.url, s.url.replace(/^https?:\/\//, "").slice(0, 48))}</span>${s.last_error && s.enabled ? `<br><span class="err-text">${esc(s.last_error)}</span>` : ""}</td>
              <td class="hide-m meta">${ago(s.last_success_at)}</td>
              <td>${status}</td>
              <td><span class="acts"><button class="btn sm" type="button" data-toggle>${s.enabled ? "Pause" : "Resume"}</button>${s.enabled ? `<button class="btn sm" type="button" data-run>Check now</button>` : ""}</span></td>
            </tr>`;
          })
          .join("")}
      </table></div>`;
  };
  render();
  view.onclick = async (e) => {
    const t = e.target;
    const row = t.closest("tr[data-id]");
    const s = row && sources.find((x) => x.id === row.dataset.id);
    if (!s) return;
    try {
      if (t.closest("[data-toggle]")) {
        const { source } = await api("PATCH", `/watched-sources/${encodeURIComponent(s.id)}`, { enabled: !s.enabled });
        Object.assign(s, source);
        toast(source.enabled ? "Resumed." : "Paused.");
        render();
      } else if (t.closest("[data-run]")) {
        const b = t.closest("[data-run]");
        b.disabled = true;
        b.textContent = "Checking…";
        const { outcome } = await api("POST", `/watched-sources/${encodeURIComponent(s.id)}/run`);
        toast(outcome.status === "failed" ? `Failed: ${outcome.error ?? "error"}` : `Checked: ${outcome.items_new ?? 0} new`, {
          bad: outcome.status === "failed",
        });
        const fresh = await api("GET", "/watched-sources");
        sources.splice(0, sources.length, ...fresh.sources);
        render();
        refreshCounts();
      }
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
      render();
    }
  };
};

// ---------- Companies: profile (Explore labels), contacts and channels ----------
// Keep in step with shared/profile.ts.
const ORG_TYPES = [
  ["startup_product", "Startups & Products"],
  ["platform_api", "Platforms & APIs"],
  ["ecosystem", "Ecosystems"],
  ["distribution", "Distribution"],
  ["community_media", "Communities & Media"],
  ["accelerator_program", "Accelerators & Programs"],
];
const STAGES = [
  ["early", "Early stage"],
  ["growth", "Growth"],
  ["established", "Established"],
];
const AUDIENCES = [
  ["b2b", "B2B"],
  ["b2c", "Consumers"],
  ["developers", "Developers"],
];
const nameOf = (list, k) => list.find((x) => x[0] === k)?.[1] ?? "";
const profileLine = (c) =>
  [nameOf(ORG_TYPES, c.org_type), c.hq_country, nameOf(STAGES, c.stage), c.audiences.map((a) => nameOf(AUDIENCES, a)).join(", ")]
    .filter(Boolean)
    .join(" · ");
const PROFILE_PILL = {
  empty: `<span class="pill grey">No profile</span>`,
  suggested: `<span class="pill warn">Suggested: confirm</span>`,
  confirmed: `<span class="pill ok">Profile confirmed</span>`,
};

views.companies = async (view) => {
  let q = "";
  let mode = "all";
  let shown = [];
  const render = async () => {
    const base = `/companies?status=verified&limit=200${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    const [{ companies }, { companies: toConfirm }] = await Promise.all([
      api("GET", mode === "suggested" ? `${base}&profile=suggested` : base),
      api("GET", "/companies?status=verified&profile=suggested&limit=200"),
    ]);
    shown = companies;
    view.innerHTML = `${header("Companies", "Verified companies. Set each one's profile (type, location, stage, audience) for Explore, and add who to contact: named people only with a public source page, and official channels. Founders see a profile or contact only after you confirm it.")}
      <div class="toolbar"><div class="tabs" role="group" aria-label="Show companies">
        <button class="tab${mode === "all" ? " on" : ""}" type="button" data-mode="all" aria-pressed="${mode === "all"}">All</button>
        <button class="tab${mode === "suggested" ? " on" : ""}" type="button" data-mode="suggested" aria-pressed="${mode === "suggested"}">Profiles to confirm ${toConfirm.length}</button>
      </div></div>
      <form class="toolbar" id="co-search"><input name="q" placeholder="Search companies" value="${esc(q)}" maxlength="100"><button class="btn sm" type="submit">Search</button></form>
      <div class="toolbar"><span class="meta">Logos and links (X, GitHub, LinkedIn, docs, partner page, partnerships email) are read from each company's own website, a few each hour, and shown without review. Remove anything that's wrong.</span><div class="row-actions"><button class="btn sm" type="button" data-fill-web>Fill links from websites now</button><button class="btn sm" type="button" data-logos-missing>Find missing logos now</button></div></div>
      ${mode === "suggested" && companies.length ? `<div class="toolbar"><span class="meta">Check the suggestions below first.</span><button class="btn sm blue" type="button" data-confirm-all>✓ Confirm all ${companies.length} as suggested</button></div>` : ""}
      ${mode === "suggested" ? `<p class="help">These were pre-filled from each company's verified description and sectors. Location is left for you. Check them, fix any that are wrong with Profile ▾, then confirm.</p>` : ""}
      ${companies.length ? "" : `<div class="empty"><b>${mode === "suggested" ? "Nothing to confirm" : "No verified companies match"}</b>${mode === "suggested" ? "Every suggested profile is confirmed." : "Verify companies in Review first."}</div>`}
      ${companies
        .map(
          (c) => `<article class="item" data-id="${esc(c.id)}">
        <div class="ih co-ih"><div class="grow"><div class="title">${esc(c.name)} ${PROFILE_PILL[c.profile_status] ?? ""}</div><div class="meta">${link(`https://${c.primary_domain}`, c.primary_domain)}${c.is_sample ? " · sample" : ""}${profileLine(c) ? ` · ${esc(profileLine(c))}` : ""}</div></div>
        <div class="row-actions">${c.profile_status === "suggested" ? `<button class="btn sm blue" type="button" data-confirm>✓ Confirm</button>` : ""}<button class="btn sm" type="button" data-profile aria-expanded="false">Profile ▾</button><button class="btn sm" type="button" data-brand aria-expanded="false">Logo &amp; links ▾</button><button class="btn sm" type="button" data-contacts aria-expanded="false">Contacts ▾</button></div></div>
        <div class="ib pad-b" data-ppanel hidden></div>
        <div class="ib pad-b" data-bpanel hidden></div>
        <div class="ib pad-b" data-panel hidden></div>
      </article>`,
        )
        .join("")}`;
  };
  await render();

  const profilePanel = (card) => {
    const c = shown.find((x) => x.id === card.dataset.id);
    const box = $("[data-ppanel]", card);
    box.hidden = false;
    const opts = (list, v, none) =>
      `<option value="">${none}</option>${list.map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${l}</option>`).join("")}`;
    box.innerHTML = `<form class="inline-form flat" data-pform>
      <div class="form-grid">
        <div><label>Type (Explore category)<select name="org_type">${opts(ORG_TYPES, c.org_type, "Not set")}</select></label></div>
        <div><label>Headquarters country<input name="hq_country" maxlength="2" placeholder="US, NG, GB" value="${esc(c.hq_country ?? "")}"></label><p class="help">Two-letter code. Leave empty if you haven't checked it.</p></div>
        <div><label>Stage<select name="stage">${opts(STAGES, c.stage, "Not set")}</select></label></div>
        <div><fieldset class="checks"><legend>Sells to</legend>${AUDIENCES.map(([k, l]) => `<label class="check"><input type="checkbox" name="aud" value="${k}"${c.audiences.includes(k) ? " checked" : ""}> ${l}</label>`).join("")}</fieldset></div>
      </div>
      <button class="btn sm dark" type="submit">Save and confirm</button>
    </form>`;
    $("[data-pform]", box).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const country = f.hq_country.value.trim();
      try {
        await api("PATCH", `/companies/${encodeURIComponent(c.id)}`, {
          org_type: f.org_type.value || null,
          hq_country: country || null,
          stage: f.stage.value || null,
          audiences: [...f.querySelectorAll("[name=aud]:checked")].map((x) => x.value),
        });
        toast("Profile saved. Founders see it in Explore.");
        await render();
      } catch (err) {
        if (err.status !== 401) toast(err.message, { bad: true });
      }
    });
  };

  const brandPanel = async (card) => {
    const id = card.dataset.id;
    const c = shown.find((x) => x.id === id);
    const box = $("[data-bpanel]", card);
    box.hidden = false;
    box.innerHTML = `<span class="reading">Loading…</span>`;
    const [{ logo }, { company }, site] = await Promise.all([
      api("GET", `/companies/${encodeURIComponent(id)}/logo`),
      api("GET", `/companies/${encodeURIComponent(id)}`),
      api("GET", `/companies/${encodeURIComponent(id)}/website`),
    ]);
    const alias = (k) => company.aliases.find((a) => a.kind === k)?.value ?? "";
    const src = (k) => company.sources.find((x) => x.kind === k)?.url ?? "";
    const webl = (k) => site.web.find((w) => w.kind === k)?.value ?? "";
    const LABELS = { x: "X", github: "GitHub", linkedin: "LinkedIn", docs: "Docs", partners: "Partner page", email: "Partnerships email", contact_form: "Contact form" };
    const current = [
      ["x", alias("x_handle") && `https://x.com/${alias("x_handle")}`],
      ["github", alias("github_org") && `https://github.com/${alias("github_org")}`],
      ["linkedin", webl("linkedin")],
      ["docs", src("docs")],
      ["partners", src("partner_page")],
      ["email", webl("email")],
      ["contact_form", webl("contact_form")],
    ].filter(([, v]) => v);
    const state = !logo
      ? `<span class="pill grey">Not checked yet</span>`
      : logo.status === "found"
        ? `<span class="pill ok">Showing</span>`
        : logo.status === "hidden"
          ? `<span class="pill warn">Hidden by you</span>`
          : `<span class="pill grey">None found: initials shown</span>`;
    box.innerHTML = `<div class="logo-row">
        ${logo?.status === "found" ? `<img class="logo-prev" src="/api/public/logos/${encodeURIComponent(c.slug)}?v=${Date.now()}" alt="Current logo for ${esc(c.name)}">` : `<span class="logo-prev none">${esc(c.name.slice(0, 2).toUpperCase())}</span>`}
        <div class="grow"><div>${state}</div><div class="meta">${logo?.source_url ? `From ${link(logo.source_url)}` : ""}${logo ? ` · checked ${day(logo.checked_at)}` : ""}${logo?.note ? ` · ${esc(logo.note)}` : ""}</div></div>
      </div>
      <div class="row-actions mt-s">
        <button class="btn sm" type="button" data-lfetch>Find on their website</button>
        <button class="btn sm" type="button" data-lurl>Use an image link…</button>
        ${logo?.status === "hidden" ? "" : `<button class="btn sm danger" type="button" data-lhide>Hide logo</button>`}
      </div>
      <p class="help">PNG, JPEG, WebP, GIF or ICO, up to 100 KB. Never SVG. Shown only next to the company's own name in Explore and on its page.</p>
      <div class="webdet">
        <div class="ph"><b>Links founders see</b><span class="meta">${site.checked_at ? `Website read ${day(site.checked_at)}${site.note ? ` · ${esc(site.note)}` : ""}` : "Website not read yet"}</span></div>
        ${
          current.length
            ? `<ul class="detlist">${current
                .map(([k, v]) => `<li><span class="k">${LABELS[k]}</span>${k === "email" ? esc(v) : link(v)}<button class="btn sm" type="button" data-rmdet="${k}">Remove</button></li>`)
                .join("")}</ul>`
            : `<p class="meta">None yet.</p>`
        }
        ${site.blocked.length ? `<p class="help">You removed: ${site.blocked.map((k) => LABELS[k] ?? k).join(", ")}. The website reader won't add these again; set them by hand below if needed.</p>` : ""}
        <button class="btn sm" type="button" data-reread>Read their website again</button>
      </div>
      <form class="inline-form flat" data-links>
        <div class="form-grid">
          <div><label>X handle<input name="x" maxlength="60" placeholder="@company" value="${esc(alias("x_handle"))}"></label></div>
          <div><label>GitHub organisation<input name="github" maxlength="100" placeholder="company" value="${esc(alias("github_org"))}"></label></div>
          <div><label>Partner page<input name="partners" type="url" maxlength="500" placeholder="https://${esc(c.primary_domain)}/partners" value="${esc(src("partner_page"))}"></label></div>
          <div><label>Docs<input name="docs" type="url" maxlength="500" placeholder="https://docs.${esc(c.primary_domain)}" value="${esc(src("docs"))}"></label></div>
          <div><label>LinkedIn company page<input name="linkedin" type="url" maxlength="300" placeholder="https://www.linkedin.com/company/…" value="${esc(webl("linkedin"))}"></label></div>
          <div><label>Partnerships email (published by them)<input name="email" type="email" maxlength="200" placeholder="partners@${esc(c.primary_domain)}" value="${esc(webl("email"))}"></label></div>
        </div>
        <p class="help">Filled in automatically from their homepage where possible; anything you type here wins. Partner page and docs must be on ${esc(c.primary_domain)}. Clearing X or GitHub removes it. Never a guessed email.</p>
        <button class="btn sm dark" type="submit">Save links</button>
      </form>`;
    $("[data-links]", box).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const changes = [];
      for (const [field, kind, aliasKind] of [["x", "x", "x_handle"], ["github", "github", "github_org"]]) {
        const v = f[field].value.trim();
        const was = alias(aliasKind);
        if (v === was.replace(/^@/, "") || v === `@${was}` || v === was) continue;
        if (was) changes.push(() => api("DELETE", `/companies/${encodeURIComponent(id)}/details/${kind}`));
        if (v) changes.push(() => api("POST", `/companies/${encodeURIComponent(id)}/links`, { kind, value: v }));
      }
      for (const [field, kind, srcKind] of [["partners", "partners", "partner_page"], ["docs", "docs", "docs"]]) {
        const v = f[field].value.trim();
        if (v && v !== src(srcKind)) changes.push(() => api("POST", `/companies/${encodeURIComponent(id)}/links`, { kind, value: v }));
      }
      for (const kind of ["linkedin", "email"]) {
        const v = f[kind].value.trim();
        if (v && v !== webl(kind)) changes.push(() => api("POST", `/companies/${encodeURIComponent(id)}/links`, { kind, value: v }));
      }
      try {
        for (const run of changes) await run();
        toast(changes.length ? "Links saved. Founders see them now." : "Nothing changed.");
        brandPanel(card);
      } catch (err) {
        if (err.status !== 401) toast(err.message, { bad: true });
      }
    });
  };

  const panel = async (card) => {
    const id = card.dataset.id;
    const box = $("[data-panel]", card);
    box.hidden = false;
    box.innerHTML = `<span class="reading">Loading contacts…</span>`;
    const { contacts } = await api("GET", `/companies/${encodeURIComponent(id)}/contacts`);
    const statusPill = { needs_review: `<span class="pill warn">Waiting for your approval</span>`, verified: `<span class="pill ok">Verified</span>` };
    box.innerHTML = `${
      contacts.length
        ? contacts
            .map(
              (k) => `<div class="proof" data-contact="${esc(k.id)}"><div class="ph"><span>${k.kind === "person" ? `<b>${esc(k.name)}</b> · ${esc(k.role)}` : `<b>${esc(k.channel_label)}</b> · ${link(k.url)}`}</span>${statusPill[k.status] ?? ""}</div>
            <div class="meta">Source: ${link(k.source_url)} · confidence ${esc(k.confidence)}${k.last_checked_at ? ` · checked ${day(k.last_checked_at)}` : ""}</div>
            <div class="row-actions mt-s">${k.status === "needs_review" ? `<button class="btn sm blue" type="button" data-cverify>✓ Approve</button>` : `<button class="btn sm" type="button" data-cverify>Re-check (today)</button>`}<button class="btn sm danger" type="button" data-creject>Remove…</button></div></div>`,
            )
            .join("")
        : `<p class="meta">No contacts yet.</p>`
    }
      <form class="inline-form flat" data-add>
        <div class="form-grid">
          <div><label>Type<select name="kind"><option value="person">Named person</option><option value="channel">Official channel</option></select></label></div>
          <div><label>Confidence<select name="confidence"><option value="high">High: their own site says so</option><option value="medium">Medium: a reliable public page</option><option value="low">Low: older or indirect</option></select></label></div>
          <div data-for="person"><label>Name<input name="name" maxlength="120"></label></div>
          <div data-for="person"><label>Role<input name="role" maxlength="120" placeholder="Head of Partnerships"></label></div>
          <div data-for="channel" hidden><label>Channel<input name="channel_label" maxlength="120" placeholder="Partner application form"></label></div>
          <div data-for="channel" hidden><label>Channel link<input name="url" type="url" maxlength="500" placeholder="https://"></label></div>
          <div class="full"><label>Source page (shows this person or channel)<input name="source_url" type="url" maxlength="500" placeholder="https://"></label><p class="help">Public pages only. Never a guessed email.</p></div>
        </div>
        <button class="btn sm dark" type="submit">Add for review</button>
      </form>`;
    const form = $("[data-add]", box);
    const sync = () => {
      const kind = form.kind.value;
      for (const el of form.querySelectorAll("[data-for]")) el.hidden = el.dataset.for !== kind;
    };
    form.kind.addEventListener("change", sync);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form).entries());
      const payload =
        d.kind === "person"
          ? { kind: "person", name: d.name, role: d.role, source_url: d.source_url, confidence: d.confidence }
          : { kind: "channel", channel_label: d.channel_label, url: d.url, confidence: d.confidence, ...(d.source_url ? { source_url: d.source_url } : {}) };
      try {
        await api("POST", `/companies/${encodeURIComponent(id)}/contacts`, payload);
        toast("Added. Approve it to show it to founders.");
        panel(card);
      } catch (err) {
        if (err.status !== 401) toast(err.message, { bad: true });
      }
    });
  };

  view.onclick = async (e) => {
    const t = e.target;
    const card = t.closest(".item");
    try {
      if (t.closest("[data-mode]")) {
        mode = t.closest("[data-mode]").dataset.mode;
        await render();
      } else if (t.closest("[data-confirm-all]")) {
        const ids = shown.filter((c) => c.profile_status === "suggested").map((c) => c.id);
        if (!window.confirm(`Confirm ${ids.length} profiles exactly as suggested?`)) return;
        const { confirmed } = await api("POST", "/companies/profiles/confirm", { ids });
        toast(`${confirmed} profiles confirmed.`);
        await render();
      } else if (t.closest("[data-confirm]") && card) {
        await api("POST", "/companies/profiles/confirm", { ids: [card.dataset.id] });
        toast("Profile confirmed.");
        await render();
      } else if (t.closest("[data-logos-missing]")) {
        const b = t.closest("[data-logos-missing]");
        b.disabled = true;
        b.textContent = "Looking…";
        const { results } = await api("POST", "/logos/fetch-missing");
        toast(results.length ? `${results.filter((r) => r.status === "found").length} of ${results.length} logos found.` : "Every company's logo has been checked.");
        b.disabled = false;
        b.textContent = "Find missing logos now";
      } else if (t.closest("[data-brand]") && card) {
        const b = t.closest("[data-brand]");
        const open = b.getAttribute("aria-expanded") === "true";
        b.setAttribute("aria-expanded", String(!open));
        b.textContent = open ? "Logo & links ▾" : "Hide logo & links ▴";
        if (open) $("[data-bpanel]", card).hidden = true;
        else await brandPanel(card);
      } else if (t.closest("[data-rmdet]") && card) {
        await api("DELETE", `/companies/${encodeURIComponent(card.dataset.id)}/details/${t.closest("[data-rmdet]").dataset.rmdet}`);
        toast("Removed. It won't be added back automatically.");
        brandPanel(card);
      } else if (t.closest("[data-reread]") && card) {
        const r = await api("POST", `/companies/${encodeURIComponent(card.dataset.id)}/website`);
        toast(r.added.length ? `Added: ${r.added.join(", ")}.` : r.note || "Nothing new on their homepage.");
        brandPanel(card);
      } else if (t.closest("[data-fill-web]")) {
        const b = t.closest("[data-fill-web]");
        b.disabled = true;
        b.textContent = "Reading websites…";
        const { results } = await api("POST", "/website/fill-missing");
        const n = results.reduce((sum, r) => sum + r.added.length, 0);
        toast(results.length ? `${results.length} websites read, ${n} links added.` : "Every company's website has been read this month.");
        b.disabled = false;
        b.textContent = "Fill links from websites now";
      } else if (t.closest("[data-lfetch]") && card) {
        const r = await api("POST", `/companies/${encodeURIComponent(card.dataset.id)}/logo/fetch`, {});
        toast(r.status === "found" ? "Logo found." : "No usable logo on their site. Initials are shown.");
        brandPanel(card);
      } else if (t.closest("[data-lurl]") && card) {
        const url = window.prompt("Link to the company's logo image (https://, PNG/JPEG/WebP/GIF/ICO, up to 100 KB):");
        if (!url) return;
        const r = await api("POST", `/companies/${encodeURIComponent(card.dataset.id)}/logo/fetch`, { url });
        toast(r.status === "found" ? "Logo saved." : "That link isn't a usable image. Nothing changed for founders.", { bad: r.status !== "found" });
        brandPanel(card);
      } else if (t.closest("[data-lhide]") && card) {
        await api("POST", `/companies/${encodeURIComponent(card.dataset.id)}/logo/hide`);
        toast("Logo hidden. Founders see initials.");
        brandPanel(card);
      } else if (t.closest("[data-profile]") && card) {
        const b = t.closest("[data-profile]");
        const open = b.getAttribute("aria-expanded") === "true";
        b.setAttribute("aria-expanded", String(!open));
        b.textContent = open ? "Profile ▾" : "Hide profile ▴";
        if (open) $("[data-ppanel]", card).hidden = true;
        else profilePanel(card);
      } else if (t.closest("[data-contacts]") && card) {
        const b = t.closest("[data-contacts]");
        const open = b.getAttribute("aria-expanded") === "true";
        b.setAttribute("aria-expanded", String(!open));
        b.textContent = open ? "Contacts ▾" : "Hide ▴";
        if (open) $("[data-panel]", card).hidden = true;
        else await panel(card);
      } else if (t.closest("[data-cverify]") && card) {
        await api("POST", `/contacts/${encodeURIComponent(t.closest("[data-contact]").dataset.contact)}/review`, { action: "verify" });
        toast("Approved. Founders can see it now.");
        panel(card);
      } else if (t.closest("[data-creject]") && card) {
        const reason = window.prompt("Why remove it? (e.g. left the company, page changed)");
        if (!reason) return;
        await api("POST", `/contacts/${encodeURIComponent(t.closest("[data-contact]").dataset.contact)}/review`, { action: "reject", reason });
        toast("Removed.");
        panel(card);
      }
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
    }
  };
  view.addEventListener("submit", async (e) => {
    if (e.target.id !== "co-search") return;
    e.preventDefault();
    q = e.target.q.value.trim();
    await render();
  });
};

// ---------- Founders ----------
views.founders = async (view) => {
  const { founders } = await api("GET", "/founders");
  view.innerHTML = `${header("Founders", `${founders.length} signed up · each has a private workspace`)}
    <div class="panel">${
      founders.length
        ? `<table><tr><th>Founder</th><th class="hide-m">Company</th><th>Onboarding</th><th class="hide-m">Last sign-in</th></tr>
      ${founders
        .map(
          (f) => `<tr><td><b>${esc(f.name ?? "—")}</b>${f.role ? ` <span class="meta">· ${esc(f.role)}</span>` : ""}<br><span class="meta">${[f.email ? esc(f.email) : "", f.x_handle ? `@${esc(f.x_handle)}` : ""].filter(Boolean).join(" · ")}</span></td>
          <td class="hide-m">${esc(f.company_name ?? "—")}${f.website ? `<br>${link(f.website, f.website.replace(/^https?:\/\//, ""))}` : ""}</td>
          <td>${f.onboarded_at ? `<span class="pill ok">Done</span>` : `<span class="pill grey">Step ${Math.min(f.onboarding_step, 4)} of 4</span>`}</td>
          <td class="hide-m meta">${ago(f.last_sign_in_at)}</td></tr>`,
        )
        .join("")}</table>`
        : `<div class="pad meta">No founders yet. Invite people from Requests; they sign in at /app.</div>`
    }</div>`;
};

// ---------- Spend ----------
// ---------- New companies: early-stage teams found automatically ----------
const VIA = { hn: "Show HN", github: "GitHub", inbox: "Inbox" };
const TYPE_NAME = Object.fromEntries(ORG_TYPES);
views.candidates = async (view) => {
  let list = [];
  const picked = new Set();
  const render = async () => {
    ({ candidates: list } = await api("GET", "/candidates"));
    for (const id of [...picked]) if (!list.some((c) => c.id === id)) picked.delete(id);
    const ready = list.filter((c) => c.site_checked_at);
    view.innerHTML = `${header("New companies", `${list.length} early-stage teams waiting · found every day on Show HN, new GitHub repos and in your Inbox. Approving one makes it a verified company (checked against its own website) with an "Early stage" profile; its links and logo fill in automatically.`)}
      <div class="toolbar">
        <div class="row-actions"><button class="btn sm" type="button" data-find>Find new teams now</button><button class="btn sm" type="button" data-read>Read their websites (10)</button><button class="btn sm" type="button" data-aicheck>Check with AI (5)</button><button class="btn sm" type="button" data-pickai>Select AI-recommended</button></div>
        <div class="row-actions">
          <label class="check"><input type="checkbox" data-all ${ready.length && ready.every((c) => picked.has(c.id)) ? "checked" : ""}> Select all ready (${ready.length})</label>
          <button class="btn sm blue" type="button" data-approve ${picked.size ? "" : "disabled"}>✓ Approve ${picked.size || ""}</button>
          <button class="btn sm danger" type="button" data-reject ${picked.size ? "" : "disabled"}>Reject ${picked.size || ""}</button>
        </div>
      </div>
      <p class="help">Check each name and description against the website before approving. Rejected teams are never proposed again. At most 25 approvals at a time.</p>
      ${list.length ? "" : `<div class="empty"><b>Nothing waiting</b>New teams are looked for once a day. Press "Find new teams now" to look straight away.</div>`}
      ${list
        .map((c) => {
          const links = Object.entries(c.site_links || {});
          return `<article class="item cand${picked.has(c.id) ? " on" : ""}" data-id="${esc(c.id)}">
          <div class="ih"><label class="pick"><input type="checkbox" data-pick ${picked.has(c.id) ? "checked" : ""} ${c.site_checked_at || c.ai ? "" : "disabled"} aria-label="Select ${esc(c.site_name || c.name || c.domain)}"></label>
            <div class="grow">
              <input class="cname" data-name maxlength="200" value="${esc(c.ai?.name || c.site_name || c.name || c.domain)}" aria-label="Company name for ${esc(c.domain)}">
              <div class="meta">${link(`https://${c.domain}`, c.domain)} · found on ${link(c.found_url, VIA[c.found_via] ?? c.found_via)}${c.found_at ? ` · ${day(c.found_at)}` : ""}</div>
            </div>
            <span class="pill blue">${esc(TYPE_NAME[c.suggested_type] ?? "Startup")}</span>
          </div>
          <div class="ib">
            ${c.ai ? `<p class="aiv ${c.ai.is_company ? "yes" : "no"}"><b>AI: ${c.ai.is_company ? "looks like a real company" : "probably not a company"}</b> · ${esc(c.ai.reason)}${c.ai.is_company ? `<br>${c.ai.name ? `<b>${esc(c.ai.name)}</b> · ` : ""}${c.ai.one_liner ? esc(c.ai.one_liner) : ""}${c.ai.org_type ? ` · ${esc(TYPE_NAME[c.ai.org_type] ?? c.ai.org_type)}` : ""}${c.ai.stage && c.ai.stage !== "unknown" ? ` · ${esc(c.ai.stage)}` : ""}${c.ai.sectors?.length ? ` · ${c.ai.sectors.map(esc).join(", ")}` : ""}` : ""}</p>` : ""}
            ${c.site_checked_at ? (c.site_description ? `<p>${esc(c.site_description)}</p>` : `<p class="meta">No description on their homepage${c.site_note ? `: ${esc(c.site_note)}` : "."}</p>`) : `<p class="meta">Website not read yet.</p>`}
            <p class="meta">Found as: “${esc(c.found_title)}”</p>
            ${links.length ? `<p class="meta">From their site: ${links.map(([k, v]) => (k === "email" ? esc(v) : link(v, k))).join(" · ")}</p>` : ""}
            ${c.suggested_categories.length ? `<p class="meta">Sectors: ${c.suggested_categories.map(esc).join(", ")}</p>` : ""}
          </div>
        </article>`;
        })
        .join("")}`;
  };
  await render();

  view.onchange = (e) => {
    const t = e.target;
    if (t.matches("[data-pick]")) {
      const id = t.closest(".item").dataset.id;
      t.checked ? picked.add(id) : picked.delete(id);
      render();
    } else if (t.matches("[data-all]")) {
      for (const c of list) if (c.site_checked_at) t.checked ? picked.add(c.id) : picked.delete(c.id);
      render();
    }
  };
  view.onclick = async (e) => {
    const t = e.target;
    try {
      if (t.closest("[data-find]")) {
        t.closest("[data-find]").disabled = true;
        const r = await api("POST", "/candidates/find");
        const added = r.sources.reduce((n, x) => n + x.added, 0);
        const errs = r.sources.filter((x) => x.error).map((x) => `${VIA[x.source] ?? x.source}: ${x.error}`);
        toast(`${added} new teams found${errs.length ? ` (${errs.join("; ")})` : ""}.`, { bad: errs.length > 0 });
        await render();
      } else if (t.closest("[data-aicheck]")) {
        t.closest("[data-aicheck]").disabled = true;
        const r = await api("POST", "/candidates/ai-check");
        toast(r.errors.length ? `${r.checked} checked · ${r.errors[0]}` : `${r.checked} checked by AI.`, { bad: r.errors.length > 0 && !r.checked });
        await render();
      } else if (t.closest("[data-pickai]")) {
        for (const c of list) if (c.ai?.is_company) picked.add(c.id);
        await render();
      } else if (t.closest("[data-read]")) {
        const r = await api("POST", "/candidates/read-sites");
        toast(`${r.read} websites read.`);
        await render();
      } else if (t.closest("[data-approve]")) {
        const ids = [...picked].slice(0, 25);
        const names = {};
        for (const id of ids) {
          const v = view.querySelector(`.item[data-id="${CSS.escape(id)}"] [data-name]`)?.value.trim();
          if (v) names[id] = v;
        }
        if (!window.confirm(`Approve ${ids.length} companies? They become verified and founders can see them.`)) return;
        const { results } = await api("POST", "/candidates/approve", { ids, names });
        const ok = results.filter((r) => r.ok).length;
        const bad = results.filter((r) => !r.ok);
        toast(`${ok} companies added${bad.length ? `; ${bad.length} skipped (${[...new Set(bad.map((b) => b.error))].join(", ")})` : ""}.`, { bad: bad.length > 0 });
        picked.clear();
        await render();
        refreshCounts();
      } else if (t.closest("[data-reject]")) {
        if (!window.confirm(`Reject ${picked.size} teams? They won't be proposed again.`)) return;
        const { rejected } = await api("POST", "/candidates/reject", { ids: [...picked] });
        toast(`${rejected} rejected.`);
        picked.clear();
        await render();
      }
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
      await render();
    }
  };
};

// ---------- Contacts: points of contact found automatically, approved in batches ----------
const FROM = { "website-reader": "their website", grok: "Grok (their own X post)" };
views.contacts = async (view) => {
  let list = [];
  const picked = new Set();
  const render = async () => {
    ({ contacts: list } = await api("GET", "/contacts/pending"));
    for (const id of [...picked]) if (!list.some((c) => c.id === id)) picked.delete(id);
    view.innerHTML = `${header("Contacts", `${list.length} waiting · named people and official channels found on each company's own team, about and partner pages, and by Grok. Founders see a contact only after you approve it. Never a guessed email.`)}
      <div class="toolbar">
        <button class="btn sm" type="button" data-findc>Find contacts now (5 companies)</button>
        <div class="row-actions">
          <label class="check"><input type="checkbox" data-allc ${list.length && list.every((c) => picked.has(c.id)) ? "checked" : ""}> Select all (${list.length})</label>
          <button class="btn sm blue" type="button" data-okc ${picked.size ? "" : "disabled"}>✓ Approve ${picked.size || ""}</button>
          <button class="btn sm danger" type="button" data-noc ${picked.size ? "" : "disabled"}>Reject ${picked.size || ""}</button>
        </div>
      </div>
      <p class="help">Open the source page for anyone you're unsure about: the person must be shown there in that role. Grok contacts come from the person's own post on X.</p>
      ${list.length ? "" : `<div class="empty"><b>Nothing waiting</b>Companies' pages are read a few each hour. Press "Find contacts now" to look straight away.</div>`}
      ${
        list.length
          ? `<div class="panel"><table><tr><th><span class="sr">Select</span></th><th>Company</th><th>Contact</th><th class="hide-m">Found on</th></tr>
        ${list
          .map(
            (k) => `<tr data-cid="${esc(k.id)}" class="${picked.has(k.id) ? "on" : ""}">
            <td><input type="checkbox" data-pickc ${picked.has(k.id) ? "checked" : ""} aria-label="Select ${esc(k.kind === "person" ? k.name : k.channel_label)} at ${esc(k.company)}"></td>
            <td><b>${esc(k.company)}</b><br><span class="meta">${esc(k.domain)}</span></td>
            <td>${k.kind === "person" ? `<b>${esc(k.name)}</b><br><span class="meta">${esc(k.role)}</span>` : `<b>${esc(k.channel_label)}</b><br>${link(k.url)}`}</td>
            <td class="hide-m">${link(k.source_url, "source page")}<br><span class="meta">${esc(FROM[k.created_by] ?? "added by hand")} · ${esc(k.confidence)}</span></td>
          </tr>`,
          )
          .join("")}</table></div>`
          : ""
      }`;
  };
  await render();

  view.onchange = (e) => {
    const t = e.target;
    if (t.matches("[data-pickc]")) {
      const id = t.closest("[data-cid]").dataset.cid;
      t.checked ? picked.add(id) : picked.delete(id);
      render();
    } else if (t.matches("[data-allc]")) {
      for (const c of list) t.checked ? picked.add(c.id) : picked.delete(c.id);
      render();
    }
  };
  view.onclick = async (e) => {
    const t = e.target;
    try {
      if (t.closest("[data-findc]")) {
        t.closest("[data-findc]").disabled = true;
        const { results } = await api("POST", "/contacts/find-missing");
        const n = results.reduce((sum, r) => sum + r.added, 0);
        toast(results.length ? `${results.length} companies read, ${n} contacts found.` : "Every company was looked at this month.");
        await render();
      } else if (t.closest("[data-okc]") || t.closest("[data-noc]")) {
        const approve = Boolean(t.closest("[data-okc]"));
        let reason;
        if (!approve) {
          reason = window.prompt("Why reject these? (e.g. not on the page, left the company)", "Not right");
          if (!reason) return;
        }
        const { done } = await api("POST", "/contacts/review-batch", { ids: [...picked], action: approve ? "verify" : "reject", reason });
        toast(approve ? `${done} contacts approved. Founders can see them now.` : `${done} rejected.`);
        picked.clear();
        await render();
      }
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
      await render();
    }
  };
};

// ---------- AI helpers (Bankr LLM gateway) ----------
views.ai = async (view) => {
  let models = null;
  const render = async () => {
    const a = await api("GET", "/ai");
    const pct = a.budget.cap ? Math.min(100, (a.budget.spent / a.budget.cap) * 100) : 0;
    view.innerHTML = `${header("AI helpers", "Your Bankr LLM credit, used in the back office only: it checks whether new teams are real companies (with a clean one-liner, type and sectors) and reads team pages for contacts, leaving out investors. Only public website text is sent; never founders' data. You still approve everything.")}
      <div class="panel"><h2>Status <span>Rightroom's estimate · Bankr's dashboard shows the real balance</span></h2><div class="pad">
        <div class="spend-n">${usd(a.budget.spent)} <span>spent of ${usd(a.budget.cap)} this month · ${usd(a.budget.left)} left · ${a.month.calls} calls${a.month.failed ? ` (${a.month.failed} failed)` : ""}</span></div>
        <div class="meter"><i data-width="${pct.toFixed(1)}"></i></div>
        <p class="meta">${a.key_set ? `Key set · model: <b>${a.model ? esc(a.model) : "none chosen yet"}</b> · ${a.on ? "<b>on</b>: new companies and contacts are checked a few each hour" : "off until you choose a model"}` : "<b>Off:</b> add <code>BANKR_LLM_KEY</code> as a secret in Cloudflare (Workers → rightroom → Settings). Optional variables: <code>AI_MONTHLY_CAP_USD</code> (default 20), <code>AI_PRICE_INPUT_PER_M_USD</code> and <code>AI_PRICE_OUTPUT_PER_M_USD</code> for the chosen model's prices (defaults 3 and 15, cautious)."}</p>
      </div></div>
      ${
        a.key_set
          ? `<div class="panel"><h2>Model <span>A fast, cheap model is enough (for example a Haiku, Flash or mini model)</span></h2><div class="pad">
        <form class="toolbar flat" id="ai-model">
          <label class="sr" for="ai-pick">Model</label>
          ${models ? `<select id="ai-pick" name="model">${models.map((m) => `<option ${m === a.model ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>` : `<input id="ai-pick" name="model" maxlength="120" placeholder="model id" value="${esc(a.model ?? "")}">`}
          <button class="btn sm dark" type="submit">Use this model</button>
          ${models ? "" : `<button class="btn sm" type="button" data-models>Load Bankr's model list</button>`}
          <button class="btn sm" type="button" data-aitest ${a.model ? "" : "disabled"}>Test (tiny call)</button>
        </form>
      </div></div>`
          : ""
      }
      <div class="panel"><h2>Recent calls</h2>${
        a.recent.length
          ? `<table><tr><th>When</th><th>For</th><th class="hide-m">Model</th><th>Tokens</th><th>Cost</th></tr>${a.recent
              .map(
                (r) => `<tr><td>${day(r.created_at)} ${new Date(r.created_at).toISOString().slice(11, 16)}</td><td>${esc(r.purpose)}${r.status === "failed" ? `<br><span class="warn-t">${esc(r.error ?? "failed")}</span>` : ""}</td><td class="hide-m">${esc(r.model)}</td><td>${r.input_tokens} in · ${r.output_tokens} out</td><td>${usd(r.estimated_usd, 4)}</td></tr>`,
              )
              .join("")}</table>`
          : `<div class="pad meta">No calls yet.</div>`
      }</div>`;
    fillMeters(view);
  };
  await render();
  view.onclick = async (e) => {
    const t = e.target;
    try {
      if (t.closest("[data-models]")) {
        ({ models } = await api("GET", "/ai/models"));
        toast(`${models.length} models available.`);
        await render();
      } else if (t.closest("[data-aitest]")) {
        const r = await api("POST", "/ai/test");
        toast(`It works. The model answered: ${r.answer}`);
        await render();
      }
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
    }
  };
  view.onsubmit = async (e) => {
    if (e.target.id !== "ai-model") return;
    e.preventDefault();
    const model = e.target.model.value.trim();
    if (!model) return;
    try {
      await api("POST", "/ai/model", { model });
      toast(`Using ${model}.`);
      await render();
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
    }
  };
};

// ---------- Grok research (the 3 USD test) ----------
const usd = (n, d = 2) => (n === null || n === undefined ? "—" : `$${Number(n).toFixed(d)}`);
views.grok = async (view) => {
  const render = async () => {
    const [g, { suggestions }, { companies }, { results }] = await Promise.all([
      api("GET", "/grok"),
      api("GET", "/grok/handles"),
      api("GET", "/companies?status=verified&limit=200"),
      api("GET", "/grok/results"),
    ]);
    const STATE = { new: ["blue", "In your Inbox"], promoted: ["ok", "Made a signal"], dismissed: ["grey", "Dismissed"] };
    const resultsPanel = `<div class="panel"><h2>Results <span>Every post Grok found, newest first · rate them here or turn them into signals in the Inbox</span></h2>
      ${
        results.length
          ? `<div class="gres">${results
              .map(
                (r) => `<article class="gpost" data-rid="${esc(r.id)}">
              <div class="ph"><span class="meta">${esc(r.search.replace(/^Grok (test|research): /, ""))}${r.published_at ? ` · ${day(r.published_at)}` : ""}</span><span class="pill ${STATE[r.status]?.[0] ?? "grey"}">${STATE[r.status]?.[1] ?? esc(r.status)}</span></div>
              <p class="gtitle">${esc(r.title)}</p>
              ${r.excerpt && r.excerpt !== r.title ? `<p class="meta">${esc(r.excerpt)}</p>` : ""}
              <div class="row-actions">${link(r.url, "Open the post")}${r.suggested_domain ? ` <span class="meta">· ${esc(r.suggested_domain)}</span>` : ""}
                <span class="grow"></span>
                <button class="btn sm${r.useful === 1 ? " blue" : ""}" type="button" data-grate="1" aria-pressed="${r.useful === 1}">👍 Useful</button>
                <button class="btn sm${r.useful === 0 ? " dark" : ""}" type="button" data-grate="0" aria-pressed="${r.useful === 0}">👎 Not useful</button>
              </div>
            </article>`,
              )
              .join("")}</div>`
          : `<div class="pad meta">Nothing yet. Run a search or research a company; what Grok finds appears here.</div>`
      }</div>`;
    const pct = g.budget.cap ? Math.min(100, (g.budget.spent / g.budget.cap) * 100) : 0;
    const topics = g.searches.filter((x) => x.kind === "topic");
    const research = g.searches.filter((x) => x.kind === "company");
    const testTopics = topics.filter((x) => x.name.startsWith("Grok test:"));
    const otherTopics = topics.filter((x) => !x.name.startsWith("Grok test:"));
    const canRun = g.key_set;
    const runBtn = (x) =>
      `<button class="btn sm dark" type="button" data-run="${esc(x.id)}" data-est="${x.estimate_usd ?? 0}" ${canRun ? "" : "disabled"}>Run (up to ${usd(x.estimate_usd)})</button>`;
    const row = (x) => `<tr>
        <td><b>${esc(x.name.replace(/^Grok (test|research): /, ""))}</b><br><span class="meta">${esc(x.query)}${x.lookback_days ? ` · last ${x.lookback_days} days · up to ${x.max_posts} posts` : ""}</span>${x.last_error ? `<br><span class="meta warn-t">${esc(x.last_error)}</span>` : ""}</td>
        <td class="hide-m">${x.runs}<br><span class="meta">${x.last_run_at ? day(x.last_run_at) : "never"}</span></td>
        <td>${usd(x.cost_usd)}<br><span class="meta">${x.last_cost_usd !== null ? `last ${usd(x.last_cost_usd, 3)} · ${x.last_posts_read ?? 0} posts read` : ""}</span></td>
        <td>${x.items}<br><span class="meta">👍 ${x.useful} · 👎 ${x.not_useful}</span></td>
        <td><div class="row-actions">${runBtn(x)}<button class="btn sm" type="button" data-details="${esc(x.id)}" aria-expanded="false">Show details</button></div></td>
      </tr>
      <tr class="details-row" data-details-for="${esc(x.id)}" hidden><td colspan="5"><div class="gdet"></div></td></tr>`;
    const table = (rows, empty) =>
      rows.length
        ? `<table><tr><th>Search</th><th class="hide-m">Runs</th><th>Spent</th><th>Results</th><th><span class="sr">Actions</span></th></tr>${rows.map(row).join("")}</table>`
        : `<div class="pad meta">${empty}</div>`;
    const t = g.totals;
    view.innerHTML = `${header("Grok research", "A small, controlled test of Grok's X search. Every search starts from a button here, shows its cost first, and stops before the budget. Grok never verifies anything: results go to your Inbox.")}
      <div class="panel"><h2>Budget <span>Rightroom's estimate · the xAI console limit is the hard stop</span></h2><div class="pad">
        <div class="spend-n">${usd(g.budget.spent)} <span>spent of ${usd(g.budget.cap)} this month · ${usd(g.budget.left)} left</span></div>
        <div class="meter"><i data-width="${pct.toFixed(1)}"></i></div>
        <p class="meta">${g.key_set ? `Key set · model ${esc(g.model)} · ${g.auto ? "<b>also runs on the hourly schedule</b> (GROK_AUTO is on)" : "manual only: nothing runs on its own"}` : "<b>Off:</b> no xAI key yet, so nothing can run and nothing is spent. Add <code>XAI_API_KEY</code> as a secret and <code>GROK_MONTHLY_CAP_USD = 2.5</code> as a variable in the Cloudflare dashboard (Workers → rightroom → Settings)."}</p>
        <p class="meta">Estimates are cautious (they assume Grok reads three times as many posts as it returns). The real cost of each run is shown after it finishes.</p>
      </div></div>

      <div class="panel"><h2>Research a company <span>Its official X account and its partnership posts from the last 30 days</span></h2><div class="pad">
        <form class="toolbar flat" id="grok-co">
          <label class="sr" for="grok-co-pick">Company</label>
          <select id="grok-co-pick" name="company" required><option value="">Choose a verified company…</option>${companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
          <button class="btn sm dark" type="submit" ${canRun ? "" : "disabled"}>Research (up to ${usd(g.company_estimate_usd)})</button>
        </form>
        <p class="help">Posts land in your Inbox to rate and turn into signals. A suggested X handle appears below; it only becomes the company's X link when you accept it.</p>
        <div id="grok-co-result"></div>
      </div>${research.length ? table(research, "") : ""}</div>

      ${resultsPanel}

      <div class="panel"><h2>X handles to confirm <span>From company research, backed by a post from that account</span></h2>
        ${
          suggestions.length
            ? `<table><tr><th>Company</th><th>Suggested</th><th class="hide-m">Evidence</th><th><span class="sr">Actions</span></th></tr>${suggestions
                .map(
                  (h) => `<tr data-hid="${esc(h.id)}"><td><b>${esc(h.name)}</b><br><span class="meta">${esc(h.domain)}${h.current ? ` · now @${esc(h.current)}` : ""}</span></td>
                <td>${link(`https://x.com/${h.handle}`, `@${h.handle}`)}</td><td class="hide-m">${link(h.evidence_url, "the post")}</td>
                <td><div class="row-actions"><button class="btn sm blue" type="button" data-haccept>✓ Use it</button><button class="btn sm" type="button" data-hdismiss>Dismiss</button></div></td></tr>`,
                )
                .join("")}</table>`
            : `<div class="pad meta">None yet. Check that the account really is the company's own before you accept it.</div>`
        }
      </div>

      <div class="panel"><h2>Test searches <span>3 focused searches, last 7 days, up to 8 posts each</span></h2>
        ${testTopics.length ? table(testTopics, "") : `<div class="pad"><p class="meta">Not added yet.</p><button class="btn sm dark" type="button" data-setup>Add the 3 test searches</button></div>`}
      </div>
      ${otherTopics.length ? `<div class="panel"><h2>Other Grok searches <span>From the earlier pilot; also manual only</span></h2>${table(otherTopics, "")}</div>` : ""}

      <div class="panel"><h2>Report <span>Is it worth more credit?</span></h2><div class="pad">
        <div class="stats">
          <div class="stat"><div class="n">${t.runs}</div><div class="l">Searches run</div></div>
          <div class="stat"><div class="n">${usd(t.cost_usd)}</div><div class="l">Spent</div></div>
          <div class="stat"><div class="n">${t.items}</div><div class="l">Results (cited posts)</div></div>
          <div class="stat"><div class="n">${t.useful} / ${t.useful + t.not_useful}</div><div class="l">Rated useful</div></div>
          <div class="stat"><div class="n">${t.promoted}</div><div class="l">Turned into signals</div></div>
          <div class="stat"><div class="n">${usd(t.cost_per_useful_usd, 3)}</div><div class="l">Cost per useful result</div></div>
          <div class="stat"><div class="n">${usd(t.cost_per_signal_usd, 3)}</div><div class="l">Cost per signal</div></div>
        </div>
        <p class="meta">Rate results in the Inbox (👍 / 👎). Signals still need your normal review before founders see them.</p>
      </div></div>`;
    fillMeters(view);
  };
  await render();

  const confirmRun = (est) =>
    window.confirm(`This search could cost up to $${Number(est).toFixed(2)} (usually less). It counts against your Grok budget. Run it?`);
  view.onclick = async (e) => {
    const t = e.target;
    try {
      if (t.closest("[data-setup]")) {
        const { added } = await api("POST", "/grok/test-searches");
        toast(`${added} test searches added. Nothing has run yet.`);
        await render();
      } else if (t.closest("[data-run]")) {
        const b = t.closest("[data-run]");
        if (!confirmRun(b.dataset.est)) return;
        b.disabled = true;
        b.textContent = "Searching… (up to a minute)";
        const { outcome } = await api("POST", `/watched-sources/${encodeURIComponent(b.dataset.run)}/run`);
        toast(outcome.status === "ok" ? `${outcome.items_new} new results in your Inbox.` : outcome.error || "Didn't run.", { bad: outcome.status === "failed" });
        await render();
      } else if (t.closest("[data-grate]")) {
        const b = t.closest("[data-grate]");
        const id = b.closest("[data-rid]").dataset.rid;
        const useful = b.dataset.grate === "1";
        const pressed = b.getAttribute("aria-pressed") === "true";
        await api("POST", `/inbox/${encodeURIComponent(id)}/rate`, { useful: pressed ? null : useful });
        await render();
      } else if (t.closest("[data-details]")) {
        const b = t.closest("[data-details]");
        const row = view.querySelector(`[data-details-for="${CSS.escape(b.dataset.details)}"]`);
        const open = b.getAttribute("aria-expanded") === "true";
        b.setAttribute("aria-expanded", String(!open));
        b.textContent = open ? "Show details" : "Hide details";
        row.hidden = open;
        if (open) return;
        const box = row.querySelector(".gdet");
        box.innerHTML = `<span class="reading">Loading…</span>`;
        const { runs } = await api("GET", `/grok/runs?source_id=${encodeURIComponent(b.dataset.details)}`);
        box.innerHTML = runs.length
          ? runs
              .map(
                (r) => `<div class="grun">
              <div class="ph"><b>${day(r.ran_at)} ${new Date(r.ran_at).toISOString().slice(11, 16)} UTC</b><span class="pill ${r.status === "ok" ? "ok" : "bad"}">${r.status === "ok" ? "Ran" : "Failed"}</span></div>
              <p class="meta">Asked: “${esc(r.query)}” · posts from ${esc(r.from_date)} · up to ${r.max_posts} · model ${esc(r.model)}</p>
              ${r.error ? `<p class="warn-t">${esc(r.error)}</p>` : ""}
              ${r.status === "ok" ? `<p><b>${r.kept} ${r.kept === 1 ? "post" : "posts"} found</b>${r.cost_usd !== null ? ` <span class="meta">· cost ${usd(r.cost_usd, 3)}</span>` : ""}</p>` : ""}
              ${r.kept_posts?.length ? `<ul class="gkept">${r.kept_posts.map((k) => `<li>${link(k.url, k.title)}${k.published_at ? ` <span class="meta">· ${day(k.published_at)}</span>` : ""}</li>`).join("")}</ul>` : ""}
              ${r.status === "ok" ? `<p class="meta">xAI read ${r.posts_read} posts · Grok listed ${r.listed} · kept ${r.kept} · dropped ${r.listed - r.kept}</p>` : ""}
              ${r.dropped.length ? `<details><summary>Why ${r.dropped.length} were dropped</summary><ul>${r.dropped.map((d) => `<li>${esc(d.url)}: ${esc(d.reason)}</li>`).join("")}</ul></details>` : ""}
              ${r.answer_excerpt ? `<details><summary>Grok's answer (start)</summary><pre class="gans">${esc(r.answer_excerpt)}</pre></details>` : ""}
              ${r.status === "ok" && r.listed === 0 ? `<p class="meta">Grok found no matching posts in this period. Try a broader question or more days.</p>` : ""}
            </div>`,
              )
              .join("")
          : `<p class="meta">No details yet. Runs before this update weren't recorded; run it again to see them here.</p>`;
      } else if (t.closest("[data-haccept]") || t.closest("[data-hdismiss]")) {
        const id = t.closest("[data-hid]").dataset.hid;
        const accept = Boolean(t.closest("[data-haccept]"));
        await api("POST", `/grok/handles/${encodeURIComponent(id)}`, { accept });
        toast(accept ? "X handle saved. Founders see it now." : "Dismissed.");
        await render();
      }
    } catch (err) {
      if (err.status !== 401) toast(err.message, { bad: true });
      await render();
    }
  };
  view.onsubmit = async (e) => {
    if (e.target.id !== "grok-co") return;
    e.preventDefault();
    const id = e.target.company.value;
    if (!id) return;
    const g = await api("GET", "/grok");
    if (!confirmRun(g.company_estimate_usd)) return;
    const box = $("#grok-co-result", view);
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    box.innerHTML = `<span class="reading">Searching X… (up to a minute)</span>`;
    try {
      const r = await api("POST", `/grok/research/${encodeURIComponent(id)}`);
      const o = r.outcome;
      box.innerHTML =
        o.status === "ok"
          ? `<div class="notice ok">Done · cost ${usd(r.cost_usd, 3)} · ${o.items_new} new posts in your Inbox · ${r.handle ? (r.handle.already_set ? `X account @${esc(r.handle.handle)} matches what we have` : `suggested X account: @${esc(r.handle.handle)} (confirm below)`) : "no official X account found with evidence"}</div>`
          : `<div class="notice warn">${esc(o.error || "Didn't run.")}</div>`;
      setTimeout(render, 2500);
    } catch (err) {
      box.innerHTML = `<div class="notice warn">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  };
};

views.spend = async (view) => {
  const sp = await api("GET", "/spend");
  view.innerHTML = `${header("Spend", "Paid data sources and their monthly cap")}
    <div class="panel"><h2>Grok signal search (Pilot A) <span>Rightroom's estimate</span></h2><div class="pad">${spendBlock(sp)}</div></div>
    <p class="note">Everything else Rightroom uses is on free tiers. Any new paid service needs your written approval first (PLAN.md §9).</p>`;
  fillMeters(view);
};

// ---------- start ----------
if (getKey()) unlock();
else lock();
