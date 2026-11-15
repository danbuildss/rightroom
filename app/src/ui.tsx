import type { ReactNode } from "react";

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
