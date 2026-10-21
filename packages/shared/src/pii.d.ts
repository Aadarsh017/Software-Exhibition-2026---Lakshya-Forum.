export interface RedactionMap {
  byValue: Map<string, string>;
  byPlaceholder: Map<string, string>;
  counters: Record<string, number>;
}

export interface RedactionResult {
  text: string;
  /** What was hidden, by type and placeholder only. Never contains the original values. */
  found: { type: string; placeholder: string }[];
}

export function createRedactionMap(): RedactionMap;
export function redact(input: string, options?: { neverSend?: string[]; map?: RedactionMap }): RedactionResult;
export function restore(text: string, map: RedactionMap): string;
