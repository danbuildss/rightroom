import { useCallback, useEffect, useState } from "react";
import { type PipelineItem, pipeline, type Stage } from "./api.ts";
import { DraftPanel } from "./DraftPanel.tsx";
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

  const move = async (item: PipelineItem, stage: Stage) => {
    await pipeline.update(item.id, { stage }).catch(() => undefined);
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
              <section className="col" key={stage} aria-label={STAGE_LABELS[stage]}>
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
}: {
  item: PipelineItem;
  today: string;
  onOpen: () => void;
  onMove: (s: Stage) => void;
  showStage?: boolean;
}) {
  const follow = followLabel(item, today);
  return (
    <article className="pc">
      <button type="button" className="pn" onClick={onOpen}>
        {item.name}
      </button>
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
  onOpenCompany,
}: {
  item: PipelineItem;
  today: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenCompany: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>();
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
      if (done) {
        setMsg(done);
        setTimeout(() => setMsg(""), 2500);
      }
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
              await pipeline.remove(item.id).catch(() => undefined);
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
