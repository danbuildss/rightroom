import {
  Bell as BellIcon,
  Bookmark,
  Building2,
  ChevronsUpDown,
  Compass,
  House,
  LogOut,
  type LucideIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareKanban,
} from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import type { UpdateItem } from "./api.ts";
import { Logo } from "./ui.tsx";

export type Tab = "home" | "explore" | "discover" | "saved" | "pipeline" | "company" | "account";

/** One icon style everywhere in the sidebar: 20px, 1.75 stroke. */
const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

const MAIN: { tab: Tab; label: string; desc: string; icon: LucideIcon; core?: boolean }[] = [
  { tab: "home", label: "Home", desc: "Follow-ups, new signals, updates", icon: House },
  { tab: "explore", label: "Explore", desc: "Browse the partnership ecosystem", icon: Compass, core: true },
  { tab: "discover", label: "Discover", desc: "Personal partnership matches", icon: Sparkles },
  { tab: "saved", label: "Saved", desc: "Companies you're tracking", icon: Bookmark },
  { tab: "pipeline", label: "Pipeline", desc: "Conversations and progress", icon: SquareKanban },
];

const COLLAPSE_KEY = "rr_nav_collapsed";
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
};
const writeCollapsed = (v: boolean) => {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {
    // Storage blocked: the choice just isn't remembered.
  }
};

const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const initialsOf = (s: string) =>
  s
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

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

/** Closes a popover on outside click or Escape. */
function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

export interface ShellUser {
  name: string;
  detail: string;
}

/**
 * The frame for every signed-in page: a persistent sidebar (collapsible to an icon rail on desktop,
 * a drawer on phones) with the bell at the top and the profile menu at the bottom.
 */
export function Shell(props: {
  tab: Tab | null;
  go: (t: Tab) => void;
  savedCount: number | null;
  updates: { items: UpdateItem[]; count: number } | null;
  onPickUpdate: (u: UpdateItem) => void;
  user: ShellUser;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { tab, go, savedCount, updates, onPickUpdate, user, onSignOut, children } = props;
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const burger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const rail = collapsed && !phone;

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
  const toggleRail = () => {
    setCollapsed(!collapsed);
    writeCollapsed(!collapsed);
  };
  const bell = <Bell updates={updates} onPick={onPickUpdate} />;

  return (
    <div className={rail ? "shell2 rail" : "shell2"}>
      <header className="mtop2">
        <button
          ref={burger}
          type="button"
          className="iconbtn"
          aria-label="Menu"
          aria-expanded={open}
          aria-controls="sidenav"
          onClick={() => setOpen(!open)}
        >
          <Menu {...ICON} />
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
          {phone ? null : (
            <div className="sideh-tools">
              {bell}
              <button
                type="button"
                className="iconbtn"
                aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
                title={rail ? "Expand sidebar" : "Collapse sidebar"}
                aria-pressed={rail}
                onClick={toggleRail}
              >
                {rail ? <PanelLeftOpen {...ICON} /> : <PanelLeftClose {...ICON} />}
              </button>
            </div>
          )}
        </div>
        <nav aria-label="Workspace" className="nvlist">
          {MAIN.map((m, i) => {
            const Icon = m.icon;
            const count = m.tab === "saved" && savedCount !== null ? savedCount : null;
            return (
              <button
                key={m.tab}
                ref={i === 0 ? firstItem : undefined}
                type="button"
                className={tab === m.tab ? "nvi on" : "nvi"}
                aria-current={tab === m.tab ? "page" : undefined}
                title={rail ? m.label : undefined}
                onClick={() => pick(m.tab)}
              >
                <span className="nvic">
                  <Icon {...ICON} />
                  {rail && count ? <i className="nvbadge">{count}</i> : null}
                </span>
                <span className="nvl">{m.label}</span>
                {m.core ? <span className="core">Core</span> : null}
                {count !== null ? (
                  <span className="ncount" key={count}>
                    {count}
                  </span>
                ) : null}
                <span className="nvd">{m.desc}</span>
              </button>
            );
          })}
        </nav>
        <ProfileMenu user={user} rail={rail} tab={tab} onPick={pick} onSignOut={onSignOut} />
      </aside>
      <main className="wmain">{children}</main>
    </div>
  );
}

function ProfileMenu(props: {
  user: ShellUser;
  rail: boolean;
  tab: Tab | null;
  onPick: (t: Tab) => void;
  onSignOut: () => void;
}) {
  const { user, rail, tab, onPick, onSignOut } = props;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), wrap);
  const choose = (t: Tab) => {
    setOpen(false);
    onPick(t);
  };
  return (
    <div className="profile" ref={wrap}>
      {open ? (
        <div className="pmenu">
          <div className="pmhead">
            <b>{user.name}</b>
            {user.detail ? <span>{user.detail}</span> : null}
          </div>
          <button type="button" aria-current={tab === "company" ? "page" : undefined} onClick={() => choose("company")}>
            <Building2 {...ICON} /> Your company
          </button>
          <button type="button" aria-current={tab === "account" ? "page" : undefined} onClick={() => choose("account")}>
            <Settings {...ICON} /> Account &amp; settings
          </button>
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            <ShieldCheck {...ICON} /> Privacy
          </a>
          <button type="button" className="pmout" onClick={onSignOut}>
            <LogOut {...ICON} /> Sign out
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={tab === "company" || tab === "account" ? "pbtn on" : "pbtn"}
        aria-expanded={open}
        title={rail ? user.name : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="avatar" aria-hidden="true">
          {initialsOf(user.name)}
        </span>
        <span className="pwho">
          <b>{user.name}</b>
          {user.detail ? <span>{user.detail}</span> : null}
          <span className="sr"> · account menu</span>
        </span>
        <ChevronsUpDown {...ICON} size={16} className="pchev" />
      </button>
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
  useDismiss(open, () => setOpen(false), wrap);
  const n = updates?.count ?? 0;
  return (
    <div className="bellwrap" ref={wrap}>
      <button
        type="button"
        className="iconbtn bell"
        aria-expanded={open}
        aria-label={n ? `Updates: ${n} new` : "Updates: nothing new"}
        title="Updates"
        onClick={() => setOpen(!open)}
      >
        <BellIcon {...ICON} />
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
