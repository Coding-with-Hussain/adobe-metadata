"use client";

import { useId, useRef, useState } from "react";
import { dedupeKeywords, keywordKey, normalizeKeyword } from "@/lib/metadata/keywords";
import { ArrowLeftIcon, ArrowRightIcon, CopyIcon, PlusIcon, XIcon } from "./icons";
import { cx, IconButton } from "./ui";

/**
 * Ordered keyword chips. Keywords can be added (Enter or comma; pasting a
 * list works), removed, reordered with buttons or drag-and-drop, and
 * de-duplicated. Order is meaningful: the first keywords are the strongest.
 */
export function KeywordEditor({
  keywords,
  target,
  onChange,
  label,
  invalid,
}: {
  keywords: string[];
  target: number;
  onChange: (keywords: string[]) => void;
  label: string;
  invalid?: boolean;
}) {
  const uid = useId();
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const hasDuplicates = new Set(keywords.map(keywordKey)).size !== keywords.length;

  const add = (raw: string) => {
    const parts = raw.split(/[,\n;]/).map(normalizeKeyword).filter(Boolean);
    if (parts.length === 0) return;
    const existing = new Set(keywords.map(keywordKey));
    const fresh = parts.filter((p) => !existing.has(keywordKey(p)));
    const skipped = parts.length - dedupeKeywords(fresh).length;
    if (fresh.length) onChange([...keywords, ...dedupeKeywords(fresh)]);
    setMessage(skipped > 0 ? `${skipped} duplicate keyword${skipped > 1 ? "s" : ""} skipped.` : fresh.length > 1 ? `${fresh.length} keywords added.` : null);
    setDraft("");
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= keywords.length || from === to) return;
    const next = [...keywords];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
    setMessage(`Moved “${item}” to position ${to + 1}.`);
  };

  const remove = (i: number) => {
    const removed = keywords[i];
    onChange(keywords.filter((_, idx) => idx !== i));
    setMessage(`Removed “${removed}”.`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(keywords.join(", "));
      setMessage("Keywords copied to the clipboard.");
    } catch {
      setMessage("Copy failed — the browser blocked clipboard access.");
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span id={`${uid}-label`} className="text-[12px] font-medium text-muted">
          {label}
        </span>
        <span className="flex items-center gap-1 text-[12px]">
          <span className={cx("tabular-nums", keywords.length > target ? "text-warning" : "text-faint")}>
            {keywords.length}/{target}
          </span>
          {hasDuplicates && (
            <button type="button" onClick={() => onChange(dedupeKeywords(keywords))} className="rounded px-1.5 py-0.5 font-medium text-accent hover:bg-accent-soft">
              Remove duplicates
            </button>
          )}
          <IconButton label="Copy keywords" onClick={copy} disabled={keywords.length === 0} className="h-6 w-6">
            <CopyIcon size={13} />
          </IconButton>
        </span>
      </div>
      <div
        className={cx(
          "rounded-lg border bg-surface p-2",
          invalid ? "border-danger" : "border-line-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
        )}
      >
        <ol aria-labelledby={`${uid}-label`} className="flex flex-wrap gap-1.5">
          {keywords.map((k, i) => (
            <li
              key={`${keywordKey(k)}-${i}`}
              draggable
              onDragStart={(e) => {
                dragIndex.current = i;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(i);
              }}
              onDragLeave={() => setDropTarget((t) => (t === i ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex.current !== null) move(dragIndex.current, i);
                dragIndex.current = null;
                setDropTarget(null);
              }}
              onDragEnd={() => {
                dragIndex.current = null;
                setDropTarget(null);
              }}
              className={cx(
                "group inline-flex cursor-grab items-center gap-0.5 rounded-md border bg-surface-2 py-0.5 pl-2 pr-0.5 text-[13px] text-ink active:cursor-grabbing",
                dropTarget === i ? "border-accent" : "border-line",
              )}
            >
              <span className="mr-1 text-[10px] tabular-nums text-faint" aria-hidden="true">
                {i + 1}
              </span>
              <span className="max-w-[16rem] truncate">{k}</span>
              <span className="ml-0.5 inline-flex opacity-70 group-focus-within:opacity-100 group-hover:opacity-100">
                <IconButton label={`Move “${k}” earlier`} onClick={() => move(i, i - 1)} disabled={i === 0} className="h-6 w-5">
                  <ArrowLeftIcon size={12} />
                </IconButton>
                <IconButton label={`Move “${k}” later`} onClick={() => move(i, i + 1)} disabled={i === keywords.length - 1} className="h-6 w-5">
                  <ArrowRightIcon size={12} />
                </IconButton>
                <IconButton label={`Remove “${k}”`} onClick={() => remove(i)} className="h-6 w-6 hover:text-danger">
                  <XIcon size={12} />
                </IconButton>
              </span>
            </li>
          ))}
        </ol>
        <div className={cx("flex items-center gap-1", keywords.length > 0 && "mt-2")}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && draft === "" && keywords.length > 0) {
                remove(keywords.length - 1);
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (/[,\n;]/.test(text)) {
                e.preventDefault();
                add(text);
              }
            }}
            placeholder="Add keyword…"
            aria-label={`Add keyword to ${label.toLowerCase()}`}
            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[13px] text-ink placeholder:text-faint focus:outline-none"
          />
          <IconButton label="Add keyword" onClick={() => add(draft)} disabled={!draft.trim()} className="h-7 w-7">
            <PlusIcon size={14} />
          </IconButton>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {message ?? ""}
      </p>
      {message && <p className="mt-1 text-[11px] text-faint" aria-hidden="true">{message}</p>}
    </div>
  );
}
