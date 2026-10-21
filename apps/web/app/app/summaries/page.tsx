import type { Metadata } from "next";
import { SummariesApp } from "@/components/summary/summaries-app";

export const metadata: Metadata = { title: "Doctor summaries" };

export default function SummariesPage() {
  return <SummariesApp />;
}
