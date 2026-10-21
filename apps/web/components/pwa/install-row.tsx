"use client";

import { useSyncExternalStore } from "react";
import { DownloadIcon, IosShareIcon } from "@/components/chat/icons";
import { installPrompt, needsShareHint, promptInstall, subscribeInstall } from "@/lib/pwa/install";

const noSubscribe = () => () => {};

function shareHint(): boolean {
  return needsShareHint(navigator as Navigator & { standalone?: boolean }, window.matchMedia("(display-mode: standalone)").matches);
}

/**
 * "Install the app", quietly, in the sidebar (DESIGN.md 7.8): a row only when the browser offers to install,
 * and on iPhone a line saying how. Nothing at all otherwise, including inside the installed app.
 */
export function InstallRow() {
  const prompt = useSyncExternalStore(subscribeInstall, installPrompt, () => null);
  const ios = useSyncExternalStore(noSubscribe, shareHint, () => false);

  if (prompt) {
    return (
      <div className="px-3 pb-2">
        <button type="button" className="nav-row" onClick={() => void promptInstall()}>
          <span className="tile" data-tone="mint" aria-hidden="true">
            <DownloadIcon size={18} />
          </span>
          Install the app
        </button>
      </div>
    );
  }
  if (ios) {
    return (
      <div className="px-3 pb-2">
        <p className="nav-row nav-row-static m-0">
          <span className="tile" data-tone="mint" aria-hidden="true">
            <IosShareIcon size={18} />
          </span>
          <span className="grid min-w-0">
            Install the app
            <span className="nav-row-hint">Share, then Add to Home Screen</span>
          </span>
        </p>
      </div>
    );
  }
  return null;
}
