import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type CompanyIntel, companyIntel, type PipelineItem, pipeline, type Stage } from "./api.ts";
import { DraftPanel } from "./DraftPanel.tsx";
import { announceSavedChange, useToast } from "./motion.tsx";
import { useFocusTrap } from "./ui.tsx";

const STAGES: Stage[] = ["shortlisted", "contacted", "in_discussion", "partnered"];
const STAGE_LABELS: Record<Stage, string> = {
  shortlisted: "Shortlisted",
  contacted: "Contacted",
  in_discussion: "In discussion",
  partnered: "Partnered",
};
const EMPTY: Record<Stage, string> = {
  shortlisted: "Save companies from Discover to start your shortlist.",
  contacted: "Mark an introduction as sent and it moves here.",
  in_discussion: "Move a company here once a conversation has started.",
  partnered: "Move a company here when you've agreed to work together.",
};

const BITS = ["a", "b", "c", "d", "e", "f", "g", "h"];

const day = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

function followLabel(item: PipelineItem, today: string): { text: string; due: boolean } | null {
  if (!item.follow_up_at || item.stage === "partnered") return null;
  const diff = daysBetween(item.follow_up_at, today);
  if (diff === 0) return { text: "Follow up today", due: true };
  if (diff < 0) return { text: `Follow-up ${-diff} ${diff === -1 ? "day" : "days"} late`, due: true };
  return { text: `Follow up ${day(item.follow_up_at)}`, due: false };
}

function subline(item: PipelineItem) {
  if (item.last_sent_at)
    return `You sent it · ${day(item.last_sent_at)}${item.last_sent_via ? ` · via ${item.last_sent_via.toLowerCase()}` : ""}`;
  return `${item.sectors ? `${item.sectors} · ` : ""}saved ${day(item.created_at)}`;
}

export function Pipeline({
  view,
  onOpenCompany,
  onCount,
}: {
  view: "board" | "list";
  onOpenCompany: (slug: string) => void;
  onCount: (n: number) => void;
}) {
  const [data, setData] = useState<{ items: PipelineItem[]; due: number; today: string } | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(view);
  const [openId, setOpenId] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ id: string; partnered: boolean } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [canDrag] = useState(() => window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false);
  const toast = useToast();

  const load = useCallback(() => {
    pipeline
      .list()
      .then((d) => {
        setData(d);
        onCount(d.items.length);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load your pipeline."));
  }, [onCount]);

  useEffect(() => {
    setMode(view);
  }, [view]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!moved) return;
    const t = setTimeout(() => setMoved(null), 1400);
    return () => clearTimeout(t);
  }, [moved]);

  // Moves show at once, then save. Undo moves the card back.
  const move = async (item: PipelineItem, stage: Stage, quiet = false) => {
    if (item.stage === stage) return;
    const from = item.stage;
    setData((d) => d && { ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, stage } : i)) });
    setMoved({ id: item.id, partnered: stage === "partnered" });
    try {
      await pipeline.update(item.id, { stage });
      if (!quiet) {
        toast(`Moved ${item.name} to ${STAGE_LABELS[stage]}`, { undo: () => move({ ...item, stage }, from, true) });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't move it. Please try again.");
    }
    load();
  };

  if (error)
    return (
      <p className="err" role="alert">
        {error}
      </p>
    );
  if (!data) return <div className="loading">Loading…</div>;

  const dueItems = data.items.filter((i) => followLabel(i, data.today)?.due);
  const open = data.items.find((i) => i.id === openId) ?? null;

  return (
    <div className="pipeline">
      <div className="ptop">
        <div>
          <h1>{mode === "board" ? "Pipeline" : "Saved"}</h1>
          <p className="sub">
            {mode === "board"
              ? "Every company you've saved, by where the conversation is."
              : "Every company you've saved."}
          </p>
        </div>
        <fieldset className="seg">
          <legend className="sr">View</legend>
          <button type="button" aria-pressed={mode === "board"} onClick={() => setMode("board")}>
            Board
          </button>
          <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}>
            List
          </button>
        </fieldset>
      </div>

      {dueItems.length ? (
        <div className="duebar" role="status">
          <b>
            {dueItems.length} follow-up{dueItems.length === 1 ? "" : "s"} due
          </b>
          {dueItems.slice(0, 4).map((i) => (
            <button key={i.id} type="button" className="linkbtn" onClick={() => setOpenId(i.id)}>
              {i.name} (
              {followLabel(i, data.today)
                ?.text.replace(/^Follow(-| )up /, "")
                .replace("today", "today")}
              )
            </button>
          ))}
        </div>
      ) : null}

      {data.items.length === 0 ? (
        <div className="note">Nothing saved yet. Use ☆ Save on Discover or a company page.</div>
      ) : mode === "board" ? (
        <div className="board">
          {STAGES.map((stage) => {
            const items = data.items.filter((i) => i.stage === stage);
            return (
              <section
                className={over === stage ? "col over" : "col"}
                key={stage}
                aria-label={STAGE_LABELS[stage]}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (over !== stage) setOver(stage);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const item = data.items.find((i) => i.id === dragId);
                  setOver(null);
                  setDragId(null);
                  if (item) move(item, stage);
                }}
              >
                <div className="colh">
                  {STAGE_LABELS[stage]} <span>{items.length}</span>
                </div>
                {items.length === 0 ? <div className="colempty">{EMPTY[stage]}</div> : null}
                {items.map((i) => (
                  <Card
                    key={i.id}
                    item={i}
                    today={data.today}
                    onOpen={() => setOpenId(i.id)}
                    onMove={(s) => move(i, s)}
                    motion={moved?.id === i.id ? (moved.partnered ? "partnered" : "moved") : undefined}
                    drag={
                      canDrag
                        ? {
                            dragging: dragId === i.id,
                            start: () => setDragId(i.id),
                            end: () => {
                              setDragId(null);
                              setOver(null);
                            },
                          }
                        : undefined
                    }
                  />
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="plist">
          {data.items.map((i) => (
            <Card
              key={i.id}
              item={i}
              today={data.today}
              onOpen={() => setOpenId(i.id)}
              onMove={(s) => move(i, s)}
              showStage
            />
          ))}
        </div>
      )}

      {open ? (
        <Detail
          item={open}
          today={data.today}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onMoved={(stage) => setMoved({ id: open.id, partnered: stage === "partnered" })}
          onOpenCompany={() => onOpenCompany(open.slug)}
        />
      ) : null}
    </div>
  );
}

function Card({
  item,
  today,
  onOpen,
  onMove,
  showStage,
  motion,
  drag,
}: {
  item: PipelineItem;
  today: string;
  onOpen: () => void;
  onMove: (s: Stage) => void;
  showStage?: boolean;
  motion?: "moved" | "partnered";
  drag?: { dragging: boolean; start: () => void; end: () => void };
}) {
  const follow = followLabel(item, today);
  const cls = [
    "pc",
    drag ? "grab" : "",
    drag?.dragging ? "dragging" : "",
    motion ? "settle" : "",
    motion === "partnered" ? "party" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <article
      className={cls}
      draggable={drag ? true : undefined}
      onDragStart={
        drag
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", item.id);
              drag.start();
            }
          : undefined
      }
      onDragEnd={drag?.end}
    >
      {motion === "partnered" ? (
        <span className="confetti" aria-hidden="true">
          {BITS.map((b) => (
            <i key={b} />
          ))}
        </span>
      ) : null}
      <Peek slug={item.slug}>
        <button type="button" className="pn" onClick={onOpen}>
          {item.name}
        </button>
      </Peek>
      <div className="ps">{subline(item)}</div>
      <div className="pchips">
        {showStage ? <span className="chip stage">{STAGE_LABELS[item.stage]}</span> : null}
        {follow ? <span className={follow.due ? "chip due" : "chip plain"}>{follow.text}</span> : null}
        {item.company_status !== "verified" ? <span className="chip plain">No longer verified</span> : null}
      </div>
      <div className="pmove">
        <span>{item.drafts ? `${item.drafts} draft${item.drafts === 1 ? "" : "s"}` : "No draft yet"}</span>
        <label className="sr" htmlFor={`mv-${item.id}`}>
          Move {item.name}
        </label>
        <select id={`mv-${item.id}`} value={item.stage} onChange={(e) => onMove(e.target.value as Stage)}>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s === item.stage ? "Move ▸" : STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

function Detail({
  item,
  today,
  onClose,
  onChanged,
  onMoved,
  onOpenCompany,
}: {
  item: PipelineItem;
  today: string;
  onClose: () => void;
  onChanged: () => void;
  onMoved: (stage: Stage) => void;
  onOpenCompany: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const toast = useToast();
  const [notes, setNotes] = useState(item.notes ?? "");
  const [events, setEvents] = useState<{ at: string; text: string }[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [msg, setMsg] = useState("");

  const loadTimeline = useCallback(() => {
    pipeline
      .timeline(item.id)
      .then((r) => setEvents(r.events))
      .catch(() => undefined);
  }, [item.id]);
  useEffect(() => {
    setNotes(item.notes ?? "");
    loadTimeline();
  }, [item.notes, loadTimeline]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !drafting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, drafting]);

  const update = async (d: { stage?: Stage; follow_up_at?: string | null; notes?: string }, done?: string) => {
    try {
      await pipeline.update(item.id, d);
      if (d.stage && d.stage !== item.stage) {
        const from = item.stage;
        onMoved(d.stage);
        toast(`Moved ${item.name} to ${STAGE_LABELS[d.stage]}`, {
          undo: async () => {
            await pipeline.update(item.id, { stage: from });
            onChanged();
          },
        });
      }
      if (done) toast(done);
      onChanged();
      loadTimeline();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't save.");
    }
  };
  const follow = followLabel(item, today);

  if (drafting) {
    return (
      <DraftPanel
        slug={item.slug}
        companyName={item.name}
        initialVariant="follow_up"
        onClose={() => {
          setDrafting(false);
          onChanged();
          loadTimeline();
        }}
      />
    );
  }

  return (
    <>
      <button type="button" className="overlay" aria-label="Close" onClick={onClose} />
      <div ref={trapRef} className="panel" role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="panelh">
          <h2>{item.name}</h2>
          <button type="button" className="linkbtn x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="panelb">
          <p className="src">{subline(item)}</p>
          <label htmlFor="p-stage">Stage</label>
          <select
            id="p-stage"
            className="pselect"
            value={item.stage}
            onChange={(e) => update({ stage: e.target.value as Stage })}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <label htmlFor="p-follow">Follow-up</label>
          <div className="prowline">
            <input
              id="p-follow"
              type="date"
              value={item.follow_up_at ?? ""}
              onChange={(e) => update({ follow_up_at: e.target.value || null })}
            />
            {item.follow_up_at ? (
              <button type="button" className="mini" onClick={() => update({ follow_up_at: null })}>
                Clear
              </button>
            ) : null}
          </div>
          {follow ? <p className={follow.due ? "warnline" : "src"}>{follow.text}</p> : null}
          <label htmlFor="p-notes">Notes (private)</label>
          <textarea id="p-notes" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} />
          <button
            type="button"
            className="mini"
            onClick={() => update({ notes }, "Notes saved.")}
            disabled={notes === (item.notes ?? "")}
          >
            Save notes
          </button>
          <h3 className="tlh">Timeline</h3>
          <ul className="tl">
            {events.map((e) => (
              <li key={`${e.at}-${e.text}`}>
                <span>{day(e.at)}</span>
                {e.text}
              </li>
            ))}
          </ul>
          <p className="src">
            Only you see your pipeline. Rightroom never contacts anyone; follow-up dates are reminders inside the app.
          </p>
        </div>
        <div className="panelf">
          <button
            type="button"
            className="btn btn-blue"
            onClick={() => setDrafting(true)}
            disabled={item.company_status !== "verified"}
          >
            Draft follow-up
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onOpenCompany}
            disabled={item.company_status !== "verified"}
          >
            Open company
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              if (!window.confirm(`Remove ${item.name} from your pipeline? Its drafts stay saved.`)) return;
              try {
                await pipeline.remove(item.id);
                toast(`Removed ${item.name} from your pipeline.`);
                announceSavedChange();
              } catch (err) {
                toast(err instanceof Error ? err.message : "Couldn't remove it. Please try again.");
              }
              onClose();
              onChanged();
            }}
          >
            Remove
          </button>
          <p className="pnote" role="status" aria-live="polite">
            {msg}
          </p>
        </div>
      </div>
    </>
  );
}

/* Hover card on a company name (mouse only): sector, fit and latest signal, from the company page's data. */
const peekCache = new Map<string, Promise<CompanyIntel>>();
const PEEK_LABELS = {
  strong: "Strong fit",
  potential: "Potential fit",
  needs_verification: "Needs verification",
} as const;

function Peek({ slug, children }: { slug: string; children: ReactNode }) {
  const [intel, setIntel] = useState<CompanyIntel | null>(null);
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const enter = () => {
    if (!window.matchMedia?.("(hover: hover)").matches) return;
    timer.current = setTimeout(() => {
      let p = peekCache.get(slug);
      if (!p) {
        p = companyIntel(slug);
        p.catch(() => peekCache.delete(slug));
        peekCache.set(slug, p);
      }
      p.then((d) => {
        setIntel(d);
        setShow(true);
      }).catch(() => undefined);
    }, 350);
  };
  const leave = () => {
    clearTimeout(timer.current);
    setShow(false);
  };
  const c = intel?.company;
  const latest = c?.signals[0];
  const sectors = c?.categories.filter((x) => x.kind === "sector").map((x) => x.label) ?? [];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse-only extra; the same facts are on the company page
    <span className="peekwrap" onMouseEnter={enter} onMouseLeave={leave}>
      {children}
      {show && c ? (
        <span className="peek" aria-hidden="true">
          <span className="pk1">{sectors.join(" · ") || c.domain}</span>
          <span className="pk2">
            <span className={`fit ${c.fit.label}`}>{PEEK_LABELS[c.fit.label]}</span>
            {c.fit.overall !== null ? <b>{c.fit.overall}</b> : null}
          </span>
          <span className="pk3">
            {latest
              ? `✓ ${latest.type_label}${latest.event_date ? ` · ${day(latest.event_date)}` : ""}`
              : "No verified signals yet"}
          </span>
        </span>
      ) : null}
    </span>
  );
}
