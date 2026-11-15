import { type ReactNode, useEffect, useRef, useState } from "react";
import type { UpdateItem } from "./api.ts";
import { Logo } from "./ui.tsx";

export type Tab = "home" | "explore" | "discover" | "saved" | "pipeline" | "company" | "account";

const ic = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const ICONS: Record<Tab, ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ic}>
      <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />
    </svg>
  ),
  explore: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ic}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </svg>
  ),
  discover: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ic}>
      <path d="M10 3.5 11.8 8.2 16.5 10 11.8 11.8 10 16.5 8.2 11.8 3.5 10 8.2 8.2z" />
      <circle cx="18" cy="5" r="1.6" />
    </svg>
  ),
  saved: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ic}>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  ),
  pipeline: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ic}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16" />
    </svg>
  ),
  company: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ic}>
      <path d="M4 21V5l7-2v18M11 9h9v12M3 21h18M7 9h1M7 13h1M15 13h1M15 17h1" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ic}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
};

const MAIN: { tab: Tab; label: string; desc: string; core?: boolean }[] = [
  { tab: "home", label: "Home", desc: "Follow-ups, new signals, updates" },
  { tab: "explore", label: "Explore", desc: "Browse the partnership ecosystem", core: true },
  { tab: "discover", label: "Discover", desc: "Personal partnership matches" },
  { tab: "saved", label: "Saved", desc: "Companies you're tracking" },
  { tab: "pipeline", label: "Pipeline", desc: "Conversations and progress" },
];
const FOOT: { tab: Tab; label: string }[] = [
  { tab: "company", label: "Your company" },
  { tab: "account", label: "Account & settings" },
];

const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function usePhone() {
  const q = "(max-width: 820px)";
  const [phone, setPhone] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setPhone(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return phone;
}

/** The workspace frame: sidebar on desktop; a top bar with a menu drawer and the bell on phones. */
export function Shell(props: {
  tab: Tab;
  go: (t: Tab) => void;
  savedCount: number | null;
  updates: { items: UpdateItem[]; count: number } | null;
  onPickUpdate: (u: UpdateItem) => void;
  children: ReactNode;
}) {
  const { tab, go, savedCount, updates, onPickUpdate, children } = props;
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        burger.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    if (!phone) setOpen(false);
  }, [phone]);

  const pick = (t: Tab) => {
    go(t);
    setOpen(false);
  };
  const item = (t: Tab, label: string, extra?: ReactNode, desc?: string, first?: boolean) => (
    <button
      key={t}
      ref={first ? firstItem : undefined}
      type="button"
      className={tab === t ? "nvi on" : "nvi"}
      aria-current={tab === t ? "page" : undefined}
      onClick={() => pick(t)}
    >
      <span className="nvic">{ICONS[t]}</span>
      <span className="nvl">{label}</span>
      {extra}
      {desc ? <span className="nvd">{desc}</span> : null}
    </button>
  );
  const bell = <Bell updates={updates} onPick={onPickUpdate} />;

  return (
    <div className="shell2">
      <header className="mtop2">
        <button
          ref={burger}
          type="button"
          className="burger"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="sidenav"
          onClick={() => setOpen(!open)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" {...ic}>
            <path d="M4 7h16M4 12h16M4 17h10" />
          </svg>
        </button>
        <Logo />
        {phone ? bell : null}
      </header>
      {open ? (
        <button type="button" className="navshade" aria-label="Close menu" onClick={() => setOpen(false)} />
      ) : null}
      <aside id="sidenav" className={open ? "side2 open" : "side2"} inert={phone && !open ? true : undefined}>
        <div className="sideh">
          <Logo />
          {phone ? null : bell}
        </div>
        <nav aria-label="Workspace" className="nvlist">
          {MAIN.map((m, i) =>
            item(
              m.tab,
              m.label,
              m.core ? (
                <span className="core">Core</span>
              ) : m.tab === "saved" && savedCount !== null ? (
                <span className="ncount" key={savedCount}>
                  {savedCount}
                </span>
              ) : null,
              m.desc,
              i === 0,
            ),
          )}
        </nav>
        <nav aria-label="Account" className="nvfoot">
          {FOOT.map((f) => item(f.tab, f.label))}
        </nav>
      </aside>
      <main className="wmain">{children}</main>
    </div>
  );
}

function Bell({
  updates,
  onPick,
}: {
  updates: { items: UpdateItem[]; count: number } | null;
  onPick: (u: UpdateItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const n = updates?.count ?? 0;
  return (
    <div className="bellwrap" ref={wrap}>
      <button
        type="button"
        className="bell"
        aria-expanded={open}
        aria-label={n ? `Updates: ${n} new` : "Updates: nothing new"}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" {...ic}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {n ? <i className="belldot" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <section className="bellpop" aria-label="Updates">
          <h2>Updates</h2>
          {!updates || updates.items.length === 0 ? (
            <p className="bempty">
              Nothing new. Follow-ups you set and new verified signals on companies you've saved show up here.
            </p>
          ) : (
            <ul>
              {updates.items.map((u) => (
                <li key={`${u.kind}-${u.slug}-${u.date}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onPick(u);
                    }}
                  >
                    {u.kind === "follow_up" ? (
                      <>
                        {u.days_late > 0 ? "Follow-up with " : "Follow up with "}
                        <b>{u.name}</b>
                        {u.days_late > 0 ? ` is ${u.days_late} ${u.days_late === 1 ? "day" : "days"} late` : " today"}
                        <span>{u.last_sent_at ? `You sent it on ${day(u.last_sent_at)}` : "Reminder you set"}</span>
                      </>
                    ) : (
                      <>
                        <b>{u.name}</b> (saved) · {u.type_label}
                        <span>Verified signal · {day(u.date)}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
