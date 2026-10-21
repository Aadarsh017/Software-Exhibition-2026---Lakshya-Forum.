import type { Metadata } from "next";
import { Suspense } from "react";
import { FoodApp } from "@/components/food/food-app";

export const metadata: Metadata = { title: "Thali" };

// The day and the meal are in the address (?day=…&meal=…), so the back button works; reading it needs a Suspense boundary.
export default function ThaliPage() {
  return (
    <Suspense fallback={null}>
      <FoodApp />
    </Suspense>
  );
}
