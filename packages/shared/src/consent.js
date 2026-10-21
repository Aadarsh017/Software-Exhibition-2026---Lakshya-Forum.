// What a person must accept before the AI answers, and the version of each document.
// The web app shows these checkboxes during onboarding; the chat function refuses to answer
// until every one is stored in the consents table with this exact version.
// Bump a version when its text changes: everyone is asked again.

export const REQUIRED_CONSENTS = {
  age_18: "2026-10-19",
  terms: "2026-10-19",
  ai_processing: "2026-10-19",
};

/** Document types from REQUIRED_CONSENTS that `accepted` (rows of { doc_type, version }) does not cover. */
export function missingConsents(accepted, required = REQUIRED_CONSENTS) {
  const have = new Set((accepted || []).map((row) => `${row.doc_type}:${row.version}`));
  return Object.entries(required)
    .filter(([docType, version]) => !have.has(`${docType}:${version}`))
    .map(([docType]) => docType);
}
