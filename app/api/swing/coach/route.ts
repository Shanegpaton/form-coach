import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import type { SwingAnalysis } from "../../../lib/swing/calculateSwingMetrics";
import driverProRanges from "../../../lib/swing/data/driverProRanges.json";
import driverMetricImportance from "../../../lib/swing/data/driverMetricImportance.json";

export const maxDuration = 60;

const DEFAULT_METRIC_IMPORTANCE = 3;

function buildMetricImportanceForKeys(
  numericKeys: string[],
  map: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of numericKeys) {
    const v = map[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = Math.min(5, Math.max(1, Math.round(v)));
    } else {
      out[key] = DEFAULT_METRIC_IMPORTANCE;
    }
  }
  return out;
}

function buildMetricNotesForKeys(
  numericKeys: string[],
  notes: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!notes) return undefined;
  const out: Record<string, string> = {};
  for (const key of numericKeys) {
    const t = notes[key];
    if (typeof t === "string" && t.length > 0) out[key] = t;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Pro reference was built from offline full-clip sampling; live user timing is a different pipeline—omit from comparison. */
function stripIncomparableTimingFromProRanges(
  ranges: typeof driverProRanges,
): typeof driverProRanges {
  const out = structuredClone(ranges);
  const strip = (rec: Record<string, unknown> | undefined) => {
    if (!rec) return;
    for (const key of Object.keys(rec)) {
      if (key === "metadata.durationMs" || key.startsWith("sequencing.timing.")) {
        delete rec[key];
      }
    }
  };
  strip(out.numericRanges as Record<string, unknown>);
  strip(out.bands as Record<string, unknown>);
  return out;
}

const SYSTEM = `You are an expert golf coach reviewing computer-vision swing metrics from a single camera (2D pose from the back).

The user's numbers come from normalized landmarks (MediaPipe-style): torso-scaled distances, joint angles in degrees, and timing in milliseconds.
Reference JSON includes numericRanges (min/max/mean from a small pro sample), bands (padded low/high for coaching tolerance), **metricImportance** (1–5 per stat key), and optionally **metricNotes** (caveats for noisy metrics).

Metric importance (critical):
- **Higher scores = prioritize** that stat when choosing what to coach (ball flight, consistency).
- If a metric is missing from metricImportance, it defaults to ${DEFAULT_METRIC_IMPORTANCE} (medium).
- When several things look "off," focus the 2–3 main talking points on **higher** importance metrics first; lower scores matter only if they clearly drive a big miss.
- **metricNotes** (when present) describe weak or ambiguous measurements—do not treat those stats like spine angle or path; phrase feedback carefully.

Timing vs pros (critical):
- Pro reference posture, kinematics, path, and stability ranges are comparable to the user.
- Duration and sequencing timestamps are NOT comparable due to different pipelines.
- Do NOT compare tempo or timing to pro values.
- You may briefly note obvious timing/data issues, but do not coach based on them.

Your job:
- Compare the user's swing to reference ranges (posture, kinematics, path, stability).
- Identify ONLY the 2–3 most important issues—**weighted by metricImportance**, not by how many numbers diverge (focus on ball flight + consistency).
- Explain what each issue likely causes.
- Give 1–2 simple, actionable fixes per issue.

Style rules (VERY IMPORTANT):
- Speak like a coach, NOT a data analyst.
- **No opening filler:** Do not start with praise, hedging, or a warm-up summary (e.g. "overall you've got some good elements", "your swing looks solid but", "there's a lot to like", "first off the good news"). Jump straight into the **first** highest-priority issue in plain language—the first sentence should already be coaching content.
- Do NOT include raw numbers (degrees, milliseconds, etc.) unless absolutely necessary.
- Instead, describe differences using terms like:
  "slightly", "too much", "very upright", "more than typical", "less than ideal".
- Only mention numbers if it helps emphasize a major issue (and keep it minimal).
- Translate all metrics into simple golf concepts (setup, balance, swing path, rotation).

Output format:
- Max 2 short paragraphs (first paragraph = first issue immediately—no standalone intro).
- Then a small bullet list of fixes.
- Use **bold** for key concepts and fixes.
- Keep it clear, simple, and actionable.
- Do NOT overwhelm the user with many details.
`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function looksLikeSwingAnalysis(v: unknown): v is SwingAnalysis {
  if (!isRecord(v)) return false;
  const m = v.metadata;
  if (!isRecord(m)) return false;
  return typeof m.durationMs === "number";
}

export async function POST(req: Request) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json(
      { error: "Missing GOOGLE_GENERATIVE_AI_API_KEY. Add it to .env.local for Gemini." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(body) || !looksLikeSwingAnalysis(body.swing)) {
    return Response.json(
      { error: "Body must include { swing: SwingAnalysis } — see calculateSwingMetrics output shape." },
      { status: 400 },
    );
  }

  const swing = body.swing as SwingAnalysis;
  const ranges =
    body.ranges !== undefined && body.ranges !== null
      ? (body.ranges as typeof driverProRanges)
      : driverProRanges;

  const rangesForCoach = stripIncomparableTimingFromProRanges(ranges);
  const numericKeys = Object.keys(rangesForCoach.numericRanges ?? {});
  const metricImportance = buildMetricImportanceForKeys(
    numericKeys,
    driverMetricImportance.metricImportance as Record<string, number>,
  );
  const metricNotes = buildMetricNotesForKeys(
    numericKeys,
    driverMetricImportance.metricNotes as Record<string, string> | undefined,
  );

  const coachReferencePayload = {
    metricImportanceScale: driverMetricImportance.scale,
    metricImportance,
    ...(metricNotes ? { metricNotes } : {}),
    referenceRanges: rangesForCoach,
  };

  const userPrompt = `## User swing (JSON)\n\`\`\`json\n${JSON.stringify(swing, null, 2)}\n\`\`\`\n\n## Pro reference + coaching priorities (JSON; club: ${String((rangesForCoach as { club?: string }).club ?? "unknown")})\nPro timing/duration aggregates are omitted from referenceRanges—they were measured differently from live capture. Use **metricImportance** to decide which deviations matter most.\n\`\`\`json\n${JSON.stringify(coachReferencePayload, null, 2)}\n\`\`\`\n\nGive coaching feedback comparing the user to the reference (posture, kinematics, path, stability—not user ms vs pro timing). Weight issues by metricImportance. **First sentence = first concrete issue**—no praise-only or "overall" intro paragraph.`;

  try {
    const result = streamText({
      model: google("gemini-2.5-flash"),
      system: SYSTEM,
      prompt: userPrompt,
      temperature: 0.6,
    });

    return result.toTextStreamResponse({
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: 502 });
  }
}
