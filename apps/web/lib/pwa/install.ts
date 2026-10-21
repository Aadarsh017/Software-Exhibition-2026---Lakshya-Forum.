// Installing the app (DESIGN.md 7.8). Browsers that can install fire `beforeinstallprompt`, often before React has
// loaded, so a tiny script in <head> (INSTALL_SCRIPT) keeps the event on window and says when it changes. Holding
// the event back also stops the browser's own install banner: the sidebar row is the only nudge.
// iPhone and iPad never fire it; they get a one-line "Share, then Add to Home Screen" hint instead.

/** The part of Chrome's BeforeInstallPromptEvent we use. */
export type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __hchInstall?: InstallPrompt | null;
  }
}

export const INSTALL_CHANGE = "hch-installchange";

export const INSTALL_SCRIPT = `(function(){function c(e){window.__hchInstall=e;window.dispatchEvent(new Event("${INSTALL_CHANGE}"))}window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();c(e)});window.addEventListener("appinstalled",function(){c(null)})})();`;

export function subscribeInstall(onChange: () => void): () => void {
  window.addEventListener(INSTALL_CHANGE, onChange);
  return () => window.removeEventListener(INSTALL_CHANGE, onChange);
}

export function installPrompt(): InstallPrompt | null {
  return window.__hchInstall ?? null;
}

/** Opens the browser's install dialog. The event works once, so the row goes away whatever the answer. */
export async function promptInstall(): Promise<void> {
  const event = installPrompt();
  if (!event) return;
  window.__hchInstall = null;
  window.dispatchEvent(new Event(INSTALL_CHANGE));
  await event.prompt();
  await event.userChoice.catch(() => undefined);
}

type Device = { userAgent: string; platform?: string; maxTouchPoints?: number; standalone?: boolean };

/** iPhone or iPad, not already opened from the Home Screen. iPadOS says "MacIntel" but has a touch screen. */
export function needsShareHint(device: Device, displayStandalone: boolean): boolean {
  if (device.standalone === true || displayStandalone) return false;
  return /iPhone|iPad|iPod/.test(device.userAgent) || (device.platform === "MacIntel" && (device.maxTouchPoints ?? 0) > 1);
}
