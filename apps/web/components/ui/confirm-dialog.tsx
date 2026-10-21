"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Modal } from "@/components/chat/modal";

/**
 * Asks before anything is deleted, and says exactly what will happen (DESIGN.md 8.6). For the most serious actions the
 * person types a word (for example DELETE) before the button works.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  requireText,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  requireText?: string;
  onConfirm: () => Promise<string | null>;
  onCancel: () => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const ready = !requireText || typed.trim() === requireText;
  async function confirm() {
    setBusy(true);
    setError(null);
    const failure = await onConfirm();
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <Modal open={open} onClose={() => !busy && onCancel()} role="alertdialog" labelledBy={`${id}-title`} describedBy={`${id}-body`} className="confirm">
      <div className="grid gap-4 p-5 sm:p-6">
        <h2 id={`${id}-title`} className="text-[1.5rem] leading-tight">
          {title}
        </h2>
        <div id={`${id}-body`} className="grid gap-2">
          {children}
        </div>
        {requireText ? (
          <div>
            <label className="field-label" htmlFor={`${id}-typed`}>
              Type {requireText} to confirm
            </label>
            <input id={`${id}-typed`} className="field" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="characters" />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="error-card m-0">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className="btn" onClick={onCancel} disabled={busy} data-autofocus>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy || !ready}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
