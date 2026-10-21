// Puts a text size on the page and remembers it on this device. Browser only.
import type { TextSize } from "./settings.ts";

export function applyTextSize(size: TextSize): void {
  try {
    localStorage.setItem("hch-text-size", size);
  } catch {
    // Storage can be blocked; the choice still applies to this visit.
  }
  if (size === "m") delete document.documentElement.dataset.textSize;
  else document.documentElement.dataset.textSize = size;
}

/** On a new device the account's saved text size applies, unless this device already has its own. */
export function applyAccountSettings(size: TextSize): void {
  let hasSize = false;
  try {
    hasSize = localStorage.getItem("hch-text-size") !== null;
  } catch {
    // ignore
  }
  if (!hasSize) applyTextSize(size);
}
