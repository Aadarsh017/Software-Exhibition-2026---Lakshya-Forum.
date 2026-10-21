"use client";

import { useEffect, useRef } from "react";
import { citedIn, formatDate, markerNumber } from "@/lib/chat/format";
import type { Answer, Source } from "@/lib/chat/types";
import { BookIcon, ExternalIcon, PillIcon } from "./icons";
import { Modal } from "./modal";

/** "Why this answer?": the exact passages used, where they came from, and a link to read more (DESIGN.md 7.6). */
export function SourcesDrawer({
  open,
  onClose,
  sources,
  fields,
  focusId,
}: {
  open: boolean;
  onClose: () => void;
  sources: Source[];
  fields: Partial<Answer>;
  focusId: string | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !focusId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-source="${focusId}"]`)?.scrollIntoView({ block: "center" });
  }, [open, focusId]);

  const hasMedicine = sources.some((source) => source.kind === "medicine");
  return (
    <Modal open={open} onClose={onClose} className="sheet drawer" labelledBy="sources-title">
      <div className="drawer-body" ref={listRef}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="sources-title" className="text-[1.625rem] leading-tight">
            Why this answer?
          </h2>
          <button type="button" className="btn" data-autofocus onClick={onClose}>
            Close
          </button>
        </div>

        {sources.length === 0 ? (
          <p>
            I couldn&apos;t find a trusted source for this question, so this answer is general guidance only. It is not backed by a specific page.
          </p>
        ) : (
          <p className="m-0 text-[var(--ink-muted)]">
            These are the pages I used, and the exact passage from each. The numbers match the [1], [2] marks in the answer.
          </p>
        )}

        {sources.map((source) => {
          const used = citedIn(fields, source.id);
          return (
            <section key={source.id} className="source-item" data-source={source.id} data-flash={focusId === source.id ? "true" : "false"}>
              <div className="flex items-center gap-2 font-bold">
                {source.kind === "medicine" ? <PillIcon /> : <BookIcon />}
                <span>
                  [{markerNumber(source.id)}] {source.title}
                </span>
              </div>
              <div className="text-[0.875rem] opacity-80">
                {source.publisher}
                {formatDate(source.retrieved_at) ? ` · looked up ${formatDate(source.retrieved_at)}` : ""}
              </div>
              <blockquote className="quote">{source.passage}</blockquote>
              {used.length ? <div className="text-[0.875rem]">Used for: {used.join(", ")}</div> : null}
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold">
                Read the full page <ExternalIcon />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </section>
          );
        })}

        <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]">
          These are US government pages in English. Some details may differ in India.
          {hasMedicine ? " Do not rely on openFDA to make decisions regarding medical care." : ""} We are not affiliated with or endorsed by the NIH or the FDA.
        </p>
      </div>
    </Modal>
  );
}
