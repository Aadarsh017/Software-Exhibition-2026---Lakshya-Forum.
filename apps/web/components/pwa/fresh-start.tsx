"use client";

import { useEffect } from "react";
import { browserStore, FRESH_START_EVENT, noteHidden, noteVisible } from "@/lib/chat/open-chat";

/**
 * Notes when the app goes into the background, and when it comes back after a long time away, tells the chat screen
 * to start a new chat (lib/chat/open-chat.ts). On every page, so time spent away from any screen counts.
 */
export function FreshStart() {
  useEffect(() => {
    const back = () => {
      if (noteVisible(browserStore("session"), Date.now())) window.dispatchEvent(new Event(FRESH_START_EVENT));
    };
    // A full load counts as coming back too: the phone may have thrown the page away while it was hidden and reloaded
    // it, with no "visible" event. This runs before the chat screen reads which chat to reopen (that waits for the
    // session first).
    if (document.visibilityState === "visible") back();
    const onChange = () => {
      if (document.visibilityState === "hidden") noteHidden(browserStore("session"), Date.now());
      else back();
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return null;
}
