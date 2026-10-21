export type LabUnit = { unit: string; factor: number };
export type LabRange = [number | null, number | null];
export type LabMarker = {
  key: string;
  label: string;
  units: LabUnit[];
  range: { any: LabRange; female?: LabRange; male?: LabRange };
};
export type LabRow = { marker: string; label?: string | null; value: number | string; unit: string; test_date: string };
export type LabFlag = "low" | "high" | "in_range";

export declare const LAB_MARKERS: LabMarker[];
export declare const LAB_RANGES_NOTE: string;
export declare function findMarker(key: string): LabMarker | null;
export declare function rangeFor(marker: LabMarker, sex: string | null | undefined): LabRange;
export declare function labFlag(row: LabRow, sex: string | null | undefined): LabFlag | null;
export declare function formatRange(marker: LabMarker, sex: string | null | undefined): string;
export declare function latestPerMarker<T extends LabRow>(rows: T[]): T[];
export declare function labLine(row: LabRow, sex: string | null | undefined): string;
