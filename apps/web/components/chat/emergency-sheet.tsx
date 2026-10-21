"use client";

import type { Sheet } from "@/lib/chat/use-chat";
import { whileYouWait } from "@/lib/chat/while-you-wait";
import { PhoneIcon } from "@/components/nox";
import { Modal } from "./modal";
import { useEmergencyNumbers } from "./use-emergency-numbers";

// The most important screen in the product, and deliberately plain: no mascot, no pastel, no animation
// (DESIGN.md 7.7). It works with no network. The "while you wait" lines are a draft for clinician review.
const MAPS = "https://www.google.com/maps/search/?api=1&query=emergency+hospital+near+me";

/** The person's own emergency contact, from their emergency card (Personalization), when they saved one. */
export type EmergencyContact = { name: string; phone: string };

export function EmergencySheet({ sheet, onClose, contact = null }: { sheet: Sheet | null; onClose: () => void; contact?: EmergencyContact | null }) {
  const numbers = useEmergencyNumbers();
  const open = sheet !== null;
  if (sheet?.kind === "crisis") return <CrisisSheet open={open} onClose={onClose} india={numbers.region === "IN"} number={numbers.primary.number} />;

  const urgentCare = sheet?.level === "emergency";
  return (
    <Modal open={open} onClose={onClose} role="alertdialog" labelledBy="emergency-title" describedBy="emergency-body" className="sheet sheet-center">
      {sheet ? (
        <div className="sheet-alert" id="emergency-body">
          <h1 id="emergency-title" className="text-[clamp(2.25rem,1.6rem+2.6vw,3rem)] leading-[1.05] text-white">
            This could be an emergency
          </h1>
          {sheet.signs.length ? <p className="m-0 text-[1.1875rem]">You mentioned: {sheet.signs.join("; ").replace(/^./, (c) => c.toLowerCase())}</p> : null}

          {urgentCare ? (
            <>
              <a className="btn btn-emergency" href={MAPS} target="_blank" rel="noopener noreferrer" data-autofocus>
                Find emergency care
                <span className="sr-only">(opens a map in a new tab)</span>
              </a>
              <a className="btn btn-emergency" href={`tel:${numbers.primary.number}`}>
                <PhoneIcon /> {numbers.primary.label}
              </a>
            </>
          ) : (
            <a className="btn btn-emergency" href={`tel:${numbers.primary.number}`} data-autofocus>
              <PhoneIcon /> {numbers.primary.label} now
            </a>
          )}
          {numbers.secondary ? (
            <a className="btn btn-emergency" href={`tel:${numbers.secondary.number}`} style={{ minHeight: 56, fontSize: "1.0625rem" }}>
              {numbers.secondary.label}
            </a>
          ) : null}
          {contact ? (
            <a className="btn btn-ghost-on-red" href={`tel:${contact.phone.replace(/[^+0-9]/g, "")}`} style={{ minHeight: 52 }}>
              <PhoneIcon /> Call {contact.name}
            </a>
          ) : null}

          <div>
            <h2 className="mb-1.5 text-[1.375rem] text-white">While you wait</h2>
            <ul className="m-0 grid list-disc gap-1.5 pl-5">
              {whileYouWait(sheet.ruleIds).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <button type="button" className="btn btn-ghost-on-red" onClick={onClose}>
            I&apos;ve called. Back to chat
          </button>
          <button type="button" className="justify-self-start bg-transparent p-1 text-[0.9375rem] text-white underline" onClick={onClose}>
            This isn&apos;t an emergency
          </button>
          <p className="m-0 text-[0.875rem] opacity-90">{numbers.footer}</p>
        </div>
      ) : null}
    </Modal>
  );
}

function CrisisSheet({ open, onClose, india, number }: { open: boolean; onClose: () => void; india: boolean; number: string }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="crisis-title" className="sheet sheet-center calm">
      <div className="sheet-calm">
        <h1 id="crisis-title" className="text-[clamp(1.9rem,1.4rem+2vw,2.5rem)] leading-[1.1]">
          You&apos;re not alone, and you don&apos;t have to work this out tonight.
        </h1>
        <div className="grid gap-3 rounded-[var(--r-md)] border-[2px] border-[var(--line)] bg-[var(--block-lilac)] p-4 text-[var(--on-block)]">
          {india ? (
            <a className="btn btn-lg" href="tel:14416" data-autofocus>
              Call Tele-MANAS 14416 · free, day and night
            </a>
          ) : (
            <p className="m-0">If you&apos;re outside India, please call your local crisis line or emergency number.</p>
          )}
          <a className="btn btn-lg" href={`tel:${number}`} {...(india ? {} : { "data-autofocus": true })}>
            Call {number} if you&apos;re in immediate danger
          </a>
          <button type="button" className="btn btn-lg btn-primary" onClick={onClose}>
            Keep talking with me
          </button>
        </div>
        <p className="m-0 text-[0.9375rem] text-[var(--ink-muted)]">I&apos;m an AI. I can listen and share information, but I can&apos;t watch over you. Talking to a person can help.</p>
      </div>
    </Modal>
  );
}
