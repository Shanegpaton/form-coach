'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DrawingUtils,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { usePoseDetection } from '../hooks/usePoseDetection';
import { calculateSwingMetrics, type SwingAnalysis } from '../lib/swing/calculateSwingMetrics';
import { createDemoSwingFrames } from '../lib/swing/createDemoSwing';
import {
  interpretSwingFindings,
  type SwingFinding,
  type SwingFindingStatus,
} from '../lib/swing/interpretSwingFindings';
import { useAutoSwingCapture } from '../hooks/useAutoSwingCapture';
import type { Keypoints } from '../hooks/useSwingRecorder';
import { CoachMarkdown } from './CoachMarkdown';
import { SwingReplayComparison } from './SwingReplayComparison';

type PoseColors = { landmark: string; connector: string };
type VideoSize = { width: number; height: number };

function getPoseColors(status: string, fullBodyFramed: boolean): PoseColors {
  if (status === 'armed_waiting_still' && !fullBodyFramed) {
    return { landmark: '#ef4444', connector: '#dc2626' };
  }
  if (status === 'armed_waiting_still' && fullBodyFramed) {
    return { landmark: '#eab308', connector: '#ca8a04' };
  }
  if (status === 'armed_waiting_motion' || status === 'recording') {
    return { landmark: '#22c55e', connector: '#16a34a' };
  }
  return { landmark: '#00ff88', connector: '#00b4ff' };
}

const btnFocus =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-200';

const SWING_VIDEO_LEAD_IN_SECONDS = 0.2;

function preferredRecordingMimeType(): string | undefined {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function findingStatusLabel(status: SwingFindingStatus): string {
  if (status === 'good') return 'In range';
  if (status === 'low') return 'Low';
  if (status === 'high') return 'High';
  return 'Needs review';
}

function findingStatusClasses(status: SwingFindingStatus): string {
  if (status === 'good') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  if (status === 'low' || status === 'high') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200';
  }
  return 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300';
}

function findingPrimaryResult(finding: SwingFinding): string {
  return finding.metrics[0]?.displayValue ?? findingStatusLabel(finding.status);
}

function findingVerdict(finding: SwingFinding): string {
  if (finding.status === 'unknown') return 'Needs review';
  if (finding.status === 'good') return 'Looks good';
  if (finding.id === 'swing-path') {
    return finding.status === 'high' ? 'Inside-out path' : 'Outside-in path';
  }
  if (finding.id === 'spine-angle') {
    return finding.status === 'high' ? 'Too upright' : 'Too bent over';
  }
  if (finding.id === 'knee-flex') {
    return finding.status === 'high' ? 'Not enough knee flex' : 'Too much knee flex';
  }
  if (finding.id === 'head-movement') {
    return finding.status === 'high' ? 'Too much movement' : 'Very little rise';
  }
  return findingStatusLabel(finding.status);
}

function findingChipClasses(finding: SwingFinding, selected: boolean): string {
  const selectedClass = selected
    ? 'ring-2 ring-zinc-900 ring-offset-2 ring-offset-white dark:ring-zinc-100 dark:ring-offset-zinc-950'
    : '';
  if (finding.status === 'good') {
    return `${selectedClass} border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-300 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-100`;
  }
  if (finding.status === 'low' || finding.status === 'high') {
    return `${selectedClass} border-amber-200 bg-amber-50 text-amber-950 hover:border-amber-300 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100`;
  }
  return `${selectedClass} border-zinc-200 bg-zinc-50 text-zinc-900 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-100`;
}

function coachPriorityLabel(value: number): string {
  if (value >= 5) return 'High focus';
  if (value <= 2) return 'Lower priority';
  return 'Normal priority';
}

export default function CameraStream() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const swingRecorderRef = useRef<MediaRecorder | null>(null);
  const swingVideoChunksRef = useRef<BlobPart[]>([]);
  const keepSwingVideoOnStopRef = useRef(false);
  const swingVideoUrlRef = useRef<string | null>(null);
  const videoRecordingStartTimestampRef = useRef<number | null>(null);
  const swingVideoClipStartSecondsRef = useRef(0);
  const recordedFramesRef = useRef<Keypoints[]>([]);
  const { landmarks, frameData, startCamera, cameraError, hasCamera, isModelReady } =
    usePoseDetection(videoRef);
  const { status, isArmed, isRecording, fullBodyFramed, recordedFrames, arm, cancel } =
    useAutoSwingCapture(frameData);

  const poseColors = useMemo(() => getPoseColors(status, fullBodyFramed), [status, fullBodyFramed]);

  const [lastSwing, setLastSwing] = useState<SwingAnalysis | null>(null);
  const [coachText, setCoachText] = useState<string>('');
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  /** One coach run per capture; cleared when a new swing completes. */
  const [coachConsumedForCapture, setCoachConsumedForCapture] = useState(false);
  const [coachContext, setCoachContext] = useState('');
  const [findingCorrections, setFindingCorrections] = useState<Record<string, string>>({});
  const [findingPriorityOverrides, setFindingPriorityOverrides] = useState<Record<string, number>>({});
  const [selectedFindingId, setSelectedFindingId] = useState<string>('swing-path');
  const [cameraStartPending, setCameraStartPending] = useState(false);
  const [swingVideoUrl, setSwingVideoUrl] = useState<string | null>(null);
  const [swingVideoClipStartSeconds, setSwingVideoClipStartSeconds] = useState(0);
  const [swingVideoSize, setSwingVideoSize] = useState<VideoSize | null>(null);
  const [demoFrames, setDemoFrames] = useState<Keypoints[] | null>(null);
  const displayFrames = demoFrames ?? recordedFrames;

  const swingFindings = useMemo(
    () => (lastSwing ? interpretSwingFindings(lastSwing) : []),
    [lastSwing],
  );
  const coachFindings = useMemo(
    () =>
      swingFindings.map((finding) => ({
        ...finding,
        priority: findingPriorityOverrides[finding.id] ?? finding.priority,
      })),
    [swingFindings, findingPriorityOverrides],
  );
  const selectedFinding =
    coachFindings.find((finding) => finding.id === selectedFindingId) ?? coachFindings[0] ?? null;
  const selectedSystemPriority =
    swingFindings.find((finding) => finding.id === selectedFinding?.id)?.priority ??
    selectedFinding?.priority ??
    3;

  const statusMessage = useMemo(() => {
    if (status === 'idle') {
      if (!isModelReady) {
        return 'Loading pose model…';
      }
      if (!hasCamera) {
        return 'Tap Arm recording to turn on the camera. On a phone, you must allow access when prompted—this only works after you tap.';
      }
      return 'Camera on. Arm recording when you are set up.';
    }
    if (status === 'armed_waiting_still' && !fullBodyFramed) {
      return 'Step back until your head through your ankles stay in frame.';
    }
    if (status === 'armed_waiting_still' && fullBodyFramed) {
      return 'Hold still while we lock your setup.';
    }
    if (status === 'armed_waiting_motion') {
      return 'Swing when you are ready.';
    }
    if (status === 'recording') {
      return 'Recording your swing.';
    }
    if (status === 'completed') {
      return lastSwing
        ? 'Swing captured. Replay it beside a pro reference or ask the coach.'
        : 'Capture finished.';
    }
    return '';
  }, [status, fullBodyFramed, lastSwing, hasCamera, isModelReady]);

  const frameHint = useMemo(() => {
    if (status === 'armed_waiting_still' && !fullBodyFramed) {
      return 'Show head through ankles in the frame.';
    }
    if (
      (status === 'armed_waiting_motion' || status === 'recording' || status === 'completed') &&
      recordedFrames.length > 0
    ) {
      return `${recordedFrames.length} frames`;
    }
    return null;
  }, [status, fullBodyFramed, recordedFrames.length]);

  useEffect(() => {
    recordedFramesRef.current = displayFrames;
  }, [displayFrames]);

  useEffect(() => {
    const drawPose = (landmarksByPose: NormalizedLandmark[][], colors: PoseColors) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw <= 0 || vh <= 0) return;

      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = vw;
      canvas.height = vh;
      canvas.style.width = `${video.clientWidth}px`;
      canvas.style.height = `${video.clientHeight}px`;

      context.clearRect(0, 0, canvas.width, canvas.height);
      const drawingUtils = new DrawingUtils(context);

      landmarksByPose.forEach((poseLandmarks) => {
        drawingUtils.drawConnectors(poseLandmarks, PoseLandmarker.POSE_CONNECTIONS, {
          color: colors.connector,
          lineWidth: 2,
        });
        drawingUtils.drawLandmarks(poseLandmarks, { color: colors.landmark, radius: 4 });
      });
    };

    drawPose(landmarks, poseColors);
  }, [landmarks, poseColors]);

  useEffect(() => {
    if (status === 'completed' && recordedFrames.length > 0) {
      const metrics = calculateSwingMetrics(recordedFrames);
      const video = videoRef.current;
      setSwingVideoSize(
        video && video.videoWidth > 0 && video.videoHeight > 0
          ? { width: video.videoWidth, height: video.videoHeight }
          : null,
      );
      setLastSwing(metrics ?? null);
      setCoachText('');
      setCoachError(null);
      setCoachContext('');
      setFindingCorrections({});
      setFindingPriorityOverrides({});
      setDemoFrames(null);
      setCoachConsumedForCapture(false);
    }
  }, [status, recordedFrames]);

  useEffect(() => {
    const stopSwingVideoRecording = (keepVideo: boolean) => {
      const recorder = swingRecorderRef.current;
      keepSwingVideoOnStopRef.current = keepVideo;
      if (keepVideo) {
        const firstPoseTimestamp =
          recordedFrames[0]?.timestamp ?? recordedFramesRef.current[0]?.timestamp;
        const recordingStartTimestamp = videoRecordingStartTimestampRef.current;
        swingVideoClipStartSecondsRef.current =
          firstPoseTimestamp != null && recordingStartTimestamp != null
            ? Math.max(
                0,
                (firstPoseTimestamp - recordingStartTimestamp) / 1000 - SWING_VIDEO_LEAD_IN_SECONDS,
              )
            : 0;
      } else {
        swingVideoClipStartSecondsRef.current = 0;
      }
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      swingRecorderRef.current = null;
    };

    const shouldRecordVideo =
      status === 'armed_waiting_still' || status === 'armed_waiting_motion' || status === 'recording';
    if (!shouldRecordVideo) {
      stopSwingVideoRecording(status === 'completed');
      return;
    }
    if (swingRecorderRef.current) return;

    const stream = videoRef.current?.srcObject;
    const recordingStartTimestamp = frameData?.timestamp ?? null;
    if (!(stream instanceof MediaStream) || !window.MediaRecorder || recordingStartTimestamp == null) {
      return;
    }

    try {
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      swingVideoChunksRef.current = [];
      videoRecordingStartTimestampRef.current = recordingStartTimestamp;
      keepSwingVideoOnStopRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          swingVideoChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        if (keepSwingVideoOnStopRef.current && swingVideoChunksRef.current.length > 0) {
          const blob = new Blob(swingVideoChunksRef.current, {
            type: recorder.mimeType || 'video/webm',
          });
          const nextUrl = URL.createObjectURL(blob);
          setSwingVideoUrl((previousUrl) => {
            if (previousUrl) URL.revokeObjectURL(previousUrl);
            swingVideoUrlRef.current = nextUrl;
            return nextUrl;
          });
          setSwingVideoClipStartSeconds(swingVideoClipStartSecondsRef.current);
        }
        swingVideoChunksRef.current = [];
      };
      swingRecorderRef.current = recorder;
      recorder.start(100);
    } catch {
      swingRecorderRef.current = null;
      swingVideoChunksRef.current = [];
    }
  }, [status, frameData?.timestamp, recordedFrames]);

  useEffect(() => {
    return () => {
      const recorder = swingRecorderRef.current;
      keepSwingVideoOnStopRef.current = false;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      if (swingVideoUrlRef.current) {
        URL.revokeObjectURL(swingVideoUrlRef.current);
        swingVideoUrlRef.current = null;
      }
    };
  }, []);

  async function requestGeminiCoach() {
    if (!lastSwing || coachConsumedForCapture || coachLoading) return;
    setCoachConsumedForCapture(true);
    setCoachLoading(true);
    setCoachError(null);
    setCoachText('');
    try {
      const res = await fetch('/api/swing/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          swing: lastSwing,
          findings: coachFindings,
          userContext: coachContext.trim(),
          corrections: Object.fromEntries(
            Object.entries(findingCorrections)
              .map(([key, value]) => [key, value.trim()])
              .filter(([, value]) => value.length > 0),
          ),
          priorityOverrides: findingPriorityOverrides,
        }),
      });
      if (!res.ok) {
        const raw = await res.text();
        try {
          const data = JSON.parse(raw) as { error?: string };
          setCoachError(data.error ?? (raw || res.statusText));
        } catch {
          setCoachError(raw || res.statusText);
        }
        return;
      }
      if (!res.body) {
        setCoachError('No response body from coach API');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setCoachText(accumulated);
      }
      accumulated += decoder.decode();
      if (accumulated.length > 0) {
        setCoachText(accumulated);
      }
      if (!accumulated.trim()) {
        setCoachError('Empty response from coach API');
      }
    } catch (e) {
      setCoachError(e instanceof Error ? e.message : String(e));
    } finally {
      setCoachLoading(false);
    }
  }

  const buttonLabel =
    status === 'armed_waiting_still'
      ? fullBodyFramed
        ? 'Hold still…'
        : 'Adjust position — full body in frame'
      : status === 'armed_waiting_motion'
        ? 'Swing when ready…'
        : status === 'recording'
          ? 'Recording…'
          : cameraStartPending
            ? 'Starting camera…'
            : !isModelReady
              ? 'Loading pose model…'
              : 'Arm recording';

  function handlePrimaryClick() {
    if (isArmed || isRecording) {
      cancel();
      return;
    }
    void (async () => {
      if (cameraStartPending || !isModelReady) return;
      try {
        setCameraStartPending(true);
        setSwingVideoUrl((previousUrl) => {
          if (previousUrl) URL.revokeObjectURL(previousUrl);
          swingVideoUrlRef.current = null;
          return null;
        });
        setSwingVideoClipStartSeconds(0);
        setSwingVideoSize(null);
        setDemoFrames(null);
        setCoachContext('');
        setFindingCorrections({});
        setFindingPriorityOverrides({});
        await startCamera();
        arm();
      } catch {
        /* cameraError set in usePoseDetection */
      } finally {
        setCameraStartPending(false);
      }
    })();
  }

  function loadDemoSwing() {
    const frames = createDemoSwingFrames();
    const metrics = calculateSwingMetrics(frames);
    setDemoFrames(frames);
    setLastSwing(metrics ?? null);
    setSwingVideoUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      swingVideoUrlRef.current = null;
      return null;
    });
    setSwingVideoClipStartSeconds(0);
    setSwingVideoSize(null);
    setCoachText('');
    setCoachError(null);
    setCoachContext('');
    setFindingCorrections({});
    setFindingPriorityOverrides({});
    setCoachConsumedForCapture(false);
  }

  const durationSec =
    lastSwing != null && lastSwing.metadata.durationMs != null
      ? (lastSwing.metadata.durationMs / 1000).toFixed(2)
      : null;
  const handednessLabel =
    lastSwing?.metadata.handedness === 'right'
      ? 'Right-handed'
      : lastSwing?.metadata.handedness === 'left'
        ? 'Left-handed'
        : null;

  return (
    <div className="w-full space-y-5 leading-normal">
      {cameraError ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/40 sm:px-5"
          role="status"
        >
          <p className="text-sm text-amber-950 dark:text-amber-100">{cameraError}</p>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl bg-zinc-950 shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-800">
        {/*
          Video must be display:block — inline <video> leaves a baseline gap under the frame; the
          absolute canvas then fills that extra height and landmarks (normalized to video pixels)
          scale down, looking vertically offset from the picture.
        */}
        <div className="relative">
          <video
            ref={videoRef}
            playsInline
            muted
            className="block h-auto w-full rounded-none"
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute left-0 top-0 block h-full w-full"
          />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40 sm:px-5 sm:py-4">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{statusMessage}</p>
        {frameHint ? (
          <p
            className={`mt-1 text-sm ${
              status === 'armed_waiting_still' && !fullBodyFramed
                ? 'text-amber-800 dark:text-amber-200'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {frameHint}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          disabled={
            cameraStartPending || (status === 'idle' && !isModelReady)
          }
          className={`inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 sm:w-auto ${btnFocus}`}
          onClick={handlePrimaryClick}
        >
          {buttonLabel}
        </button>
        <button
          type="button"
          disabled={isArmed || isRecording}
          className={`inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:w-auto ${btnFocus}`}
          onClick={loadDemoSwing}
        >
          Load demo swing
        </button>
      </div>

      {lastSwing ? (
        <section
          className="rounded-xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/40 sm:px-5"
          aria-label="Last capture summary"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Last capture
          </h3>
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {durationSec ? (
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Duration</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-100">{durationSec}s</dd>
              </div>
            ) : null}
            {handednessLabel ? (
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Stance</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-100">{handednessLabel}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {lastSwing ? (
        <SwingReplayComparison
          key={`${displayFrames[0]?.timestamp ?? 'last-swing'}:${swingVideoUrl ?? 'pose'}:${swingVideoClipStartSeconds.toFixed(3)}`}
          frames={displayFrames}
          swingVideoUrl={swingVideoUrl}
          swingVideoClipStartSeconds={swingVideoClipStartSeconds}
          swingVideoSize={swingVideoSize}
          topTimeMs={lastSwing.sequencing.timing.absolute.topMs}
          impactTimeMs={lastSwing.sequencing.timing.absolute.impactMs}
          impactVideoLeadInSeconds={SWING_VIDEO_LEAD_IN_SECONDS}
        />
      ) : null}

      {lastSwing ? (
        <section
          className="rounded-xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/40 sm:px-5"
          aria-label="Measured swing findings"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            What we measured
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Tap a result to see details or correct anything that does not match what you felt.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {coachFindings.map((finding) => (
              <button
                type="button"
                key={finding.id}
                aria-pressed={selectedFinding?.id === finding.id}
                onClick={() => setSelectedFindingId(finding.id)}
                className={`min-h-14 rounded-lg border px-3 py-2 text-left shadow-sm transition-colors ${findingChipClasses(
                  finding,
                  selectedFinding?.id === finding.id,
                )}`}
              >
                <span className="flex items-center gap-2 text-xs font-medium opacity-75">
                  {finding.label}
                  {findingCorrections[finding.id]?.trim() ? (
                    <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-100">
                      edited
                    </span>
                  ) : null}
                  {findingPriorityOverrides[finding.id] ? (
                    <span className="rounded-full bg-zinc-900/10 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-white/15">
                      {coachPriorityLabel(finding.priority)}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-sm font-semibold">
                  {findingVerdict(finding)}
                </span>
                <span className="mt-0.5 block text-xs opacity-70">
                  {findingPrimaryResult(finding)}
                </span>
              </button>
            ))}
          </div>

          {selectedFinding ? (
            <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {selectedFinding.label}
                    </h4>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${findingStatusClasses(
                        selectedFinding.status,
                      )}`}
                    >
                      {findingStatusLabel(selectedFinding.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
                    {selectedFinding.summary}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {selectedFinding.detail}
                  </p>
                </div>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Priority {selectedFinding.priority}/5
                </p>
              </div>

              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {selectedFinding.metrics.map((item) => (
                  <div key={item.key} className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-950/50">
                    <dt className="text-zinc-500 dark:text-zinc-400">{item.label}</dt>
                    <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">
                      {item.displayValue}
                    </dd>
                  </div>
                ))}
              </dl>

              {selectedFinding.caveat ? (
                <p className="mt-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {selectedFinding.caveat}
                </p>
              ) : null}

              <div className="mt-3 max-w-sm">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor={`priority-${selectedFinding.id}`}
                    className="text-xs font-medium text-zinc-600 dark:text-zinc-300"
                  >
                    Coach priority
                  </label>
                  {findingPriorityOverrides[selectedFinding.id] != null ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:decoration-zinc-600 dark:hover:text-zinc-100"
                      onClick={() =>
                        setFindingPriorityOverrides((current) => {
                          const next = { ...current };
                          delete next[selectedFinding.id];
                          return next;
                        })
                      }
                    >
                      Reset to {selectedSystemPriority}/5
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      System default {selectedSystemPriority}/5
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    id={`priority-${selectedFinding.id}`}
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={selectedFinding.priority}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      setFindingPriorityOverrides((current) => ({
                        ...current,
                        [selectedFinding.id]: nextValue,
                      }));
                    }}
                    className="h-10 flex-1 accent-zinc-900 dark:accent-zinc-100"
                  />
                  <input
                    type="number"
                    min="1"
                    max="5"
                    step="1"
                    value={selectedFinding.priority}
                    aria-label={`${selectedFinding.label} coach priority`}
                    onChange={(event) => {
                      const nextValue = Math.min(5, Math.max(1, Number(event.target.value) || 1));
                      setFindingPriorityOverrides((current) => ({
                        ...current,
                        [selectedFinding.id]: nextValue,
                      }));
                    }}
                    className="min-h-10 w-16 rounded-lg border border-zinc-300 bg-white px-2 text-center text-sm font-semibold text-zinc-900 shadow-sm outline-none transition-colors focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400"
                  />
                </div>
              </div>

              <label className="mt-3 block">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Correct or add context
                </span>
                <textarea
                  value={findingCorrections[selectedFinding.id] ?? ''}
                  onChange={(event) =>
                    setFindingCorrections((current) => ({
                      ...current,
                      [selectedFinding.id]: event.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Example: I felt too steep, or this one looks right."
                  className="mt-1 block w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400"
                />
              </label>
            </div>
          ) : null}

          <label className="mt-4 block">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              What are you struggling with?
            </span>
            <textarea
              value={coachContext}
              onChange={(event) => setCoachContext(event.target.value)}
              rows={3}
              placeholder="Example: slicing driver, thin contact, losing balance, inconsistent start line."
              className="mt-2 block w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-400"
            />
          </label>
        </section>
      ) : null}

      {lastSwing ? (
        <section className="rounded-xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/40 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                AI coach
              </h3>
              <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                Use your measured findings and any corrections above to get drills and a next-swing focus.
              </p>
            </div>
            <button
              type="button"
              disabled={coachLoading || coachConsumedForCapture}
              title={
                coachConsumedForCapture && !coachLoading
                  ? 'Coach already ran for this capture. Arm recording and take another swing to use Coach again.'
                  : undefined
              }
              className={`inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:w-auto ${btnFocus}`}
              onClick={() => void requestGeminiCoach()}
            >
              {coachLoading
                ? 'Coach is responding…'
                : coachConsumedForCapture
                  ? 'Coach already used'
                  : 'Coach with AI'}
            </button>
          </div>

          {coachError ? (
            <div
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/40"
              role="alert"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">
                Error
              </p>
              <p className="mt-2 text-sm text-red-900 dark:text-red-100">{coachError}</p>
            </div>
          ) : null}

          {coachLoading || coachText ? (
            <div className="relative mt-4 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
              {coachText ? (
                <CoachMarkdown>{coachText}</CoachMarkdown>
              ) : (
                <p className="text-zinc-500 dark:text-zinc-400">Waiting for the first words…</p>
              )}
              {coachLoading ? (
                <span
                  className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-zinc-400 align-[-0.15em] dark:bg-zinc-500"
                  aria-hidden
                />
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
