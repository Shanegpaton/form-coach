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

export default function CameraStream() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { landmarks, frameData } = usePoseDetection(videoRef);
  const { status, isArmed, isRecording, fullBodyFramed, recordedFrames, arm, cancel } =
    useAutoSwingCapture(frameData);

  const poseColors = useMemo(() => getPoseColors(status, fullBodyFramed), [status, fullBodyFramed]);

  const [lastSwing, setLastSwing] = useState<SwingAnalysis | null>(null);
  const [coachText, setCoachText] = useState<string | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);

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
      console.log(metrics);
      setLastSwing(metrics ?? null);
      setCoachText(null);
      setCoachError(null);
    }
  }, [status, recordedFrames]);

  async function requestGeminiCoach() {
    if (!lastSwing) return;
    setCoachLoading(true);
    setCoachError(null);
    setCoachText(null);
    try {
      const res = await fetch('/api/swing/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swing: lastSwing }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) {
        setCoachError(data.error ?? res.statusText);
        return;
      }
      if (data.text) {setCoachText(data.text); console.log(data.text);}
      else setCoachError('Empty response from coach API');
    } catch (e) {
      setCoachError(e instanceof Error ? e.message : String(e));
    } finally {
      setCoachLoading(false);
    }
  }

  const buttonLabel =
    status === 'armed_waiting_still'
      ? fullBodyFramed
        ? 'Get still...'
        : 'Step back — full body in frame'
      : status === 'armed_waiting_motion'
        ? 'Swing when ready...'
        : status === 'recording'
          ? 'Recording...'
          : 'Arm recording';


  return (
    <div className="relative w-full max-w-2xl leading-none">
      {/*
        Video must be display:block — inline <video> leaves a baseline gap under the frame; the
        absolute canvas then fills that extra height and landmarks (normalized to video pixels)
        scale down, looking vertically offset from the picture.
      */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="block h-auto w-full rounded-md"
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute left-0 top-0 block h-full w-full rounded-md"
      />
      <div className="mt-4 flex items-center gap-2">
        <button className="bg-blue-500 text-white px-4 py-2 rounded-md" onClick={isArmed || isRecording ? cancel : arm}>
          {buttonLabel}
        </button>
        <div className="text-sm text-zinc-600">
          {status === 'armed_waiting_still' && !fullBodyFramed ? (
            <span className="text-amber-700">Show head through ankles in frame.</span>
          ) : recordedFrames.length > 0 ? (
            `Frames: ${recordedFrames.length}`
          ) : null}
        </div>
        {lastSwing ? (
          <button
            type="button"
            disabled={coachLoading}
            className="rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void requestGeminiCoach()}
          >
            {coachLoading ? 'Asking Gemini…' : 'Coach with AI (Gemini)'}
          </button>
        ) : null}
      </div>
      {coachError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{coachError}</p>
      ) : null}
      {coachText ? (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-800 whitespace-pre-wrap">
          {coachText}
        </div>
      ) : null}
    </div>
    
  );
}
