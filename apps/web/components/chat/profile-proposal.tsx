"use client";

import { useState } from "react";
import type { ProfileUpdate } from "@/lib/chat/types";
import { CheckIcon, CloseIcon, PlusIcon } from "./icons";

const LIST_LABEL: Record<ProfileUpdate["list"], string> = { medicines: "Regular medicines", conditions: "Long-term conditions", allergies: "Allergies" };

/**
 * "Add to your profile?" (DESIGN.md 8.6f): Nox noticed something the person said about themselves that their profile
 * doesn't have. Like a doctor updating your record, but nothing is saved unless the person taps Add, one item at a time.
 */
export function ProfileProposal({ updates, onSave }: { updates: ProfileUpdate[]; onSave: (update: ProfileUpdate) => Promise<string | null> }) {
  const [state, setState] = useState<Record<string, "saving" | "saved" | "dismissed" | string>>({});
  const key = (update: ProfileUpdate) => `${update.list}:${update.item.toLowerCase()}`;
  const open = updates.filter((update) => state[key(update)] !== "dismissed");
  if (!open.length) return null;
  return (
    <section className="profile-proposal" aria-label="Add to your profile">
      <p className="m-0 font-bold">Add to your profile?</p>
      <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]">So I remember next time. Only you can see it.</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {open.map((update) => {
          const status = state[key(update)];
          const saved = status === "saved";
          const failed = status && status !== "saving" && status !== "saved" ? status : null;
          return (
            <li key={key(update)} className="proposal-row">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{update.item}</span>
                <span className="block text-[0.8125rem] text-[var(--ink-muted)]">{LIST_LABEL[update.list]}</span>
                {failed ? (
                  <span className="block text-[0.8125rem] text-[var(--alert-text)]" role="alert">
                    {failed}
                  </span>
                ) : null}
              </span>
              {saved ? (
                <span className="flex items-center gap-1 text-[0.875rem] font-semibold" role="status">
                  <CheckIcon size={16} /> Added
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-compact"
                    disabled={status === "saving"}
                    onClick={async () => {
                      setState((current) => ({ ...current, [key(update)]: "saving" }));
                      const failure = await onSave(update);
                      setState((current) => ({ ...current, [key(update)]: failure ?? "saved" }));
                    }}
                    aria-label={`Add ${update.item} to ${LIST_LABEL[update.list].toLowerCase()}`}
                  >
                    <PlusIcon size={16} /> {status === "saving" ? "Adding…" : "Add"}
                  </button>
                  <button type="button" className="icon-ghost" onClick={() => setState((current) => ({ ...current, [key(update)]: "dismissed" }))} aria-label={`Don't add ${update.item}`}>
                    <CloseIcon size={16} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
