import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type DiscoverResponse, type DiscoverResult, discover } from "./api.ts";

const GOAL_LABELS: Record<string, string> = {
  integrations: "Integrations",
  distribution: "Distribution",
  co_marketing: "Co-marketing",
  ecosystem: "Ecosystem",
};
const PLACE_LABELS: Record<string, string> = { us: "US", uk: "UK" };
const LABELS = { strong: "Strong fit", potential: "Potential fit", needs_verification: "Needs verification" } as const;
const EVIDENCE = { high: "High", medium: "Medium", low: "Low" } as const;

const day = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

export function Discover({ suggestion, onOpen }: { suggestion: string; onOpen: (slug: string) => void }) {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [cats, setCats] = useState<string[] | undefined>(undefined);
  const [goals, setGoals] = useState<string[] | undefined>(undefined);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const run = useCallback(async (params: { q: string; cats?: string[]; goals?: string[]; category?: string }) => {
    setLoading(true);
    setError("");
    try {
      const res = await discover(params);
      setData(res);
      setOpen(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load matches.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run({ q: "" });
  }, [run]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(q);
    setCats(undefined);
    setGoals(undefined);
    run({ q, category });
  };
  const removeCat = (slug: string) => {
    const next = (cats ?? data?.understood.categories.map((c) => c.slug) ?? []).filter((s) => s !== slug);
    setCats(next);
    run({ q: submitted, cats: next, goals, category });
  };
  const removeGoal = (goal: string) => {
    const next = (goals ?? data?.understood.goals ?? []).filter((g) => g !== goal);
    setGoals(next);
    run({ q: submitted, cats, goals: next, category });
  };
  const pickCategory = (slug: string | undefined) => {
    setCategory(slug);
    run({ q: submitted, cats, goals, category: slug });
  };

  const sectors = data?.categories.filter((c) => c.kind === "sector") ?? [];
  const u = data?.understood;

  return (
    <div className="discover">
      <h1>Find your next partner.</h1>
      <p className="hint">Describe the partner you want. Results are verified companies only, ranked for you.</p>
      <form className="dsearch" onSubmit={submit} aria-label="Search for partners">
        <label htmlFor="dq" className="sr">
          Describe the partner you want
        </label>
        <textarea
          id="dq"
          rows={2}
          maxLength={500}
          placeholder={suggestion}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" className="go" aria-label="Search" disabled={loading}>
          ↵
        </button>
      </form>

      {u && (u.categories.length || u.goals.length || u.places.length) ? (
        <div className="understood">
          <span>{submitted ? "Understood as" : "Based on your profile"}</span>
          {u.categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              className="tok"
              onClick={() => removeCat(c.slug)}
              aria-label={`Remove ${c.label}`}
            >
              {c.label} <span aria-hidden="true">×</span>
            </button>
          ))}
          {u.goals.map((g) => (
            <button
              key={g}
              type="button"
              className="tok goal"
              onClick={() => removeGoal(g)}
              aria-label={`Remove ${GOAL_LABELS[g] ?? g}`}
            >
              {GOAL_LABELS[g] ?? g} <span aria-hidden="true">×</span>
            </button>
          ))}
          {u.places.map((p) => (
            <span key={p} className="tok off">
              {PLACE_LABELS[p] ?? title(p)} · location filter coming soon
            </span>
          ))}
        </div>
      ) : null}

      <fieldset className="dchips">
        <legend className="sr">Filter by sector</legend>
        <button type="button" className="dchip" aria-pressed={!category} onClick={() => pickCategory(undefined)}>
          All sectors
        </button>
        {sectors.map((s) => (
          <button
            key={s.slug}
            type="button"
            className="dchip"
            aria-pressed={category === s.slug}
            onClick={() => pickCategory(s.slug)}
          >
            {s.label}
          </button>
        ))}
      </fieldset>

      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      {loading && !data ? <div className="loading">Finding matches…</div> : null}

      {data ? (
        <>
          <div className="listhead" aria-live="polite">
            <span>
              <b>
                {data.results.length} {data.results.length === 1 ? "match" : "matches"}
              </b>{" "}
              from {data.verified_total} verified {data.verified_total === 1 ? "company" : "companies"}
            </span>
            <span>Sorted by fit</span>
          </div>
          <div className={loading ? "results dim" : "results"}>
            {data.results.map((r) => (
              <ResultCard
                key={r.slug}
                r={r}
                open={open === r.slug}
                onToggle={() => setOpen(open === r.slug ? null : r.slug)}
                onOpen={() => onOpen(r.slug)}
              />
            ))}
          </div>
          {data.results.length === 0 ? (
            <div className="note">
              No verified company matches this yet. Try fewer words or another sector. The list grows as more companies
              are checked.
            </div>
          ) : (
            <div className="note">
              Only verified companies appear, so the list grows as more are checked. Below 55, companies aren't shown as
              matches. Saving and the pipeline arrive in a later step.
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function ResultCard({
  r,
  open,
  onToggle,
  onOpen,
}: {
  r: DiscoverResult;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const latest = r.signals[0];
  const sectors = r.categories.filter((c) => c.kind === "sector").map((c) => c.label);
  return (
    <article className="dcard">
      <div className="dch">
        <div className="dname">
          {r.name}
          {sectors.length ? <span className="dsector">{sectors.join(" · ")}</span> : null}
        </div>
        <div className="dbadges">
          <span className={`fit ${r.fit.label}`}>{LABELS[r.fit.label]}</span>
          {r.fit.overall !== null ? (
            <span className="dscore">
              {r.fit.overall}
              <small> / 100</small>
            </span>
          ) : null}
          <span className="ev">Evidence: {EVIDENCE[r.fit.evidence]}</span>
        </div>
        <div className="dwhy">{r.fit.why}</div>
        <div className="dmeta">
          {latest ? (
            <>
              <span className="okk">
                ✓ {latest.type_label}
                {latest.event_date ? ` · ${day(latest.event_date)}` : ""}
              </span>{" "}
              · source checked {day(latest.last_verified_at)}
              {latest.status === "stale" ? " · older signal" : ""}
            </>
          ) : (
            "Company verified · no verified signals yet"
          )}
        </div>
        <div className="dacts">
          <button type="button" className="mini dark" onClick={onOpen}>
            View profile →
          </button>
          <button type="button" className="mini" aria-expanded={open} onClick={onToggle}>
            {open ? "Hide details ▴" : "Show details ▾"}
          </button>
          <a className="mini" href={`https://${r.domain}`} target="_blank" rel="noopener noreferrer">
            {r.domain} ↗
          </a>
        </div>
      </div>
      {open ? (
        <div className="ddetail">
          <div>
            <h4>Why it fits · Rightroom's estimate</h4>
            {r.fit.factors.map((f) => (
              <div className="factor" key={f.factor}>
                <span>{f.label}</span>
                <span className="dots" role="img" aria-label={`${f.score} out of 5`}>
                  {"●".repeat(f.score)}
                  <i>{"●".repeat(5 - f.score)}</i>
                </span>
                <span className="r">{f.reason}</span>
              </div>
            ))}
            <p className="disclaimer">
              A score shows research-based fit. It is not a promise of a reply or a partnership.
            </p>
          </div>
          <div>
            <h4>Verified signals</h4>
            {r.signals.length === 0 ? <p className="dmeta">None yet. This company's website was verified.</p> : null}
            {r.signals.map((s) => (
              <div className="sig" key={`${s.type}-${s.title}`}>
                <div className="t">
                  <span className="ver">✓</span> {s.type_label}
                  {s.event_date ? ` · ${day(s.event_date)}` : ""}
                </div>
                <div>{s.claim}</div>
                <blockquote>“{s.excerpt}”</blockquote>
                {s.sources
                  .filter((src) => src.role === "primary")
                  .map((src) => (
                    <a key={src.url} href={safeHref(src.url)} target="_blank" rel="noopener noreferrer">
                      {src.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)} ↗
                    </a>
                  ))}{" "}
                <span className="dmeta">· checked {day(s.last_verified_at)}</span>
              </div>
            ))}
            {r.description ? <p className="dmeta">About: {r.description}</p> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
