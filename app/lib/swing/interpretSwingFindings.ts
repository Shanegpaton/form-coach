import type { SwingAnalysis } from "./calculateSwingMetrics";
import driverProRanges from "./data/driverProRanges.json";
import driverMetricImportance from "./data/driverMetricImportance.json";

export type SwingFindingId =
  | "swing-path"
  | "spine-angle"
  | "knee-flex"
  | "head-movement";

export type SwingFindingStatus = "low" | "good" | "high" | "unknown";

export type SwingFindingMetric = {
  key: string;
  label: string;
  value: number | string | null;
  displayValue: string;
  status: SwingFindingStatus;
};

export type SwingFinding = {
  id: SwingFindingId;
  label: string;
  status: SwingFindingStatus;
  priority: number;
  summary: string;
  detail: string;
  metricKeys: string[];
  metrics: SwingFindingMetric[];
  caveat?: string;
};

type RangeBand = {
  low: number;
  high: number;
  observedMin?: number;
  observedMax?: number;
};

const metricImportance = driverMetricImportance.metricImportance as Record<string, number>;
const rangeBands = driverProRanges.bands as Record<string, RangeBand | undefined>;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compareToBand(key: string, value: number | null): SwingFindingStatus {
  if (!finiteNumber(value)) return "unknown";
  const band = rangeBands[key];
  if (!band || !finiteNumber(band.low) || !finiteNumber(band.high)) return "unknown";
  if (value < band.low) return "low";
  if (value > band.high) return "high";
  return "good";
}

function metric(
  key: string,
  label: string,
  value: number | string | null,
  displayValue: string,
  status?: SwingFindingStatus,
): SwingFindingMetric {
  return {
    key,
    label,
    value,
    displayValue,
    status: status ?? (finiteNumber(value) ? compareToBand(key, value) : "unknown"),
  };
}

function formatDegrees(value: number | null): string {
  return finiteNumber(value) ? `${Math.abs(value).toFixed(0)} deg` : "Not measured";
}

function formatScaled(value: number | null): string {
  return finiteNumber(value) ? value.toFixed(2) : "Not measured";
}

function maxImportance(keys: string[]): number {
  return Math.max(1, ...keys.map((key) => metricImportance[key] ?? 3));
}

function groupStatus(metrics: SwingFindingMetric[]): SwingFindingStatus {
  const known = metrics.filter((item) => item.status !== "unknown");
  if (known.length === 0) return "unknown";
  const priorityStatus = known.find((item) => item.status !== "good")?.status;
  return priorityStatus ?? "good";
}

function pathLabel(pathType: SwingAnalysis["swingPath"]["pathType"]): string {
  if (pathType === "inside-out") return "Inside-out";
  if (pathType === "outside-in") return "Outside-in";
  return "Neutral";
}

function buildSwingPathFinding(swing: SwingAnalysis): SwingFinding {
  const keys = ["swingPath.downswingVector.angleDeg"];
  const pathType = swing.swingPath.pathType;
  const status: SwingFindingStatus =
    pathType === "neutral" ? "good" : pathType === "inside-out" ? "high" : "low";
  const angle = swing.swingPath.downswingVector?.angleDeg ?? null;
  const summary =
    pathType === "neutral"
      ? "Your path reads close to neutral."
      : pathType === "inside-out"
        ? "Your path reads more inside-out."
        : "Your path reads more outside-in.";

  return {
    id: "swing-path",
    label: "Swing path",
    status,
    priority: maxImportance(keys),
    summary,
    detail: "Estimated from the lead-wrist direction from the top of the swing into impact.",
    metricKeys: keys,
    metrics: [
      metric("swingPath.pathType", "Path type", pathType, pathLabel(pathType), status),
      metric("swingPath.downswingVector.angleDeg", "Downswing direction", angle, formatDegrees(angle)),
    ],
  };
}

function buildSpineAngleFinding(swing: SwingAnalysis): SwingFinding {
  const keys = ["posture.spineAngle.setup", "posture.spineAngle.impact"];
  const setup = swing.posture.spineAngle.setup;
  const impact = swing.posture.spineAngle.impact;
  const metrics = [
    metric(keys[0], "Setup bend", setup, formatDegrees(setup)),
    metric(keys[1], "Impact bend", impact, formatDegrees(impact)),
  ];
  const status = groupStatus(metrics);
  const summary =
    status === "low"
      ? "You look more bent over than the driver reference range."
      : status === "high"
        ? "You look more upright than the driver reference range."
        : status === "good"
          ? "Your spine bend is in the driver reference range."
          : "Spine bend could not be measured reliably.";

  return {
    id: "spine-angle",
    label: "Spine angle",
    status,
    priority: maxImportance(keys),
    summary,
    detail: "This uses the right shoulder-to-hip line at setup and impact as a 2D bend-over estimate.",
    metricKeys: keys,
    metrics,
  };
}

function buildKneeFlexFinding(swing: SwingAnalysis): SwingFinding {
  const keys = ["posture.kneeFlex.setup", "posture.kneeFlex.impact", "posture.kneeFlex.min"];
  const metrics = [
    metric(keys[0], "Setup knee angle", swing.posture.kneeFlex.setup, formatDegrees(swing.posture.kneeFlex.setup)),
    metric(keys[1], "Impact knee angle", swing.posture.kneeFlex.impact, formatDegrees(swing.posture.kneeFlex.impact)),
    metric(keys[2], "Most knee bend", swing.posture.kneeFlex.min, formatDegrees(swing.posture.kneeFlex.min)),
  ];
  const status = groupStatus(metrics);
  const summary =
    status === "low"
      ? "Your knees read more flexed than the driver reference range."
      : status === "high"
        ? "Your knees read straighter than the driver reference range."
        : status === "good"
          ? "Your knee flex is in the driver reference range."
          : "Knee flex could not be measured reliably.";

  return {
    id: "knee-flex",
    label: "Knee flex",
    status,
    priority: maxImportance(keys),
    summary,
    detail: "This uses the right hip-knee-ankle angle through setup, impact, and the deepest bend before impact.",
    metricKeys: keys,
    metrics,
  };
}

function buildHeadMovementFinding(swing: SwingAnalysis): SwingFinding {
  const keys = ["stability.headMovement", "stability.headRise"];
  const metrics = [
    metric(keys[0], "Total head movement", swing.stability.headMovement, formatScaled(swing.stability.headMovement)),
    metric(keys[1], "Head rise", swing.stability.headRise, formatScaled(swing.stability.headRise)),
  ];
  const status = groupStatus(metrics);
  const summary =
    status === "high"
      ? "Your head moves more than the driver reference range."
      : status === "low"
        ? "Your head stays lower than the driver reference range into impact."
        : status === "good"
          ? "Your head movement is in the driver reference range."
          : "Head movement could not be measured reliably.";

  return {
    id: "head-movement",
    label: "Head movement",
    status,
    priority: maxImportance(keys),
    summary,
    detail: "Movement is normalized by setup torso length so camera scale has less effect.",
    metricKeys: keys,
    metrics,
  };
}

export function interpretSwingFindings(swing: SwingAnalysis): SwingFinding[] {
  return [
    buildSwingPathFinding(swing),
    buildSpineAngleFinding(swing),
    buildKneeFlexFinding(swing),
    buildHeadMovementFinding(swing),
  ];
}
