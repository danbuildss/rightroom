import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type ExploreCard, type ExploreParams, type ExploreResponse, explore, type OrgType, pipeline } from "./api.ts";
import { announceSavedChange, useToast } from "./motion.tsx";

const GOAL_LABELS: Record<string, string> = {
  integrations: "Integrations",
  distribution: "Distribution",
  co_marketing: "Co-marketing",
  ecosystem: "Ecosystem",
};
const STAGE_LABELS: Record<string, string> = { early: "Early stage", growth: "Growth", established: "Established" };
const AUDIENCE_LABELS: Record<string, string> = { b2b: "B2B", b2c: "Consumers", developers: "Developers" };
const STAGE_NAMES: Record<string, string> = {
  shortlisted: "Shortlisted",
  contacted: "Contacted",
  in_discussion: "In discussion",
  partnered: "Partnered",
};
const SORTS = [
  ["signal", "Newest signal"],
  ["fit", "Best fit for you"],
  ["name", "Name (A–Z)"],
  ["newest", "Recently added"],
] as const;

const regions = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
const countryName = (code: string) => regions?.of(code) ?? code;
const day = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";
const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const TYPE_ICONS: Record<OrgType, ReactNode> = {
  startup_product: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M5 19c0-4 2-7 5-9l4 4c-2 3-5 5-9 5z" />
      <path d="M14 6c2-2 4-2.5 6-2-.5 2-1 4-3 6M9 14l-3 3" />
    </svg>
  ),
  platform_api: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <rect x="3" y="12" width="8" height="8" rx="1.5" />
      <rect x="13" y="12" width="8" height="8" rx="1.5" />
      <rect x="8" y="3" width="8" height="8" rx="1.5" />
    </svg>
  ),
  ecosystem: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="18" r="2.5" />
      <circle cx="19" cy="18" r="2.5" />
      <path d="M12 7.5v4M12 11.5 6.5 16M12 11.5l5.5 4.5" />
    </svg>
  ),
  distribution: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M3 11v3l12 5V6L3 11zM15 9h3a3 3 0 0 1 0 6h-3M6 14v4" />
    </svg>
  ),
  community_media: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c3 0 6 2 6 5.5" />
    </svg>
  ),
  accelerator_program: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11v5c3 2 9 2 12 0v-5" />
    </svg>
  ),
};

type Filters = Omit<ExploreParams, "offset" | "q">;

export function Explore({ onOpen }: { onOpen: (slug: string) => void }) {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [f, setF] = useState<Filters>({ sort: "signal" });
  const [view, setView] = useState<"grid" | "list">("grid");
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [more, setMore] = useState<ExploreCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const req = useRef(0);

  const run = useCallback(async (params: ExploreParams, append = false) => {
    const id = ++req.current;
    setLoading(true);
    setError("");
    try {
      const res = await explore(params);
      if (id !== req.current) return;
      if (append) setMore((m) => [...m, ...res.results]);
      else {
        setData(res);
        setMore([]);
      }
    } catch (err) {
      if (id === req.current) setError(err instanceof Error ? err.message : "Couldn't load companies.");
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    run({ q, ...f });
  }, [run, q, f]);

  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));
  const pickType = (type: OrgType) =>
    // A new category starts with fresh filters (except sort), since options differ per category.
    setF((cur) => (cur.type === type ? { sort: cur.sort } : { sort: cur.sort, type }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(input.trim());
  };
  const clearAll = () => {
    setInput("");
    setQ("");
    setF({ sort: f.sort });
  };

  const facets = data?.facets;
  const typeInfo = facets?.types.find((t) => t.type === f.type);
  const shown = data ? [...data.results, ...more] : [];
  const filtered = Boolean(q || f.type || f.sector || f.country || f.goal || f.stage || f.audience);

  return (
    <div className="explore">
      <div className="xeyebrow">Explore</div>
      <h1>Explore the partnership ecosystem.</h1>
      <p className="hint">
        Every verified company, whatever its fit for you. Open one to see what you could build together.
      </p>

      <form className="xsearch" aria-label="Search companies" onSubmit={submit}>
        <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <label htmlFor="xq" className="sr">
          Search companies
        </label>
        <input
          id="xq"
          type="search"
          maxLength={200}
          placeholder="Search companies, sectors or opportunities"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (!e.target.value && q) setQ("");
          }}
        />
        <button type="submit" className="mini dark">
          Search
        </button>
      </form>

      {facets && facets.types.length ? (
        <>
          <h2 className="xh2">Explore by category</h2>
          <div className="tiles">
            {facets.types.map((t) => (
              <button
                key={t.type}
                type="button"
                className="tile"
                aria-pressed={f.type === t.type}
                onClick={() => pickType(t.type)}
              >
                <span className="ticon" aria-hidden="true">
                  {TYPE_ICONS[t.type]}
                </span>
                <b>{t.label}</b>
                <span className="tblurb">{t.blurb}</span>
                <span className="tn">
                  {t.count} {t.count === 1 ? "company" : "companies"}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {typeInfo ? (
        <div className="selp">
          <div>
            <h2>{typeInfo.label}</h2>
            <p>{typeInfo.blurb}</p>
          </div>
          <button type="button" className="mini" onClick={() => set({ type: undefined })}>
            Clear category ×
          </button>
        </div>
      ) : null}

      {facets ? (
        <fieldset className="xfilters">
          <legend className="sr">Filters</legend>
          <Pill id="xf-sector" label="Sector" value={f.sector} onChange={(v) => set({ sector: v })}>
            {facets.sectors.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label} ({s.count})
              </option>
            ))}
          </Pill>
          {facets.countries.length ? (
            <Pill id="xf-country" label="Location" value={f.country} onChange={(v) => set({ country: v })}>
              {facets.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {countryName(c.code)} ({c.count})
                </option>
              ))}
            </Pill>
          ) : null}
          {facets.goals.length ? (
            <Pill
              id="xf-goal"
              label="Partner goal"
              value={f.goal}
              onChange={(v) => set({ goal: v as Filters["goal"] })}
            >
              {facets.goals.map((g) => (
                <option key={g.goal} value={g.goal}>
                  {GOAL_LABELS[g.goal]} ({g.count})
                </option>
              ))}
            </Pill>
          ) : null}
          {facets.stages.length ? (
            <Pill id="xf-stage" label="Stage" value={f.stage} onChange={(v) => set({ stage: v })}>
              {facets.stages.map((s) => (
                <option key={s.stage} value={s.stage}>
                  {STAGE_LABELS[s.stage] ?? s.stage} ({s.count})
                </option>
              ))}
            </Pill>
          ) : null}
          {facets.audiences.length ? (
            <Pill id="xf-aud" label="Sells to" value={f.audience} onChange={(v) => set({ audience: v })}>
              {facets.audiences.map((a) => (
                <option key={a.audience} value={a.audience}>
                  {AUDIENCE_LABELS[a.audience] ?? a.audience} ({a.count})
                </option>
              ))}
            </Pill>
          ) : null}
          {filtered ? (
            <button type="button" className="linkbtn" onClick={clearAll}>
              Clear all
            </button>
          ) : null}
        </fieldset>
      ) : null}

      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="dirh">
            <span aria-live="polite">
              <b>
                {data.total} {data.total === 1 ? "company" : "companies"}
              </b>
              {filtered ? ` of ${data.all_total} verified` : " verified"}
              {loading ? " · updating…" : ""}
            </span>
            <span className="dirctl">
              <label htmlFor="xsort" className="sr">
                Sort
              </label>
              <select
                id="xsort"
                className="xsort"
                value={f.sort}
                onChange={(e) => set({ sort: e.target.value as Filters["sort"] })}
              >
                {SORTS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <fieldset className="views">
                <legend className="sr">Layout</legend>
                <button type="button" aria-pressed={view === "grid"} aria-label="Grid" onClick={() => setView("grid")}>
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="3" y="3" width="8" height="8" rx="2" />
                    <rect x="13" y="3" width="8" height="8" rx="2" />
                    <rect x="3" y="13" width="8" height="8" rx="2" />
                    <rect x="13" y="13" width="8" height="8" rx="2" />
                  </svg>
                </button>
                <button type="button" aria-pressed={view === "list"} aria-label="List" onClick={() => setView("list")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                </button>
              </fieldset>
            </span>
          </div>

          {shown.length === 0 ? (
            <div className="note">
              No verified company matches these filters yet. Try fewer filters or other words.{" "}
              <button type="button" className="linkbtn" onClick={clearAll}>
                Clear all
              </button>
            </div>
          ) : view === "grid" ? (
            <div className={loading ? "xgrid dim" : "xgrid"}>
              {shown.map((c) => (
                <XCard key={c.slug} c={c} onOpen={() => onOpen(c.slug)} />
              ))}
            </div>
          ) : (
            <div className={loading ? "xlist dim" : "xlist"}>
              {shown.map((c) => (
                <XRow key={c.slug} c={c} onOpen={() => onOpen(c.slug)} />
              ))}
            </div>
          )}

          {shown.length < data.total ? (
            <div className="xmore">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={loading}
                onClick={() => run({ q, ...f, offset: shown.length }, true)}
              >
                Show more ({data.total - shown.length} left)
              </button>
            </div>
          ) : null}
          <p className="note">
            Explore lists every verified company. A fit label appears only when a company is a fit for you; partnership
            types come from verified signals, and the angle is our suggestion.
          </p>
        </>
      ) : loading ? (
        <div className="skels" aria-hidden="true">
          {["a", "b", "c", "d"].map((k) => (
            <div className="skel" key={k}>
              <i className="w6" />
              <i className="w8" />
              <i className="w4" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Pill({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  children: ReactNode;
}) {
  return (
    <span className={value ? "fpill set" : "fpill"}>
      <label htmlFor={id} className="sr">
        {label}
      </label>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{label}: any</option>
        {children}
      </select>
    </span>
  );
}

function subline(c: ExploreCard) {
  return [
    c.sectors.map((s) => s.label).join(", "),
    c.profile?.audiences.map((a) => AUDIENCE_LABELS[a] ?? a).join(", "),
    c.profile?.country ? countryName(c.profile.country) : "",
    c.profile?.stage ? STAGE_LABELS[c.profile.stage] : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function FitBadge({ fit }: { fit: ExploreCard["fit"] }) {
  if (!fit) return null;
  return (
    <span className={`fit ${fit.label}`}>
      {fit.label === "strong" ? "Strong fit for you" : "Potential fit"}
      <span className="sr"> ({fit.overall} out of 100)</span>
    </span>
  );
}

export function XCard({ c, onOpen }: { c: ExploreCard; onOpen: () => void }) {
  const sig = c.latest_signal;
  return (
    <article className="xcard">
      <div className="xch">
        <span className="ini" aria-hidden="true">
          {initials(c.name)}
        </span>
        <div className="xmeta">
          <h3 className="xname">{c.name}</h3>
          <div className="xsub">{subline(c) || c.domain}</div>
        </div>
        <FitBadge fit={c.fit} />
      </div>
      {c.description ? <p className="xdesc">{c.description}</p> : null}
      <div className="xtags">
        {sig ? (
          <span className="xtag ver">
            ✓ {sig.type_label}
            {sig.event_date ? ` · ${day(sig.event_date)}` : ""}
            {sig.fresh ? "" : " · older"}
          </span>
        ) : (
          <span className="xtag">No verified signal yet</span>
        )}
        {c.partnership_types.map((g) => (
          <span key={g} className="xtag">
            {GOAL_LABELS[g]}
          </span>
        ))}
      </div>
      <div className="xangle">
        <div className="k">◆ Possible partnership angle · our suggestion</div>
        <p>{c.angle ?? "Not enough verified information to suggest one yet. Their website was verified."}</p>
      </div>
      <div className="xsrc">
        {sig
          ? `Source checked ${day(sig.last_verified_at)} · Evidence: ${c.evidence[0]?.toUpperCase()}${c.evidence.slice(1)}`
          : `Website verified ${day(c.last_verified_at)}`}
      </div>
      <div className="xacts">
        <button type="button" className="btn btn-dark xview" onClick={onOpen}>
          View profile<span className="sr">: {c.name}</span>
        </button>
        <Bookmark c={c} />
      </div>
    </article>
  );
}

function XRow({ c, onOpen }: { c: ExploreCard; onOpen: () => void }) {
  const sig = c.latest_signal;
  return (
    <article className="xrow">
      <span className="ini sm" aria-hidden="true">
        {initials(c.name)}
      </span>
      <div className="xrmain">
        <h3 className="xname">
          <button type="button" className="linkbtn xrname" onClick={onOpen}>
            {c.name}
          </button>
        </h3>
        <div className="xsub">{subline(c) || c.domain}</div>
      </div>
      <div className="xrsig">
        {sig ? `✓ ${sig.type_label}${sig.event_date ? ` · ${day(sig.event_date)}` : ""}` : "No verified signal yet"}
      </div>
      <FitBadge fit={c.fit} />
      <Bookmark c={c} />
    </article>
  );
}

function Bookmark({ c }: { c: ExploreCard }) {
  const [saved, setSaved] = useState(c.saved);
  const [busy, setBusy] = useState(false);
  const [popped, setPopped] = useState(false);
  const toast = useToast();
  const save = async () => {
    if (saved) return;
    setBusy(true);
    try {
      const r = await pipeline.save(c.slug);
      setSaved(r.saved);
      setPopped(true);
      announceSavedChange();
      toast(`${c.name} saved to ${STAGE_NAMES[r.saved.stage] ?? "your pipeline"}`, {
        undo: async () => {
          await pipeline.remove(r.saved.id);
          setSaved(null);
          setPopped(false);
          announceSavedChange();
        },
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`bm${saved ? " on" : ""}${popped ? " pop" : ""}`}
      aria-label={saved ? `${c.name} is saved (${STAGE_NAMES[saved.stage] ?? "in your pipeline"})` : `Save ${c.name}`}
      aria-pressed={Boolean(saved)}
      title={saved ? `Saved · ${STAGE_NAMES[saved.stage] ?? ""}` : "Save"}
      disabled={busy}
      onClick={save}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill={saved ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      >
        <path d="M6 3h12v18l-6-4-6 4z" />
      </svg>
    </button>
  );
}
