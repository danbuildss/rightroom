import { type ReactNode, useEffect, useRef } from "react";

export function Logo() {
  return (
    <a className="logo" href="/" aria-label="rightroom home">
      <svg viewBox="-4 -4 128 144" aria-hidden="true">
        <path fill="#0057FF" d="M 0 32 L 120 0 L 120 136 L 43 116 L 84 105 L 84 40 L 34 54 L 34 115 L 0 134 Z" />
      </svg>
      rightroom
    </a>
  );
}

export function Screen({ right, children }: { right?: ReactNode; children: ReactNode }) {
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

/**
 * Keeps keyboard focus inside an open panel (Tab and Shift+Tab wrap around), moves focus into it
 * when it opens, and returns focus to whatever opened it when it closes.
 */
export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      node
        ? [
            ...node.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ].filter((el) => el.offsetParent !== null || el === document.activeElement)
        : [];
    if (node && !node.contains(document.activeElement)) focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !node) return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!node.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);
  return ref;
}
