import { useCallback, useEffect, useRef, useState } from "react";
import { drafts, type GeneratedDraft, type SavedDraft, type Variant } from "./api.ts";

const MAX: Record<Variant, number> = { first: 1200, shorter: 600, follow_up: 800 };
const VARIANT_LABELS: Record<Variant, string> = { first: "First message", shorter: "Shorter", follow_up: "Follow-up" };
const PLACEHOLDER = /\[[^\]]+\]/;
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "";
const href = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : undefined);

export function DraftPanel({
  slug,
  companyName,
  onClose,
  initialVariant = "first",
}: {
  slug: string;
  companyName: string;
  onClose: () => void;
  initialVariant?: Variant;
}) {
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [to, setTo] = useState<number | "team" | undefined>(undefined);
  const [via, setVia] = useState<number | undefined>(undefined);
  const [gen, setGen] = useState<GeneratedDraft | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [list, setList] = useState<SavedDraft[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  const loadList = useCallback(() => {
    drafts
      .list(slug)
      .then((r) => setList(r.drafts))
      .catch(() => undefined);
  }, [slug]);

  useEffect(() => {
    setError("");
    drafts
      .generate(slug, { variant, to, via })
      .then((d) => {
        setGen(d);
        setSubject(d.subject);
        setMessage(d.message);
        setSavedId(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't write a draft."));
  }, [slug, variant, to, via]);

  useEffect(() => {
    loadList();
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadList, onClose]);

  const flash = (text: string) => {
    setStatus(text);
    setTimeout(() => setStatus(""), 3500);
  };
  const hasPlaceholder = PLACEHOLDER.test(message);
  const tooLong = message.length > MAX[variant];

  const persist = async (): Promise<string | null> => {
    if (!gen) return null;
    const body = { subject, message };
    try {
      if (savedId) {
        await drafts.update(savedId, body);
        return savedId;
      }
      const { draft } = await drafts.save(slug, {
        variant,
        recipient: gen.recipient,
        channel_label: gen.channel.label,
        channel_url: gen.channel.url,
        ...body,
      });
      setSavedId(draft.id);
      return draft.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
      return null;
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      flash(
        hasPlaceholder
          ? "Copied. Replace the [ … ] part before sending."
          : "Copied. Paste it into their channel and send it yourself.",
      );
    } catch {
      setError("Couldn't copy. Select the text and copy it manually.");
    }
  };
  const save = async () => {
    if (await persist()) {
      flash("Draft saved to your workspace.");
      loadList();
    }
  };
  const markSent = async () => {
    if (hasPlaceholder && !window.confirm("The message still has a [ … ] part. Mark it as sent anyway?")) return;
    const id = await persist();
    if (!id) return;
    try {
      await drafts.update(id, { status: "sent" });
      flash("Marked as sent by you. It's now in your pipeline as Contacted, with a follow-up in a week.");
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update.");
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this draft?")) return;
    await drafts.remove(id).catch(() => undefined);
    if (id === savedId) setSavedId(null);
    loadList();
  };
  const open = (d: SavedDraft) => {
    setVariant(d.variant);
    setSubject(d.subject ?? "");
    setMessage(d.message);
    setSavedId(d.id);
  };

  return (
    <>
      <button type="button" className="overlay" aria-label="Close draft" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true" aria-label={`Draft introduction for ${companyName}`}>
        <div className="panelh">
          <h2>Draft introduction · {companyName}</h2>
          <button type="button" className="linkbtn x" onClick={onClose} ref={closeRef} aria-label="Close">
            ×
          </button>
        </div>
        <div className="panelb">
          {gen ? (
            <>
              <div className="prow">
                <label htmlFor="d-to">To</label>
                <select
                  id="d-to"
                  value={to === undefined ? (gen.options.people.length ? "0" : "team") : String(to)}
                  onChange={(e) => setTo(e.target.value === "team" ? "team" : Number(e.target.value))}
                >
                  {gen.options.people.map((p) => (
                    <option key={p.index} value={String(p.index)}>
                      ✓ {p.label}
                    </option>
                  ))}
                  <option value="team">The {companyName} team</option>
                </select>
              </div>
              <div className="prow">
                <label htmlFor="d-via">Via</label>
                {gen.options.channels.length ? (
                  <select id="d-via" value={String(via ?? 0)} onChange={(e) => setVia(Number(e.target.value))}>
                    {gen.options.channels.map((ch) => (
                      <option key={ch.index} value={String(ch.index)}>
                        {ch.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="pval">Their website</span>
                )}
              </div>
              <p className="src">
                Send through:{" "}
                <a href={href(gen.channel.url)} target="_blank" rel="noopener noreferrer">
                  {gen.channel.url.replace(/^https?:\/\/(www\.)?/, "")} ↗
                </a>
              </p>
              <div className="vtabs" role="tablist" aria-label="Version">
                {(Object.keys(VARIANT_LABELS) as Variant[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={variant === v}
                    className="vtab"
                    onClick={() => setVariant(v)}
                  >
                    {VARIANT_LABELS[v]}
                  </button>
                ))}
              </div>
              <label htmlFor="d-subject">Subject</label>
              <input id="d-subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
              <label htmlFor="d-msg">Message</label>
              <textarea id="d-msg" className="msg" value={message} onChange={(e) => setMessage(e.target.value)} />
              <div className={tooLong ? "count over" : "count"}>
                {message.length.toLocaleString()} / {MAX[variant].toLocaleString()} characters
              </div>
              {hasPlaceholder ? (
                <p className="warnline">Replace the part in [ brackets ] with your own words before sending.</p>
              ) : null}
              <div className="used">
                <h4>What this draft uses</h4>
                <ul>
                  {gen.sources.map((s) => (
                    <li key={s.text}>
                      {s.kind === "verified" ? <span className="ver">✓ </span> : null}
                      {s.text}
                      {s.url ? (
                        <>
                          {" · "}
                          <a href={href(s.url)} target="_blank" rel="noopener noreferrer">
                            source ↗
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                  <li>◆ Anything in [brackets] is for you to write. We don't guess what you offer them.</li>
                </ul>
              </div>
              {list.length ? (
                <div className="saved">
                  <b>Your drafts for {companyName}</b>
                  {list.map((d) => (
                    <div className="sitem" key={d.id}>
                      <button type="button" className="linkbtn" onClick={() => open(d)}>
                        {d.subject || VARIANT_LABELS[d.variant]} · {VARIANT_LABELS[d.variant]}
                      </button>
                      <span className="sitem-r">
                        <span className={d.status === "sent" ? "spill sent" : "spill"}>
                          {d.status === "sent" ? `You sent it · ${day(d.sent_at)}` : `Draft · ${day(d.created_at)}`}
                        </span>
                        <button
                          type="button"
                          className="linkbtn"
                          onClick={() => remove(d.id)}
                          aria-label="Delete draft"
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : error ? null : (
            <div className="loading">Writing a draft…</div>
          )}
          {error ? (
            <p className="err" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="panelf">
          <button type="button" className="btn btn-blue" onClick={copy} disabled={!gen}>
            Copy message
          </button>
          <button type="button" className="btn btn-ghost" onClick={save} disabled={!gen || tooLong}>
            Save draft
          </button>
          <button type="button" className="btn btn-ghost" onClick={markSent} disabled={!gen || tooLong}>
            I sent it
          </button>
          <p className="pnote" role="status" aria-live="polite">
            {status ||
              "Rightroom never sends anything. Copy it, send it yourself, then mark it sent so you can follow up."}
          </p>
        </div>
      </aside>
    </>
  );
}
