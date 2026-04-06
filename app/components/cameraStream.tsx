'use client';
import { useEffect, useMemo, useRef } from 'react';
import {
  DrawingUtils,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { usePoseDetection } from '../hooks/usePoseDetection';
import { calculateSwingMetrics } from '../lib/swing/calculateSwingMetrics';
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

  useEffect(() => {
    const drawPose = (landmarksByPose: NormalizedLandmark[][], colors: PoseColors) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
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
    }
  }, [status, recordedFrames]);

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
    <div className="relative w-full max-w-2xl">
      <video ref={videoRef} autoPlay playsInline className="h-auto w-full rounded-md" />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
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
      </div>
    </div>
    
  );
}
