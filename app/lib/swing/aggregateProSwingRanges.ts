import type { SwingAnalysis } from "./calculateSwingMetrics";

export type NumericMetricRange = {
  min: number;
  max: number;
  mean: number;
  /** Count of swings that had a finite value for this metric */
  n: number;
};

export type CategoricalBreakdown = Record<string, number>;

export type ProSwingRangeSummary = {
  /** One entry per processed swing (key = video basename) */
  perSwing: Record<string, SwingAnalysis | null>;
  numericRanges: Record<string, NumericMetricRange>;
  pathTypeCounts: CategoricalBreakdown;
  hipLeadTrueCount: number;
  hipLeadTotal: number;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Collect finite numeric leaves and booleans (as 0/1). Strings are ignored here;
 * handle pathType separately at the call site.
 */
export function flattenNumericLeaves(
  value: unknown,
  prefix = "",
  out: Record<string, number> = {},
): Record<string, number> {
  if (value === null || value === undefined) return out;
  if (typeof value === "boolean") {
    out[prefix] = value ? 1 : 0;
    return out;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    out[prefix] = value;
    return out;
  }
  if (typeof value === "string") return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => flattenNumericLeaves(item, `${prefix}[${i}]`, out));
    return out;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${k}` : k;
      flattenNumericLeaves(v, next, out);
    }
  }
  return out;
}

function mean(nums: number[]): number {
  if (!nums.length) return NaN;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function aggregateNumericRanges(
  perSwingFlat: Record<string, number>[],
): Record<string, NumericMetricRange> {
  const keys = new Set<string>();
  for (const row of perSwingFlat) {
    for (const k of Object.keys(row)) keys.add(k);
  }

  const ranges: Record<string, NumericMetricRange> = {};
  for (const key of keys) {
    const vals = perSwingFlat.map((r) => r[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!vals.length) continue;
    ranges[key] = {
      min: Math.min(...vals),
      max: Math.max(...vals),
      mean: mean(vals),
      n: vals.length,
    };
  }
  return ranges;
}

export function buildProSwingRangeSummary(
  perSwing: Record<string, SwingAnalysis | null>,
): ProSwingRangeSummary {
  const flats: Record<string, number>[] = [];
  const pathTypeCounts: CategoricalBreakdown = {};
  let hipLeadTrueCount = 0;
  let hipLeadTotal = 0;

  for (const analysis of Object.values(perSwing)) {
    if (!analysis) continue;
    flats.push(flattenNumericLeaves(analysis));

    const pt = analysis.swingPath.pathType;
    pathTypeCounts[pt] = (pathTypeCounts[pt] ?? 0) + 1;

    if (analysis.sequencing.hipLead === true) hipLeadTrueCount += 1;
    if (analysis.sequencing.hipLead === true || analysis.sequencing.hipLead === false) hipLeadTotal += 1;
  }

  return {
    perSwing,
    numericRanges: aggregateNumericRanges(flats),
    pathTypeCounts,
    hipLeadTrueCount,
    hipLeadTotal,
  };
}
