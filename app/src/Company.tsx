import { useEffect, useState } from "react";
import { type CompanyIntel, companyIntel } from "./api.ts";
import { SaveButton } from "./Discover.tsx";
import { DraftPanel } from "./DraftPanel.tsx";

const LABELS = { strong: "Strong fit", potential: "Potential fit", needs_verification: "Needs verification" } as const;
const EVIDENCE = { high: "High", medium: "Medium", low: "Low" } as const;
const CONF = { high: "High", medium: "Medium", low: "Low" } as const;
const GOAL_LABELS: Record<string, string> = {
  integrations: "Integrations",
  distribution: "Distribution",
  co_marketing: "Co-marketing",
  ecosystem: "Ecosystem",
};
const day = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";
const short = (url: string) =>
  url
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/$/, "")
    .slice(0, 60);
const href = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

function Ext({ url, text }: { url: string; text?: string }) {
  return (
    <a href={href(url)} target="_blank" rel="noopener noreferrer">
      {text ?? short(url)} ↗
    </a>
  );
}

export function Company({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [data, setData] = useState<CompanyIntel | null>(null);
  const [error, setError] = useState("");
  const [showReasons, setShowReasons] = useState(false);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    setData(null);
    setError("");
    companyIntel(slug)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load this company."));
    window.scrollTo(0, 0);
  }, [slug]);

  const crumb = (
    <div className="crumb">
      <button type="button" className="linkbtn" onClick={onBack}>
        ← Discover
      </button>
      {data ? ` / ${data.company.name}` : ""}
    </div>
  );
  if (error)
    return (
      <div className="intel">
        {crumb}
        <p className="err" role="alert">
          {error}
        </p>
      </div>
    );
  if (!data)
    return (
      <div className="intel">
        {crumb}
        <div className="loading">Loading…</div>
      </div>
    );

  const { company: c, people, channels, suggestions: s } = data;
  const sectors = c.categories.filter((x) => x.kind === "sector").map((x) => x.label);
  const f = (factor: string) => c.fit.factors.find((x) => x.factor === factor)?.score ?? 0;

  return (
    <div className="intel">
      {crumb}
      <header className="ihead">
        <div>
          <h1>{c.name}</h1>
          <div className="imeta">
            {sectors.join(" · ")}
            {sectors.length ? " · " : ""}
            <Ext url={`https://${c.domain}`} text={c.domain} />
            {c.last_verified_at ? ` · website verified ${day(c.last_verified_at)}` : ""}
          </div>
          {data.goals.length ? (
            <div className="itags">
              {data.goals.map((g) => (
                <span key={g} className="itag">
                  {GOAL_LABELS[g] ?? g}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="iscore">
          <span className={`fit ${c.fit.label}`}>{LABELS[c.fit.label]}</span>
          {c.fit.overall !== null ? (
            <div className="ibig">
              {c.fit.overall}
              <small> / 100</small>
            </div>
          ) : null}
          <div className="ev">Evidence: {EVIDENCE[c.fit.evidence]} · Rightroom's estimate</div>
          <div className="iacts">
            <SaveButton key={c.saved?.stage ?? "none"} slug={c.slug} saved={c.saved} />
          </div>
        </div>
      </header>

      <div className="q4">
        <section className="q">
          <h2>1 · Who they are</h2>
          <div className="lab ver">Verified</div>
          <p>{c.description ?? "No description yet."}</p>
          {c.signals.length === 0 ? <p className="src">No verified signals yet. Their website was verified.</p> : null}
          {c.signals.map((sig) => (
            <div className="fact" key={`${sig.type}-${sig.title}`}>
              <b>
                <span className="ver">✓</span> {sig.type_label}
                {sig.event_date ? ` · ${day(sig.event_date)}` : ""}
              </b>
              {sig.status === "stale" ? <span className="src"> · older signal</span> : null}
              <div>{sig.claim}</div>
              <blockquote>“{sig.excerpt}”</blockquote>
              <span className="src">
                {sig.sources
                  .filter((x) => x.role === "primary")
                  .map((x) => (
                    <Ext key={x.url} url={x.url} />
                  ))}{" "}
                · checked {day(sig.last_verified_at)}
              </span>
            </div>
          ))}
        </section>

        <section className="q">
          <h2>2 · Why partner</h2>
          <div className="lab sug">Our suggestion</div>
          <div className="two">
            <div>
              <b>For you</b>
              {s.for_you}
            </div>
            <div>
              <b>For them</b>
              {s.for_them}
            </div>
          </div>
          <p className="src">
            Built from {s.based_on.charAt(0).toLowerCase() + s.based_on.slice(1)} Check it before you rely on it.
          </p>
          <p className="src">
            Fit: alignment {f("alignment")}/5 · value {f("mutual_value")}/5 · readiness {f("readiness")}/5 · contact{" "}
            {f("contact_access")}/5 · feasibility {f("feasibility")}/5{" "}
            <button
              type="button"
              className="linkbtn"
              aria-expanded={showReasons}
              onClick={() => setShowReasons(!showReasons)}
            >
              {showReasons ? "Hide reasons" : "See reasons"}
            </button>
          </p>
          {showReasons ? (
            <div className="reasons">
              {c.fit.factors.map((x) => (
                <div className="factor" key={x.factor}>
                  <span>{x.label}</span>
                  <span className="dots" role="img" aria-label={`${x.score} out of 5`}>
                    {"●".repeat(x.score)}
                    <i>{"●".repeat(5 - x.score)}</i>
                  </span>
                  <span className="r">{x.reason}</span>
                </div>
              ))}
              <p className="disclaimer">
                A score shows research-based fit. It is not a promise of a reply or a partnership.
              </p>
            </div>
          ) : null}
        </section>

        <section className="q">
          <h2>3 · Who decides</h2>
          <div className="lab sug">Suggested role</div>
          <p>
            <b>{s.suggested_role.charAt(0).toUpperCase() + s.suggested_role.slice(1)}</b>
          </p>
          {people.length ? (
            <>
              <div className="lab ver">Verified {people.length === 1 ? "person" : "people"}</div>
              {people.map((p) => (
                <div className="person" key={`${p.name}-${p.source_url}`}>
                  <b>{p.name}</b> · {p.role}
                  <br />
                  <span className="src">
                    Source: <Ext url={p.source_url} /> · checked {day(p.last_checked_at)} ·{" "}
                    <span className="conf">Confidence: {CONF[p.confidence]}</span>
                  </span>
                </div>
              ))}
            </>
          ) : (
            <p className="empty">No named person verified yet. Use the role above and an official channel.</p>
          )}
          {channels.length ? (
            <>
              <div className="lab ver">Official channels</div>
              {channels.map((ch) => (
                <div className="chan" key={ch.url}>
                  <span>{ch.label}</span>
                  <span className="src">
                    <Ext url={ch.url} />
                  </span>
                </div>
              ))}
            </>
          ) : (
            <p className="src">
              Official channel: their website, <Ext url={`https://${c.domain}`} text={c.domain} />
            </p>
          )}
          <p className="src">No guessed emails, ever. Named people only appear with a public source.</p>
        </section>

        <section className="q">
          <h2>4 · Best approach</h2>
          <div className="lab sug">Our suggestion</div>
          <p>{s.approach}</p>
          <p className="src">Why: {s.approach_why}</p>
          <div className="btnrow">
            <button type="button" className="btn btn-blue" onClick={() => setDrafting(true)}>
              Draft introduction
            </button>
          </div>
        </section>
      </div>
      {drafting ? (
        <DraftPanel
          slug={slug}
          companyName={c.name}
          onClose={() => {
            setDrafting(false);
            companyIntel(slug)
              .then(setData)
              .catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}
