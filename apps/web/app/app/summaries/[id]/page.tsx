import type { Metadata } from "next";
import { Suspense } from "react";
import { SummaryView } from "@/components/summary/summary-view";

export const metadata: Metadata = { title: "Visit summary" };

export default function SummaryPage() {
  return (
    <Suspense>
      <SummaryView />
    </Suspense>
  );
}
