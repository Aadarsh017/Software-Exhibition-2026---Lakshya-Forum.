export type ConsentDoc = "age_18" | "terms" | "ai_processing";

export const REQUIRED_CONSENTS: Readonly<Record<ConsentDoc, string>>;

export function missingConsents(
  accepted: readonly { doc_type: string; version: string }[] | null | undefined,
  required?: Readonly<Record<string, string>>,
): string[];
