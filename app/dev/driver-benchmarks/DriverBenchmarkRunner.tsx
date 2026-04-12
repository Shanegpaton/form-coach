"use client";

import { useEffect, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { toKeypoints } from "../../hooks/useAutoSwingCapture";
import type { FrameData } from "../../hooks/usePoseDetection";
import type { Keypoints } from "../../hooks/useSwingRecorder";
import { calculateSwingMetrics, type SwingAnalysis } from "../../lib/swing/calculateSwingMetrics";
import { DRIVER_BENCHMARK_VIDEO_URLS } from "../../lib/swing/driverBenchmarkVideos";
import { buildProSwingRangeSummary, type ProSwingRangeSummary } from "../../lib/swing/aggregateProSwingRanges";

const SAMPLE_FPS = 16;

function basenameFromUrl(url: string): string {
  const seg = url.split("/").pop() ?? url;
  return seg.replace(/\.mp4$/i, "");
}

function waitSeeked(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    const t = window.setTimeout(done, timeoutMs);
    video.addEventListener(
      "seeked",
      () => {
        window.clearTimeout(t);
        done();
      },
      { once: true },
    );
  });
}

function waitLoadedMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth > 0) {
      resolve();
      return;
    }
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error(video.error?.message ?? "video error")), {
      once: true,
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForVideoDimensions(video: HTMLVideoElement, timeoutMs = 8000): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (video.videoWidth > 0 && video.videoHeight > 0) return;
    await sleep(50);
  }
}

function attachOffscreenVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsInline", "true");
  video.preload = "auto";
  video.width = 1280;
  video.height = 720;
  video.style.cssText =
    "position:fixed;left:0;top:0;width:1280px;height:720px;opacity:0.02;pointer-events:none;z-index:2147483646;";
  document.body.appendChild(video);
  return video;
}

async function sampleVideoToKeypoints(
  video: HTMLVideoElement,
  landmarker: PoseLandmarker,
  sampleFps: number,
  signal: AbortSignal,
): Promise<Keypoints[]> {
  const frames: Keypoints[] = [];
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return frames;
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return frames;

  const dt = 1 / sampleFps;
  for (let t = 0; t < duration; t += dt) {
    if (signal.aborted) return frames;
    const clamped = Math.min(t, Math.max(0, duration - 1e-3));
    if (Math.abs(video.currentTime - clamped) > 1e-4) {
      video.currentTime = clamped;
      await waitSeeked(video);
    }
    const tsMs = video.currentTime * 1000;
    const result = landmarker.detectForVideo(video, tsMs);
    const firstPose = result.landmarks?.[0] ?? [];
    const joints = firstPose.map((joint) => ({
      x: joint.x,
      y: joint.y,
      z: joint.z,
      visibility: joint.visibility,
    }));
    const frameData: FrameData = { timestamp: tsMs, joints };
    frames.push(toKeypoints(frameData));
  }
  return frames;
}

export default function DriverBenchmarkRunner() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [exportJson, setExportJson] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    const { signal } = ac;
    const video = attachOffscreenVideo();

    (async () => {
      setStatus("running");
      setMessage("Loading pose model…");
      setExportJson("");

      let landmarker: PoseLandmarker | null = null;
      try {
        if (signal.aborted) return;

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
        );

        const perSwing: Record<string, SwingAnalysis | null> = {};

        for (const url of DRIVER_BENCHMARK_VIDEO_URLS) {
          if (signal.aborted) return;
          const id = basenameFromUrl(url);
          setMessage(`Processing ${id}…`);

          /** New graph per clip — VIDEO mode timestamps must not reset across files. */
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
            },
            runningMode: "VIDEO",
            numPoses: 1,
          });

          video.src = url;
          video.load();
          await waitLoadedMetadata(video);
          await waitForVideoDimensions(video);
          if (signal.aborted) return;
          try {
            await video.play();
            video.pause();
            video.currentTime = 0;
            await waitSeeked(video);
          } catch {
            /* ignore autoplay quirks */
          }
          if (video.videoWidth <= 0 || video.videoHeight <= 0) {
            throw new Error(`${id}: video has no decoded dimensions (width/height).`);
          }
          const recordedFrames = await sampleVideoToKeypoints(
            video,
            landmarker,
            SAMPLE_FPS,
            signal,
          );
          landmarker.close();
          landmarker = null;
          if (signal.aborted) return;
          const metrics = calculateSwingMetrics(recordedFrames);
          perSwing[id] = metrics;
          console.log(`[driver benchmark] ${id}`, metrics);
        }

        if (signal.aborted) return;

        const summary: ProSwingRangeSummary = buildProSwingRangeSummary(perSwing);
        const payload = { perSwing, summary };
        const json = JSON.stringify(payload, null, 2);
        setExportJson(json);
        setStatus("done");
        setMessage("Done — full JSON below (also logged per swing in console).");
        (window as unknown as { __DRIVER_BENCHMARK_RESULT__?: string }).__DRIVER_BENCHMARK_RESULT__ = json;
      } catch (e) {
        if (signal.aborted) return;
        console.error(e);
        setStatus("error");
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        if (landmarker) {
          try {
            landmarker.close();
          } catch {
            /* ignore */
          }
        }
      }
    })();

    return () => {
      ac.abort();
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Temporary batch: samples each driver clip at {SAMPLE_FPS} fps, runs the same metrics as live capture.
        Video element is appended to <code className="text-xs">document.body</code> so React Strict Mode cannot
        detach it mid-run.
      </p>
      <p
        className="text-sm font-medium text-zinc-900 dark:text-zinc-100"
        id="driver-benchmark-status"
        data-status={status}
      >
        {status === "idle" && "Starting…"}
        {status === "running" && message}
        {status === "done" && message}
        {status === "error" && `Error: ${message}`}
      </p>
      <pre
        id="driver-benchmark-json"
        className="max-h-[70vh] overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-100"
      >
        {exportJson || (status === "running" ? "…" : "")}
      </pre>
    </div>
  );
}
