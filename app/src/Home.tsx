import { useEffect, useState } from "react";
import { type HomeResponse, homeApi, pipeline } from "./api.ts";
import { CompanyMark } from "./CompanyBits.tsx";
import { announceSavedChange, useToast } from "./motion.tsx";

const TYPE_LABELS: Record<string, string> = {
  startup_product: "Startups & Products",
  platform_api: "Platforms & APIs",
  ecosystem: "Ecosystems",
  distribution: "Distribution",
  community_media: "Communities & Media",
  accelerator_program: "Accelerators & Programs",
};
const STAGE_NAMES: Record<string, string> = {
  shortlisted: "Shortlisted",
  contacted: "Contacted",
  in_discussion: "In discussion",
  partnered: "Partnered",
};
const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48);
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export function Home(props: {
  firstName: string;
  onOpen: (slug: string) => void;
  go: (t: "explore" | "discover" | "pipeline") => void;
}) {
  const { firstName, onOpen, go } = props;
  const [data, setData] = useState<HomeResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    homeApi
      .home()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load Home."));
  }, []);

  return (
    <div className="home">
      <div className="xeyebrow">Home</div>
      <h1>
        {greeting()}, {firstName}.
      </h1>
      <p className="hint">Here's what changed for your partnerships this week.</p>
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      {!data ? (
        error ? null : (
          <div className="skels" aria-hidden="true">
            {["a", "b"].map((k) => (
              <div className="skel" key={k}>
                <i className="w6" />
                <i className="w8" />
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="hstats">
            <button type="button" className={data.counts.due ? "hstat due" : "hstat"} onClick={() => go("pipeline")}>
              <span className="n">{data.counts.due}</span>
              <span className="l">Follow-ups due</span>
            </button>
            <button type="button" className="hstat" onClick={() => go("pipeline")}>
              <span className="n">{data.counts.saved}</span>
              <span className="l">Companies saved</span>
            </button>
            <div className="hstat">
              <span className="n">{data.counts.signals_this_week}</span>
              <span className="l">New verified signals this week</span>
            </div>
          </div>

          <div className="hgrid">
            <div>
              <section className="hbox" aria-labelledby="h-due">
                <div className="hboxh">
                  <h2 id="h-due">Follow-ups due</h2>
                  <button type="button" className="linkbtn" onClick={() => go("pipeline")}>
                    Open pipeline
                  </button>
                </div>
                {data.due.length === 0 ? (
                  <p className="hempty">Nothing due. Follow-up dates you set in the pipeline show up here.</p>
                ) : (
                  data.due.map((d) => (
                    <div className="hrow" key={d.id}>
                      <span className="ini sm" aria-hidden="true">
                        {initials(d.name)}
                      </span>
                      <div className="hrm">
                        <button type="button" className="linkbtn hname" onClick={() => go("pipeline")}>
                          {d.name}
                        </button>
                        <div className="hsub">
                          {STAGE_NAMES[d.stage] ?? d.stage}
                          {d.last_sent_at
                            ? ` · you sent it ${day(d.last_sent_at)}${d.last_sent_via ? ` via ${d.last_sent_via.toLowerCase()}` : ""}`
                            : ""}
                        </div>
                      </div>
                      <span className="chipd">
                        {d.days_late > 0 ? `${d.days_late} ${d.days_late === 1 ? "day" : "days"} late` : "Today"}
                      </span>
                    </div>
                  ))
                )}
              </section>

              <section className="hbox" aria-labelledby="h-matches">
                <div className="hboxh">
                  <h2 id="h-matches">Top matches for you</h2>
                  <button type="button" className="linkbtn" onClick={() => go("discover")}>
                    See all in Discover
                  </button>
                </div>
                {data.matches.length === 0 ? (
                  <p className="hempty">
                    No strong or potential fits yet. Add more about your company, or browse every verified company in
                    Explore.
                  </p>
                ) : (
                  data.matches.map((m) => (
                    <div className="hrow" key={m.slug}>
                      <CompanyMark name={m.name} logo={m.logo} size="sm" />
                      <div className="hrm">
                        <div className="hname-row">
                          <span className="hn">{m.name}</span>
                          <span className={`fit ${m.fit.label}`}>
                            {m.fit.label === "strong" ? "Strong fit" : "Potential fit"}
                          </span>
                        </div>
                        <div className="hsub">
                          {m.why.replace(/\.$/, "")}
                          {m.latest ? (
                            <span className="v">
                              {" "}
                              · ✓ {m.latest.type_label} · {day(m.latest.date)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button type="button" className="mini dark" onClick={() => onOpen(m.slug)}>
                        View<span className="sr"> {m.name}</span>
                      </button>
                    </div>
                  ))
                )}
              </section>
            </div>

            <div>
              <section className="hbox" aria-labelledby="h-signals">
                <div className="hboxh">
                  <h2 id="h-signals">New verified signals</h2>
                  <span className="hmeta">Last 7 days</span>
                </div>
                {data.signals.length === 0 ? (
                  <p className="hempty">
                    No new verified signals this week. We only list signals we've checked against their source.
                  </p>
                ) : (
                  data.signals.map((s) => (
                    <div className="hsig" key={`${s.slug}-${s.type_label}-${s.date}`}>
                      <div className="t">
                        ✓ {s.type_label} · {day(s.date)}
                      </div>
                      <div className="c">
                        <button type="button" className="linkbtn hname" onClick={() => onOpen(s.slug)}>
                          {s.company}
                        </button>
                        {s.saved ? <span className="savedtag">Saved</span> : null}
                      </div>
                      <p>{s.claim}</p>
                      <div className="s">
                        {s.source ? (
                          <a href={s.source} target="_blank" rel="noopener noreferrer">
                            {host(s.source)} ↗
                          </a>
                        ) : null}{" "}
                        · checked {day(s.last_verified_at)}
                      </div>
                    </div>
                  ))
                )}
              </section>

              <section className="hbox" aria-labelledby="h-added">
                <div className="hboxh">
                  <h2 id="h-added">Recently added to Rightroom</h2>
                  <button type="button" className="linkbtn" onClick={() => go("explore")}>
                    Browse in Explore
                  </button>
                </div>
                {data.added.length === 0 ? (
                  <p className="hempty">No companies yet.</p>
                ) : (
                  data.added.map((a) => (
                    <div className="hrow" key={a.slug}>
                      <CompanyMark name={a.name} logo={a.logo} size="sm" />
                      <div className="hrm">
                        <button type="button" className="linkbtn hname" onClick={() => onOpen(a.slug)}>
                          {a.name}
                        </button>
                        <div className="hsub">
                          {[a.type ? TYPE_LABELS[a.type] : a.sectors.join(", "), `added ${day(a.added_at)}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <QuickSave slug={a.slug} name={a.name} saved={a.saved} />
                    </div>
                  ))
                )}
              </section>
            </div>
          </div>
          <p className="note">
            Everything on Home comes from your own pipeline or from records we've verified against a source. A fit is
            Rightroom's estimate, not a promise of a reply or a partnership.
          </p>
        </>
      )}
    </div>
  );
}

function QuickSave({ slug, name, saved }: { slug: string; name: string; saved: { id: string; stage: string } | null }) {
  const [state, setState] = useState(saved);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      className={state ? "bm on" : "bm"}
      aria-pressed={Boolean(state)}
      aria-label={state ? `${name} is saved` : `Save ${name}`}
      disabled={busy}
      onClick={async () => {
        if (state) return;
        setBusy(true);
        try {
          const r = await pipeline.save(slug);
          setState(r.saved);
          announceSavedChange();
          toast(`${name} saved to ${STAGE_NAMES[r.saved.stage] ?? "your pipeline"}`, {
            undo: async () => {
              await pipeline.remove(r.saved.id);
              setState(null);
              announceSavedChange();
            },
          });
        } catch (err) {
          toast(err instanceof Error ? err.message : "Couldn't save. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill={state ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      >
        <path d="M6 3h12v18l-6-4-6 4z" />
      </svg>
    </button>
  );
}
