import { type FormEvent, lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ApiError, api, pipeline, type View } from "./api.ts";
import { markPrivyLogout } from "./authFlag.ts";
import { Company } from "./Company.tsx";
import { Discover } from "./Discover.tsx";
import { Pipeline } from "./Pipeline.tsx";
import { Logo, Screen } from "./ui.tsx";

// Privy (sign-in) is only downloaded when someone needs to sign in.
const Auth = lazy(() => import("./Auth.tsx"));

const GOALS = [
  ["integrations", "Integrations", "Build into each other's product"],
  ["distribution", "Distribution", "Reach their customers"],
  ["co_marketing", "Co-marketing", "Launches, content, events"],
  ["ecosystem", "Ecosystem", "Programs, grants, marketplaces"],
] as const;
const MARKETS = [
  ["nigeria", "Nigeria"],
  ["uk", "UK"],
  ["us", "US"],
  ["kenya", "Kenya"],
  ["ghana", "Ghana"],
  ["south_africa", "South Africa"],
  ["other", "Other"],
] as const;
const label = (list: readonly (readonly string[])[], ids: string[]) =>
  ids.map((id) => list.find((x) => x[0] === id)?.[1] ?? id).join(", ");

type Stage =
  | { kind: "loading" }
  | { kind: "auth"; logoutFirst?: boolean }
  | {
      kind: "app";
      view: View;
      editing?: number;
      at?: number;
      tab?: "discover" | "company" | "saved" | "pipeline";
      profile?: string;
    };

/** The sign-in screen as it looks, shown instantly while the sign-in code loads. */
function SignInPlaceholder() {
  return (
    <Screen>
      <h1>Sign in to Rightroom</h1>
      <p className="sub">Use the account you gave when you requested access.</p>
      <button type="button" className="btn prov" disabled>
        <span className="ic x" aria-hidden="true">
          𝕏
        </span>
        Continue with X
      </button>
      <button type="button" className="btn prov" disabled>
        <span className="ic g" aria-hidden="true">
          G
        </span>
        Continue with Google
      </button>
      <div className="or">or</div>
      <label htmlFor="email-wait">Email</label>
      <input id="email-wait" type="email" placeholder="you@company.com" disabled />
      <button type="button" className="btn btn-blue" disabled>
        Email me a code
      </button>
      <p className="fine" role="status">
        Getting sign-in ready…
      </p>
    </Screen>
  );
}

export function App() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  // Already have a Rightroom session? Then Privy never loads.
  useEffect(() => {
    api
      .me()
      .then((view) => setStage({ kind: "app", view }))
      .catch(() => setStage((s) => (s.kind === "loading" ? { kind: "auth" } : s)));
  }, []);

  const onSignedIn = useCallback((view: View) => setStage({ kind: "app", view }), []);
  const signedOut = useCallback(() => {
    markPrivyLogout();
    setStage({ kind: "auth", logoutFirst: true });
  }, []);

  if (stage.kind === "loading") {
    return (
      <Screen>
        <div className="loading">Loading…</div>
      </Screen>
    );
  }
  if (stage.kind === "auth") {
    return (
      <Suspense fallback={<SignInPlaceholder />}>
        <Auth onSignedIn={onSignedIn} logoutFirst={Boolean(stage.logoutFirst)} />
      </Suspense>
    );
  }
  return (
    <FounderHome
      stage={stage}
      setStage={setStage}
      signOut={async () => {
        await api.signOut().catch(() => undefined);
        signedOut();
      }}
      onDeleted={signedOut}
    />
  );
}

function FounderHome(props: {
  stage: Extract<Stage, { kind: "app" }>;
  setStage: (s: Stage) => void;
  signOut: () => void;
  onDeleted: () => void;
}) {
  const { stage, setStage, signOut, onDeleted } = props;
  const [savedCount, setSavedCount] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh the count whenever the founder changes page
  useEffect(() => {
    pipeline
      .list()
      .then((d) => setSavedCount(d.items.length))
      .catch(() => undefined);
  }, [stage.tab, stage.profile]);
  const { founder, profile } = stage.view;
  const step = stage.editing ?? stage.at ?? (founder.onboarding_step <= 4 ? founder.onboarding_step : 0);
  const first = founder.name?.split(" ")[0] ?? "there";
  const right = (
    <>
      {founder.name ?? founder.email ?? (founder.x_handle ? `@${founder.x_handle}` : "")} ·
      <button type="button" className="linkbtn" onClick={signOut}>
        Sign out
      </button>
    </>
  );

  if (step >= 1 && step <= 4) {
    return (
      <Screen right={right}>
        <Onboarding
          step={step}
          view={stage.view}
          editing={stage.editing !== undefined}
          onSave={async (update, next) => {
            const view = await api.saveProfile({ ...update, step: stage.editing !== undefined ? undefined : next });
            setStage({ kind: "app", view });
          }}
          onBack={() => setStage({ kind: "app", view: stage.view, at: Math.max(1, step - 1) })}
          onDone={() => setStage({ kind: "app", view: stage.view })}
        />
      </Screen>
    );
  }

  const deleteAccount = async () => {
    if (!window.confirm("Delete your Rightroom account and everything you've entered? This can't be undone.")) return;
    try {
      await api.deleteAccount();
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError) window.alert(err.message);
    }
  };

  const tab = stage.tab ?? "discover";
  const go = (t: "discover" | "company" | "saved" | "pipeline") => setStage({ kind: "app", view: stage.view, tab: t });
  const suggestion = profile.one_liner
    ? `e.g. Companies that could integrate with "${profile.one_liner.slice(0, 60)}" and help us reach more customers`
    : "e.g. Payments companies that could integrate our API and help us reach more businesses";

  return (
    <div className="shell">
      <aside className="side">
        <Logo />
        <nav aria-label="Workspace">
          <button
            type="button"
            className={tab === "discover" ? "navi on" : "navi"}
            aria-current={tab === "discover" ? "page" : undefined}
            onClick={() => go("discover")}
          >
            Discover
          </button>
          <button
            type="button"
            className={tab === "saved" ? "navi on" : "navi"}
            aria-current={tab === "saved" ? "page" : undefined}
            onClick={() => go("saved")}
          >
            Saved {savedCount !== null ? <span className="ncount">{savedCount}</span> : null}
          </button>
          <button
            type="button"
            className={tab === "pipeline" ? "navi on" : "navi"}
            aria-current={tab === "pipeline" ? "page" : undefined}
            onClick={() => go("pipeline")}
          >
            Pipeline
          </button>
          <button
            type="button"
            className={tab === "company" ? "navi on" : "navi"}
            aria-current={tab === "company" ? "page" : undefined}
            onClick={() => go("company")}
          >
            Your company
          </button>
        </nav>
        <div className="sidefoot">
          {founder.name ?? founder.email ?? (founder.x_handle ? `@${founder.x_handle}` : "")}
          <button type="button" className="linkbtn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="wmain">
        <div hidden={tab !== "discover" || Boolean(stage.profile)}>
          <Discover suggestion={suggestion} onOpen={(slug) => setStage({ ...stage, tab: "discover", profile: slug })} />
        </div>
        {tab === "discover" && stage.profile ? (
          <Company slug={stage.profile} onBack={() => setStage({ ...stage, profile: undefined })} />
        ) : null}
        {tab === "saved" || tab === "pipeline" ? (
          <Pipeline
            view={tab === "saved" ? "list" : "board"}
            onCount={setSavedCount}
            onOpenCompany={(slug) => setStage({ ...stage, tab: "discover", profile: slug })}
          />
        ) : null}
        {tab !== "company" ? null : (
          <div className="company">
            <h1>Your company</h1>
            <p className="sub">
              Hi {first}. Your workspace is private to you. Discover uses these answers to rank companies.
            </p>
            <ul className="checklist">
              <li>
                <div>
                  <span className="k">You</span>
                  {founder.name ?? "—"}
                  {founder.role ? ` · ${founder.role}` : ""}
                </div>
                <button type="button" className="linkbtn" onClick={() => setStage({ ...stage, editing: 1 })}>
                  Edit
                </button>
              </li>
              <li>
                <div>
                  <span className="k">Company</span>
                  {[profile.company_name, profile.website?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ") ||
                    "—"}
                  {profile.one_liner ? <span className="d">{profile.one_liner}</span> : null}
                </div>
                <button type="button" className="linkbtn" onClick={() => setStage({ ...stage, editing: 2 })}>
                  Edit
                </button>
              </li>
              <li>
                <div>
                  <span className="k">Partners wanted</span>
                  {label(GOALS, profile.goals) || "—"}
                </div>
                <button type="button" className="linkbtn" onClick={() => setStage({ ...stage, editing: 3 })}>
                  Edit
                </button>
              </li>
              <li>
                <div>
                  <span className="k">Markets</span>
                  {label(MARKETS, profile.markets) || "—"}
                </div>
                <button type="button" className="linkbtn" onClick={() => setStage({ ...stage, editing: 4 })}>
                  Edit
                </button>
              </li>
            </ul>
            <p className="fine">
              <button type="button" className="linkbtn" onClick={deleteAccount}>
                Delete my account and data
              </button>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function Onboarding(props: {
  step: number;
  view: View;
  editing: boolean;
  onSave: (update: Record<string, unknown>, next: number) => Promise<void>;
  onBack: () => void;
  onDone: () => void;
}) {
  const { step, view, editing, onSave, onBack, onDone } = props;
  const { founder, profile } = view;
  const [name, setName] = useState(founder.name ?? "");
  const [role, setRole] = useState(founder.role ?? "");
  const [company, setCompany] = useState(profile.company_name ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [oneLiner, setOneLiner] = useState(profile.one_liner ?? "");
  const [buyers, setBuyers] = useState(profile.buyers ?? "");
  const [goals, setGoals] = useState<string[]>(profile.goals);
  const [markets, setMarkets] = useState<string[]>(profile.markets);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const titles = ["About you", "Your company", "Goals", "Markets"];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const update =
      step === 1
        ? { name, role }
        : step === 2
          ? { company_name: company, website, one_liner: oneLiner, buyers }
          : step === 3
            ? { goals }
            : { markets };
    if (step === 3 && goals.length === 0) return setError("Pick at least one.");
    if (step === 4 && markets.length === 0) return setError("Pick at least one.");
    setBusy(true);
    setError("");
    try {
      await onSave(update, step + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="progress" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= step ? "on" : ""} />
        ))}
      </div>
      <div className="stepl">
        {editing ? "Edit" : `Step ${step} of 4`} · {titles[step - 1]}
      </div>
      {step === 1 ? (
        <>
          <h1>Nice to meet you.</h1>
          <p className="sub">This is how partners and drafts will refer to you.</p>
          <label htmlFor="name">Your name</label>
          <input id="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="role">Your role</label>
          <input
            id="role"
            maxLength={100}
            placeholder="Founder, CEO, Head of Growth…"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </>
      ) : null}
      {step === 2 ? (
        <>
          <h1>What are you building?</h1>
          <label htmlFor="company">Company name</label>
          <input id="company" required maxLength={200} value={company} onChange={(e) => setCompany(e.target.value)} />
          <label htmlFor="website">Company website</label>
          <input
            id="website"
            required
            maxLength={300}
            placeholder="https://"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <label htmlFor="oneliner">In one line</label>
          <input
            id="oneliner"
            required
            maxLength={300}
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
          />
          <label htmlFor="buyers">Who buys it</label>
          <input id="buyers" maxLength={300} value={buyers} onChange={(e) => setBuyers(e.target.value)} />
        </>
      ) : null}
      {step === 3 ? (
        <>
          <h1>What kind of partners do you want?</h1>
          <p className="sub">Pick any. You can change this later.</p>
          <div className="choices">
            {GOALS.map(([id, title, desc]) => (
              <button
                key={id}
                type="button"
                className="choice"
                aria-pressed={goals.includes(id)}
                onClick={() => setGoals(toggle(goals, id))}
              >
                <b>{title}</b>
                {desc}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {step === 4 ? (
        <>
          <h1>Where do you want partners?</h1>
          <p className="sub">Pick any markets that matter now.</p>
          <div className="choices">
            {MARKETS.map(([id, title]) => (
              <button
                key={id}
                type="button"
                className="choice"
                aria-pressed={markets.includes(id)}
                onClick={() => setMarkets(toggle(markets, id))}
              >
                <b>{title}</b>
              </button>
            ))}
          </div>
        </>
      ) : null}
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      <div className="navrow">
        {editing ? (
          <button type="button" className="btn btn-ghost" onClick={onDone}>
            Cancel
          </button>
        ) : step > 1 ? (
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Back
          </button>
        ) : null}
        <button type="submit" className="btn btn-blue" disabled={busy}>
          {editing ? "Save" : step === 4 ? "Finish" : "Continue"}
        </button>
      </div>
    </form>
  );
}
