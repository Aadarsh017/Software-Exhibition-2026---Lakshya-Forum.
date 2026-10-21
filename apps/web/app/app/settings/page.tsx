import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsApp } from "@/components/settings/settings-app";

export const metadata: Metadata = { title: "Settings" };

// The page on screen is in the address (?page=…), so the back button works; reading it needs a Suspense boundary.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsApp />
    </Suspense>
  );
}
