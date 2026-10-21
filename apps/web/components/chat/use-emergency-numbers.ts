"use client";

import { useEffect, useState } from "react";
import { detectRegion, emergencyNumbers, type EmergencyNumbers } from "@/lib/chat/region";

/** Numbers for the person's region. Starts as India (same on server and browser), then refines. */
export function useEmergencyNumbers(): EmergencyNumbers {
  const [numbers, setNumbers] = useState<EmergencyNumbers>(() => emergencyNumbers("IN"));
  useEffect(() => {
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = undefined;
    }
    setNumbers(emergencyNumbers(detectRegion(navigator.language, zone)));
  }, []);
  return numbers;
}
