"use client";

import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { MAX_MESSAGE } from "@/lib/chat/use-chat";
import { ArrowUpIcon, CloseIcon, StopIcon } from "./icons";

/**
 * The chat input (DESIGN.md 7.3). Enter sends on a computer and adds a line on a touch screen; Shift+Enter
 * always adds a line. While an answer is being written the button becomes Stop. Voice typing comes later.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  disabled,
  autoFocus,
  replyTo = null,
  onClearReply,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  autoFocus?: boolean;
  /** The question of Nox's being answered, shown above the box until the answer is sent or this is cleared. */
  replyTo?: string | null;
  onClearReply?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to the CSS max height.
  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    const area = ref.current;
    if (!autoFocus || !area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length); // after a topic chip, carry on typing at the end
  }, [autoFocus]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (touch) return;
    event.preventDefault();
    if (!busy) onSend();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) onStop();
    else onSend();
  }

  const length = value.length;
  const tooLong = length > MAX_MESSAGE;
  return (
    <form onSubmit={submit} aria-label={replyTo ? "Answer Nox's question" : "Ask a question"}>
      {replyTo ? (
        <div className="reply-to">
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Answering: </span>
            {replyTo}
          </span>
          <button type="button" className="icon-ghost -my-1 -mr-1" onClick={onClearReply} aria-label="Stop answering this question">
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}
      <div className="composer">
        <label htmlFor="message" className="sr-only">
          Your question
        </label>
        <textarea
          id="message"
          ref={ref}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={replyTo ? "Type your answer…" : "Ask about your health…"}
          disabled={disabled}
          aria-describedby="composer-help"
          enterKeyHint="send"
          autoComplete="off"
        />
        <button
          type="submit"
          className={`send${busy ? " stop" : ""}`}
          disabled={disabled || (!busy && (!value.trim() || tooLong))}
          aria-label={busy ? "Stop" : "Send"}
        >
          {busy ? <StopIcon /> : <ArrowUpIcon />}
        </button>
      </div>
      <p id="composer-help" className="mt-1.5 mb-0 text-center text-[0.75rem] leading-snug text-[var(--ink-faint)]">
        General health information, not medical advice. In an emergency call 112.
        {length > 3500 ? (
          <span className={tooLong ? "ml-2 font-bold text-[var(--alert-text)]" : "ml-2"} role="status">
            {tooLong ? `${length - MAX_MESSAGE} characters too many` : `${MAX_MESSAGE - length} characters left`}
          </span>
        ) : null}
      </p>
    </form>
  );
}
