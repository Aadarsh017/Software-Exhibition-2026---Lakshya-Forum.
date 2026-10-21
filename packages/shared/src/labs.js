// Common blood-test markers: names, units and typical ADULT ranges (DESIGN.md 8.6b). Shared by the web app (the
// Blood report screen) and the Edge Functions (what Nox is told), so both flag a value the same way.
// DRAFT: the ranges are typical textbook adult values and must be reviewed by a doctor before launch. Labs differ, so
// the person's own report range always wins, and the app says so (LAB_RANGES_NOTE).

/** `factor` converts a value in that unit into the marker's first (main) unit. `range` is in the main unit. */
const MASS_LIPID = [{ unit: "mg/dL", factor: 1 }, { unit: "mmol/L", factor: 38.67 }];

export const LAB_MARKERS = [
  { key: "haemoglobin", label: "Haemoglobin", units: [{ unit: "g/dL", factor: 1 }, { unit: "g/L", factor: 0.1 }], range: { female: [12, 15.5], male: [13.5, 17.5], any: [12, 17.5] } },
  { key: "vitamin_d", label: "Vitamin D (25-OH)", units: [{ unit: "ng/mL", factor: 1 }, { unit: "nmol/L", factor: 0.4 }], range: { any: [30, 100] } },
  { key: "vitamin_b12", label: "Vitamin B12", units: [{ unit: "pg/mL", factor: 1 }, { unit: "pmol/L", factor: 1.355 }], range: { any: [200, 900] } },
  { key: "ferritin", label: "Ferritin (iron stores)", units: [{ unit: "ng/mL", factor: 1 }, { unit: "µg/L", factor: 1 }], range: { female: [15, 150], male: [30, 400], any: [15, 400] } },
  { key: "fasting_glucose", label: "Fasting glucose", units: [{ unit: "mg/dL", factor: 1 }, { unit: "mmol/L", factor: 18 }], range: { any: [70, 99] } },
  { key: "hba1c", label: "HbA1c", units: [{ unit: "%", factor: 1 }], range: { any: [4, 5.6] } },
  { key: "total_cholesterol", label: "Total cholesterol", units: MASS_LIPID, range: { any: [null, 199] } },
  { key: "ldl", label: "LDL cholesterol", units: MASS_LIPID, range: { any: [null, 129] } },
  { key: "hdl", label: "HDL cholesterol", units: MASS_LIPID, range: { female: [50, null], male: [40, null], any: [40, null] } },
  { key: "triglycerides", label: "Triglycerides", units: [{ unit: "mg/dL", factor: 1 }, { unit: "mmol/L", factor: 88.57 }], range: { any: [null, 149] } },
  { key: "tsh", label: "TSH (thyroid)", units: [{ unit: "mIU/L", factor: 1 }, { unit: "µIU/mL", factor: 1 }], range: { any: [0.4, 4] } },
  { key: "creatinine", label: "Creatinine (kidneys)", units: [{ unit: "mg/dL", factor: 1 }, { unit: "µmol/L", factor: 0.01131 }], range: { female: [0.5, 1.1], male: [0.7, 1.3], any: [0.5, 1.3] } },
  { key: "uric_acid", label: "Uric acid", units: [{ unit: "mg/dL", factor: 1 }, { unit: "µmol/L", factor: 0.01681 }], range: { female: [2.4, 6], male: [3.4, 7], any: [2.4, 7] } },
  { key: "platelets", label: "Platelets", units: [{ unit: "×10³/µL", factor: 1 }, { unit: "lakh/mm³", factor: 100 }], range: { any: [150, 450] } },
  { key: "wbc", label: "White blood cells", units: [{ unit: "×10³/µL", factor: 1 }], range: { any: [4, 11] } },
  { key: "calcium", label: "Calcium", units: [{ unit: "mg/dL", factor: 1 }, { unit: "mmol/L", factor: 4.008 }], range: { any: [8.5, 10.5] } },
];

export const LAB_RANGES_NOTE = "Ranges differ between labs: your report's own range wins.";

export function findMarker(key) {
  return LAB_MARKERS.find((marker) => marker.key === key) ?? null;
}

/** [low, high] in the main unit, for "female" or "male", or the wide range when sex is unknown. Either end may be null. */
export function rangeFor(marker, sex) {
  return (sex === "female" || sex === "male" ? marker.range[sex] : null) ?? marker.range.any;
}

const trim = (number) => String(Math.round(number * 1000) / 1000);

/** "Low", "High", "In range", or null when there is nothing to compare with (an "other" value or an unknown unit). */
export function labFlag(row, sex) {
  const marker = findMarker(row.marker);
  if (!marker) return null;
  const unit = marker.units.find((item) => item.unit === row.unit);
  const value = Number(row.value);
  if (!unit || !Number.isFinite(value)) return null;
  const main = value * unit.factor;
  const [low, high] = rangeFor(marker, sex);
  if (low !== null && main < low) return "low";
  if (high !== null && main > high) return "high";
  return "in_range";
}

/** The usual range in words, in the main unit: "30–100 ng/mL", "below 200 mg/dL", "40 mg/dL or more". */
export function formatRange(marker, sex) {
  const [low, high] = rangeFor(marker, sex);
  const unit = marker.units[0].unit;
  if (low !== null && high !== null) return `${trim(low)}–${trim(high)} ${unit}`;
  if (high !== null) return `${trim(high)} ${unit} or less`;
  return `${trim(low)} ${unit} or more`;
}

/** The newest value of each marker ("other" values are told apart by their name), known markers first, in list order. */
export function latestPerMarker(rows) {
  const latest = new Map();
  for (const row of rows) {
    const key = row.marker === "other" ? `other:${String(row.label ?? "").toLowerCase()}` : row.marker;
    const seen = latest.get(key);
    if (!seen || String(row.test_date) > String(seen.test_date)) latest.set(key, row);
  }
  const order = (row) => {
    const index = LAB_MARKERS.findIndex((marker) => marker.key === row.marker);
    return index === -1 ? LAB_MARKERS.length : index;
  };
  return [...latest.values()].sort((a, b) => order(a) - order(b) || String(a.label ?? "").localeCompare(String(b.label ?? "")));
}

const FLAG_WORDS = { low: "below the usual range", high: "above the usual range", in_range: "within the usual range" };

/** One line for Nox: "Vitamin D (25-OH): 14 ng/mL on 2026-09-01, below the usual range (30–100 ng/mL)". */
export function labLine(row, sex) {
  const marker = findMarker(row.marker);
  const name = marker ? marker.label : String(row.label ?? "Other");
  const base = `${name}: ${trim(Number(row.value))} ${row.unit} on ${String(row.test_date).slice(0, 10)}`;
  const flag = labFlag(row, sex);
  return flag && marker ? `${base}, ${FLAG_WORDS[flag]} (${formatRange(marker, sex)})` : base;
}
