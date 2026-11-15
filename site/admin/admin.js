// Rightroom back office. Plain JavaScript, no build step.
// It only calls the admin API with Dan's key; every rule (what can be verified, with which page)
// is enforced by the server. The key lives in sessionStorage: this tab only, gone when it closes.
"use strict";

const KEY_NAME = "rr_admin_key";
const SECTIONS = [
  ["overview", "Overview"],
  ["review", "Review"],
  ["inbox", "Inbox"],
  ["requests", "Requests"],
  ["sources", "Sources"],
  ["companies", "Companies"],
  ["founders", "Founders"],
  ["spend", "Spend"],
];

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
  const badge = { review: counts.waiting, inbox: counts.inbox_new, requests: counts.access_requests_new };
  const html = SECTIONS.map(([id, label]) => {
    const n = badge[id];
    return `<a href="#${id}"${id === active ? ' class="on" aria-current="page"' : ""}>${label}${n ? ` <span class="count">${n}</span>` : ""}</a>`;
  }).join("");
  for (const nav of document.querySelectorAll("[data-nav]")) nav.innerHTML = html;
}

function currentSection() {
  const h = location.hash.replace("#", "");
  return SECTIONS.some(([id]) => id === h) ? h : "overview";
}

async function refreshCounts() {
  try {
    counts = await api("GET", "/overview");
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
  const view = old.cloneNode(false);
  old.replaceWith(view);
  view.innerHTML = `<div class="skel w40"></div><div class="skel w80"></div><div class="skel w60"></div>`;
  refreshCounts();
  try {
    await views[section](view);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    view.innerHTML = `<div class="empty"><b>Couldn't load this page</b>${esc(err.message)}</div>`;
  }
  view.focus({ preventScroll: true });
}

const header = (title, sub, right = "") =>
  `<div class="top"><div><h1>${esc(title)}</h1>${sub ? `<p class="subtle">${sub}</p>` : ""}</div>${right}</div>`;

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
      if (t.closest("[data-dismiss]")) {
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
      <div class="toolbar"><span class="meta">Logos come from each company's own website, a few each hour. Founders see initials until one is found.</span><button class="btn sm" type="button" data-logos-missing>Find missing logos now</button></div>
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
    const [{ logo }, { company }] = await Promise.all([
      api("GET", `/companies/${encodeURIComponent(id)}/logo`),
      api("GET", `/companies/${encodeURIComponent(id)}`),
    ]);
    const alias = (k) => company.aliases.find((a) => a.kind === k)?.value ?? "";
    const src = (k) => company.sources.find((x) => x.kind === k)?.url ?? "";
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
      <form class="inline-form flat" data-links>
        <div class="form-grid">
          <div><label>X handle<input name="x" maxlength="60" placeholder="@company" value="${esc(alias("x_handle"))}"></label></div>
          <div><label>GitHub organisation<input name="github" maxlength="100" placeholder="company" value="${esc(alias("github_org"))}"></label></div>
          <div><label>Partner page<input name="partners" type="url" maxlength="500" placeholder="https://${esc(c.primary_domain)}/partners" value="${esc(src("partner_page"))}"></label></div>
          <div><label>Docs<input name="docs" type="url" maxlength="500" placeholder="https://docs.${esc(c.primary_domain)}" value="${esc(src("docs"))}"></label></div>
        </div>
        <p class="help">Partner page and docs must be on ${esc(c.primary_domain)}. Clearing X or GitHub removes it.</p>
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
        if (was) changes.push(() => api("DELETE", `/companies/${encodeURIComponent(id)}/aliases/${aliasKind}`));
        if (v) changes.push(() => api("POST", `/companies/${encodeURIComponent(id)}/links`, { kind, value: v }));
      }
      for (const [field, kind, srcKind] of [["partners", "partners", "partner_page"], ["docs", "docs", "docs"]]) {
        const v = f[field].value.trim();
        if (v && v !== src(srcKind)) changes.push(() => api("POST", `/companies/${encodeURIComponent(id)}/links`, { kind, value: v }));
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
