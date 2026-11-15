import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

/** True when the visitor asked their system for less motion. Everything here then shows the end state at once. */
export function prefersReducedMotion() {
  return typeof window === "undefined" || !window.matchMedia
    ? true
    : window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts a number up from 0 once, over about 0.7s. Screen readers get the final number only. */
export function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr">{value}</span>
    </>
  );
}

/** The fixed formula's weights (PLAN.md): one bar, each factor's share of it, filled to its 0–5 score. */
export const FACTOR_WEIGHTS: Record<string, number> = {
  alignment: 30,
  mutual_value: 25,
  readiness: 20,
  contact_access: 15,
  feasibility: 10,
};

const SHORT: Record<string, string> = {
  alignment: "Alignment",
  mutual_value: "Value",
  readiness: "Readiness",
  contact_access: "Contact",
  feasibility: "Ease",
};

export function FitMeter({ factors }: { factors: { factor: string; label: string; score: number }[] }) {
  const ordered = Object.keys(FACTOR_WEIGHTS)
    .map((key) => factors.find((f) => f.factor === key))
    .filter((f): f is { factor: string; label: string; score: number } => Boolean(f));
  return (
    <div className="fmeter">
      <div
        className="fbar"
        role="img"
        aria-label={`Fit by factor: ${ordered.map((f) => `${f.label} ${f.score} of 5`).join(", ")}`}
      >
        {ordered.map((f, i) => (
          <span
            key={f.factor}
            className="fseg"
            style={{ flexGrow: FACTOR_WEIGHTS[f.factor] }}
            title={`${f.label}: ${f.score}/5 · weight ${FACTOR_WEIGHTS[f.factor]}%`}
          >
            <i style={{ width: `${(f.score / 5) * 100}%`, animationDelay: `${i * 80}ms` }} />
          </span>
        ))}
      </div>
      <div className="fkeys" aria-hidden="true">
        {ordered.map((f) => (
          <span key={f.factor} style={{ flexGrow: FACTOR_WEIGHTS[f.factor] }}>
            {SHORT[f.factor] ?? f.label} <b>{FACTOR_WEIGHTS[f.factor]}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* Toasts: short confirmations that slide up, with Undo where it makes sense. */

type Toast = { id: number; text: string; undo?: () => Promise<unknown> | unknown; leaving?: boolean };
type ToastFn = (text: string, opts?: { undo?: () => Promise<unknown> | unknown }) => void;

const ToastContext = createContext<ToastFn>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), prefersReducedMotion() ? 0 : 200);
  }, []);

  const show = useCallback<ToastFn>(
    (text, opts) => {
      const id = next.current++;
      setToasts((list) => [...list.slice(-2), { id, text, undo: opts?.undo }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), opts?.undo ? 6000 : 3500),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) clearTimeout(t);
    };
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={t.leaving ? "toast out" : "toast"}>
            <span className="tdot" aria-hidden="true" />
            <span className="ttext">{t.text}</span>
            {t.undo ? (
              <button
                type="button"
                className="tundo"
                onClick={async () => {
                  const undo = t.undo;
                  dismiss(t.id);
                  await undo?.();
                }}
              >
                Undo
              </button>
            ) : null}
            <button type="button" className="tx" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Tells the sidebar the saved count changed, so it can update (and roll) right away. */
export const announceSavedChange = () => window.dispatchEvent(new Event("rr:saved-changed"));
