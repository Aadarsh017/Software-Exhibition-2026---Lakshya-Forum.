import type { Metadata } from "next";
import { Suspense } from "react";
import { PersonalizationApp } from "@/components/personalization/personalization-app";

export const metadata: Metadata = { title: "Personalization" };

// The topic on screen is in the address (?section=…), so the back button works; reading it needs a Suspense boundary.
export default function PersonalizationPage() {
  return (
    <Suspense fallback={null}>
      <PersonalizationApp />
    </Suspense>
  );
}
