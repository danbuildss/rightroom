import { useIdentityToken, useLoginWithEmail, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type Identity, pipeline, type View } from "./api.ts";
import { Company } from "./Company.tsx";
import { Discover } from "./Discover.tsx";
import { Pipeline } from "./Pipeline.tsx";

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
  | { kind: "signin" }
  | { kind: "code"; email: string }
  | { kind: "checking" }
  | { kind: "not_invited"; identity: Identity; sent?: boolean }
  | {
      kind: "app";
      view: View;
      editing?: number;
      at?: number;
      tab?: "discover" | "company" | "saved" | "pipeline";
      profile?: string;
    };

function Logo() {
  return (
    <a className="logo" href="/" aria-label="rightroom home">
      <svg viewBox="0 0 100 120" aria-hidden="true">
        <path fill="#0057FF" fillRule="evenodd" d="M0 22 L100 0 L100 120 L0 104 Z M28 44 L70 36 L70 101 L28 96 Z" />
        <path fill="#0057FF" d="M28 96 L48 98.4 L48 104 L28 106 Z" />
      </svg>
      rightroom
    </a>
  );
}

function Screen({ right, children }: { right?: ReactNode; children: ReactNode }) {
  return (
    <div className="wrap">
      <main className="screen">
        <div className="bar">
          <Logo />
          <small>{right ?? "Invite-only pilot"}</small>
        </div>
        <div className="body">{children}</div>
      </main>
    </div>
  );
}

export function App() {
  const { ready, authenticated, logout } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [error, setError] = useState("");
  const exchanging = useRef(false);

  // 1. Already have a Rightroom session?
  useEffect(() => {
    api
      .me()
      .then((view) => setStage({ kind: "app", view }))
      .catch(() => setStage((s) => (s.kind === "loading" ? { kind: "signin" } : s)));
  }, []);

  // 2. Signed in with Privy but no Rightroom session yet: exchange the identity token once.
  useEffect(() => {
    if (!ready || !authenticated || stage.kind === "app" || stage.kind === "not_invited" || exchanging.current) return;
    if (stage.kind === "loading") return;
    if (!identityToken) {
      setStage({ kind: "checking" });
      return;
    }
    exchanging.current = true;
    setStage({ kind: "checking" });
    api
      .session(identityToken)
      .then((r) =>
        setStage(r.status === "active" ? { kind: "app", view: r } : { kind: "not_invited", identity: r.identity }),
      )
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Sign-in failed.");
        setStage({ kind: "signin" });
      })
      .finally(() => {
        exchanging.current = false;
      });
  }, [ready, authenticated, identityToken, stage.kind]);

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => undefined);
    await logout().catch(() => undefined);
    setError("");
    setStage({ kind: "signin" });
  }, [logout]);

  const onLoginError = useCallback((e: unknown) => {
    setError(typeof e === "string" && e === "exited_auth_flow" ? "" : "Sign-in didn't finish. Please try again.");
  }, []);

  switch (stage.kind) {
    case "loading":
      return (
        <Screen>
          <div className="loading">Loading…</div>
        </Screen>
      );
    case "checking":
      return (
        <Screen>
          <div className="loading">Checking your invite…</div>
          {ready && authenticated && !identityToken ? (
            <p className="err">
              Sign-in worked, but Rightroom couldn't confirm who you are yet. Refresh the page; if it keeps happening,
              tell us.
            </p>
          ) : null}
        </Screen>
      );
    case "signin":
    case "code":
      return <SignIn stage={stage} setStage={setStage} error={error} setError={setError} onLoginError={onLoginError} />;
    case "not_invited":
      return <NotInvited stage={stage} setStage={setStage} identityToken={identityToken} signOut={signOut} />;
    case "app":
      return <FounderHome stage={stage} setStage={setStage} signOut={signOut} logout={logout} />;
  }
}

function SignIn(props: {
  stage: Extract<Stage, { kind: "signin" | "code" }>;
  setStage: (s: Stage) => void;
  error: string;
  setError: (e: string) => void;
  onLoginError: (e: unknown) => void;
}) {
  const { stage, setStage, error, setError, onLoginError } = props;
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth({ onError: onLoginError });
  const { sendCode, loginWithCode } = useLoginWithEmail({ onError: onLoginError });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const oauth = async (provider: "twitter" | "google") => {
    setError("");
    try {
      await initOAuth({ provider });
    } catch {
      setError("Couldn't start sign-in. Please try again.");
    }
  };
  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await sendCode({ email });
      setStage({ kind: "code", email });
    } catch {
      setError("Couldn't send the code. Check the email address and try again.");
    } finally {
      setBusy(false);
    }
  };
  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await loginWithCode({ code: code.trim() });
      setStage({ kind: "checking" });
    } catch {
      setError("That code didn't work. Check it, or send a new one.");
    } finally {
      setBusy(false);
    }
  };

  if (stage.kind === "code") {
    return (
      <Screen>
        <h1>Check your email</h1>
        <p className="sub">We sent a 6-digit code to {stage.email}.</p>
        <form onSubmit={submitCode}>
          <label htmlFor="code">Code</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <button className="btn btn-blue" type="submit" disabled={busy || code.length < 6}>
            Continue
          </button>
        </form>
        {error ? (
          <p className="err" role="alert">
            {error}
          </p>
        ) : null}
        <p className="fine">
          Didn't get it?{" "}
          <button
            type="button"
            className="linkbtn"
            onClick={() => sendCode({ email: stage.email }).catch(() => undefined)}
          >
            Send again
          </button>{" "}
          ·{" "}
          <button type="button" className="linkbtn" onClick={() => setStage({ kind: "signin" })}>
            Use another way
          </button>
        </p>
      </Screen>
    );
  }

  return (
    <Screen>
      <h1>Sign in to Rightroom</h1>
      <p className="sub">Use the account you gave when you requested access.</p>
      <button type="button" className="btn prov" onClick={() => oauth("twitter")} disabled={oauthLoading}>
        <span className="ic x" aria-hidden="true">
          𝕏
        </span>
        Continue with X
      </button>
      <button type="button" className="btn prov" onClick={() => oauth("google")} disabled={oauthLoading}>
        <span className="ic g" aria-hidden="true">
          G
        </span>
        Continue with Google
      </button>
      <div className="or">or</div>
      <form onSubmit={submitEmail}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn btn-blue" type="submit" disabled={busy}>
          Email me a code
        </button>
      </form>
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      <p className="fine">
        We only receive your name and email or X handle. We never post for you or read your messages.
        <br />
        Not invited yet? <a href="/#access">Request access</a>
      </p>
    </Screen>
  );
}

function NotInvited(props: {
  stage: Extract<Stage, { kind: "not_invited" }>;
  setStage: (s: Stage) => void;
  identityToken: string | null;
  signOut: () => void;
}) {
  const { stage, setStage, identityToken, signOut } = props;
  const [goal, setGoal] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const who = stage.identity;
  const display = who.name ?? who.email ?? (who.x_handle ? `@${who.x_handle}` : "You");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!identityToken) return setError("Please sign in again.");
    setBusy(true);
    setError("");
    try {
      await api.requestAccess(identityToken, goal, website);
      setStage({ ...stage, sent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      right={
        <button type="button" className="linkbtn" onClick={signOut}>
          Sign out
        </button>
      }
    >
      <div className="who">
        <span className="avatar" aria-hidden="true">
          {display.replace("@", "").charAt(0).toUpperCase()}
        </span>
        <div>
          <b>{display}</b>
          <small>{who.x_handle ? `@${who.x_handle} on X` : who.email}</small>
        </div>
      </div>
      {stage.sent ? (
        <>
          <h1>Thanks, we've got your request.</h1>
          <p className="sub">You'll hear from us once there's a place for you in the pilot.</p>
        </>
      ) : (
        <>
          <h1>You're not on the pilot list yet</h1>
          <p className="sub">Rightroom is invite-only for now. Tell us what you're building and we'll be in touch.</p>
          <form onSubmit={submit}>
            <label htmlFor="goal">What partnership are you looking for?</label>
            <textarea
              id="goal"
              required
              minLength={10}
              maxLength={1000}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
            <label htmlFor="site">Company website (optional)</label>
            <input
              id="site"
              maxLength={300}
              placeholder="https://"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <button className="btn btn-blue" type="submit" disabled={busy}>
              Request access
            </button>
          </form>
          {error ? (
            <p className="err" role="alert">
              {error}
            </p>
          ) : null}
          <p className="fine">
            Your {who.x_handle ? "X handle" : "email"} is attached to the request, so there's nothing else to fill in.
          </p>
        </>
      )}
    </Screen>
  );
}

function FounderHome(props: {
  stage: Extract<Stage, { kind: "app" }>;
  setStage: (s: Stage) => void;
  signOut: () => void;
  logout: () => Promise<void>;
}) {
  const { stage, setStage, signOut, logout } = props;
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
      await logout().catch(() => undefined);
      setStage({ kind: "signin" });
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
