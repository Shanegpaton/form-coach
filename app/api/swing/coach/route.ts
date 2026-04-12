import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import type { SwingAnalysis } from "../../../lib/swing/calculateSwingMetrics";
import driverProRanges from "../../../lib/swing/data/driverProRanges.json";

export const maxDuration = 60;

const SYSTEM = `You are an expert golf coach reviewing computer-vision swing metrics from a single camera (2D pose from the back).
The user's numbers come from normalized landmarks (MediaPipe-style): torso-scaled distances, joint angles in degrees, and timing in milliseconds.
Reference JSON includes numericRanges (min/max/mean from a small pro sample) and bands (padded low/high for coaching tolerance).

Your job:
- Compare the user's swing to the reference ranges where keys align.
- Call out metrics clearly outside bands or far from pro mean, and what that may imply for sequencing, path, or stability.
- Be concise and actionable (2–4 short paragraphs plus optional bullet list). Do not invent numbers not in the JSON.
- If a metric is null in the user swing, say it was not measured and skip it.`;

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

  const userPrompt = `## User swing (JSON)\n\`\`\`json\n${JSON.stringify(swing, null, 2)}\n\`\`\`\n\n## Reference ranges (JSON; club: ${String((ranges as { club?: string }).club ?? "unknown")})\n\`\`\`json\n${JSON.stringify(ranges, null, 2)}\n\`\`\`\n\nGive coaching feedback comparing the user to the reference.`;

  try {
    const { text } = await generateText({
      model: google("gemini-2.5-flash"),
      system: SYSTEM,
      prompt: userPrompt,
      temperature: 0.6,
    });

    return Response.json({ text });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, { status: 502 });
  }
}
