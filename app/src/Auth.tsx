/**
 * Sign-in (Privy) — loaded only when a founder needs to sign in, so signed-in founders never
 * download Privy's code. After Privy confirms who someone is, the identity token is exchanged for
 * Rightroom's own session cookie and the workspace takes over.
 */
import { PrivyProvider, useIdentityToken, useLoginWithEmail, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, type Identity, type View } from "./api.ts";
import { Screen } from "./ui.tsx";

// Public app ID (also in wrangler.jsonc). Sign-in methods: X, Google, email. No wallets.
const PRIVY_APP_ID = "cmwhggfps01qj0fjs8k8w1zrt";
const LOGOUT_FLAG = "rr_privy_logout";

function needsPrivyLogout() {
  try {
    return localStorage.getItem(LOGOUT_FLAG) === "1";
  } catch {
    return false;
  }
}
function clearPrivyLogout() {
  try {
    localStorage.removeItem(LOGOUT_FLAG);
  } catch {
    /* ignore */
  }
}

type Stage =
  | { kind: "signin" }
  | { kind: "code"; email: string }
  | { kind: "checking" }
  | { kind: "not_invited"; identity: Identity; sent?: boolean };

export default function Auth({ onSignedIn, logoutFirst }: { onSignedIn: (view: View) => void; logoutFirst: boolean }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["twitter", "google", "email"],
        appearance: { theme: "light", accentColor: "#0057FF", showWalletLoginFirst: false },
        embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
      }}
    >
      <AuthFlow onSignedIn={onSignedIn} logoutFirst={logoutFirst} />
    </PrivyProvider>
  );
}

function AuthFlow({ onSignedIn, logoutFirst }: { onSignedIn: (view: View) => void; logoutFirst: boolean }) {
  const { ready, authenticated, logout } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [stage, setStage] = useState<Stage>({ kind: "signin" });
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState(logoutFirst || needsPrivyLogout());
  const exchanging = useRef(false);

  // After "Sign out" or "Delete account": end Privy's session too, before anything else.
  useEffect(() => {
    if (!clearing || !ready) return;
    (authenticated ? logout() : Promise.resolve())
      .catch(() => undefined)
      .finally(() => {
        clearPrivyLogout();
        setClearing(false);
      });
  }, [clearing, ready, authenticated, logout]);

  // Signed in with Privy but no Rightroom session yet: exchange the identity token once.
  useEffect(() => {
    if (clearing || !ready || !authenticated || stage.kind === "not_invited" || exchanging.current) return;
    if (!identityToken) {
      setStage({ kind: "checking" });
      return;
    }
    exchanging.current = true;
    setStage({ kind: "checking" });
    api
      .session(identityToken)
      .then((r) => {
        if (r.status === "active") onSignedIn(r);
        else setStage({ kind: "not_invited", identity: r.identity });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Sign-in failed.");
        setStage({ kind: "signin" });
      })
      .finally(() => {
        exchanging.current = false;
      });
  }, [clearing, ready, authenticated, identityToken, stage.kind, onSignedIn]);

  const signOut = useCallback(async () => {
    await logout().catch(() => undefined);
    setError("");
    setStage({ kind: "signin" });
  }, [logout]);

  const onLoginError = useCallback((e: unknown) => {
    setError(typeof e === "string" && e === "exited_auth_flow" ? "" : "Sign-in didn't finish. Please try again.");
  }, []);

  switch (stage.kind) {
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
        By signing in you agree to our <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.
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
