'use client';
import { useEffect, useRef } from 'react';
import {
  DrawingUtils,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { usePoseDetection } from '../hooks/usePoseDetection';
import { useSwingRecorder } from '../hooks/useSwingRecorder';
import { calculateSwingMetrics } from '../lib/swing/calculateSwingMetrics';

export default function CameraStream() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { landmarks, frameData } = usePoseDetection(videoRef);
  const { startRecording, stopRecording, isRecording, resetRecording, recordedFrames } = useSwingRecorder(frameData);

  useEffect(() => {
    const drawPose = (landmarksByPose: NormalizedLandmark[][]) => {
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
          color: '#00b4ff',
          lineWidth: 2,
        });
        drawingUtils.drawLandmarks(poseLandmarks, { color: '#00ff88', radius: 4 });
      });
    };

    drawPose(landmarks);
  }, [landmarks]);

  useEffect(() => {
    if (!isRecording && recordedFrames.length > 0) {
      const metrics = calculateSwingMetrics(recordedFrames);
      console.log(metrics);
    }
  }, [isRecording]);


  return (
    <div className="relative w-full max-w-2xl">
      <video ref={videoRef} autoPlay playsInline className="h-auto w-full rounded-md" />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <button className="bg-blue-500 text-white px-4 py-2 rounded-md" onClick={isRecording ? stopRecording : startRecording}>
            Record
        </button>
    </div>
    
  );
}
