// When to show the care-level strip on an answer (DESIGN.md 7.6, "When the care strip shows"). Erasable TypeScript only.
import type { CareLevel } from "./types.ts";

const RANK: Record<CareLevel, number> = { selfcare: 1, doctor: 2, doctor24: 3, emergency: 4, ambulance: 5 };

export function isUrgentLevel(level: CareLevel): boolean {
  return RANK[level] >= RANK.emergency;
}

/**
 * Show the strip on the first answer that has a level, whenever the level goes above what is already shown, and always
 * at the two emergency levels. The same or a lower non-urgent level is not shown: the higher advice above still stands,
 * and a lower strip could read as "it's fine now".
 */
export function shouldShowCareStrip(level: CareLevel | undefined, standing: CareLevel | undefined): boolean {
  if (!level) return false;
  if (isUrgentLevel(level)) return true;
  if (!standing) return true;
  return RANK[level] > RANK[standing];
}

/**
 * The advice already on screen: the highest level among earlier answers (undefined when none had one). Because a strip
 * shows on the first level and on every rise, this is the last non-urgent strip the person saw.
 */
export function standingCareLevel(levels: (CareLevel | undefined)[], index: number): CareLevel | undefined {
  let best: CareLevel | undefined;
  for (let i = 0; i < index; i += 1) {
    const level = levels[i];
    if (level && (!best || RANK[level] > RANK[best])) best = level;
  }
  return best;
}
