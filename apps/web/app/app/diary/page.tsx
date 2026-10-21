import type { Metadata } from "next";
import { Suspense } from "react";
import { DiaryApp } from "@/components/diary/diary-app";

export const metadata: Metadata = { title: "Health diary" };

// "Add details" is in the address (?add=1), so the back button works; reading it needs a Suspense boundary.
export default function DiaryPage() {
  return (
    <Suspense fallback={null}>
      <DiaryApp />
    </Suspense>
  );
}
