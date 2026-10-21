"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A native <dialog> opened with showModal(): the browser traps focus, makes the page behind inert,
 * handles Esc, and returns focus to the button that opened it (DESIGN.md 7.5).
 * Clicking the dark overlay does NOT close it, unless `closeOnBackdrop` is set (the slide-out sidebar sets it: on a
 * phone, tapping outside a drawer is how everyone closes it). Esc calls `onClose`.
 */
export function Modal({
  open,
  onClose,
  className,
  role = "dialog",
  labelledBy,
  describedBy,
  closeOnBackdrop = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className: string;
  role?: "dialog" | "alertdialog";
  labelledBy: string;
  describedBy?: string;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The first thing to land on is the main action (the Call button, the close button…).
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={className}
      role={role}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dark area lands on the dialog itself; clicks inside land on its children.
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
