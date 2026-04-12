'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DrawingUtils,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { usePoseDetection } from '../hooks/usePoseDetection';
import { calculateSwingMetrics, type SwingAnalysis } from '../lib/swing/calculateSwingMetrics';
import { useAutoSwingCapture } from '../hooks/useAutoSwingCapture';
import { CoachMarkdown } from './CoachMarkdown';

type PoseColors = { landmark: string; connector: string };

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

export default function CameraStream() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { landmarks, frameData, startCamera, cameraError, hasCamera, isModelReady } =
    usePoseDetection(videoRef);
  const { status, isArmed, isRecording, fullBodyFramed, recordedFrames, arm, cancel } =
    useAutoSwingCapture(frameData);

  const poseColors = useMemo(() => getPoseColors(status, fullBodyFramed), [status, fullBodyFramed]);

  const [lastSwing, setLastSwing] = useState<SwingAnalysis | null>(null);
  const [coachText, setCoachText] = useState<string>('');
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [cameraStartPending, setCameraStartPending] = useState(false);

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
        ? 'Swing captured. Review the summary below or ask the coach.'
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
      setLastSwing(metrics ?? null);
      setCoachText('');
      setCoachError(null);
    }
  }, [status, recordedFrames]);

  async function requestGeminiCoach() {
    if (!lastSwing) return;
    setCoachLoading(true);
    setCoachError(null);
    setCoachText('');
    try {
      const res = await fetch('/api/swing/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swing: lastSwing }),
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
        await startCamera();
        arm();
      } catch {
        /* cameraError set in usePoseDetection */
      } finally {
        setCameraStartPending(false);
      }
    })();
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
        {lastSwing ? (
          <button
            type="button"
            disabled={coachLoading}
            className={`inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:w-auto ${btnFocus}`}
            onClick={() => void requestGeminiCoach()}
          >
            {coachLoading ? 'Coach is responding…' : 'Coach with AI'}
          </button>
        ) : null}
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

      {coachError ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/40 sm:px-5"
          role="alert"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">
            Error
          </p>
          <p className="mt-2 text-sm text-red-900 dark:text-red-100">{coachError}</p>
        </div>
      ) : null}

      {coachLoading || coachText ? (
        <section className="rounded-xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/40 sm:px-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Coach feedback
          </h3>
          <div className="relative mt-3 text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
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
        </section>
      ) : null}
    </div>
  );
}
