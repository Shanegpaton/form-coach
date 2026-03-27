import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameData } from './usePoseDetection';

type UseSwingRecorderResult = {
  recordedFrames: Keypoints[];
  isRecording: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  resetRecording: () => void;
};

type Joint = {
  x: number;
  y: number;
  z: number;
  visibility: number;
};

type Keypoints = {
  timestamp: number;
  leftShoulder: Joint | null;
  rightShoulder: Joint | null;
  leftElbow: Joint | null;
  rightElbow: Joint | null;
  leftWrist: Joint | null;
  rightWrist: Joint | null;
  leftHip: Joint | null;
  rightHip: Joint | null;
};

function extractKeypoints(frameData) {
  return {
    timestamp: frameData.timestamp,
    leftShoulder:
      frameData.joints[11].visibility != null && frameData.joints[11].visibility > 0.5
        ? frameData.joints[11]
        : null,
    rightShoulder:
      frameData.joints[12].visibility != null && frameData.joints[12].visibility > 0.5
        ? frameData.joints[12]
        : null,
    leftElbow:
      frameData.joints[13].visibility != null && frameData.joints[13].visibility > 0.5
        ? frameData.joints[13]
        : null,
    rightElbow:
      frameData.joints[14].visibility != null && frameData.joints[14].visibility > 0.5
        ? frameData.joints[14]
        : null,
    leftWrist:
      frameData.joints[15].visibility != null && frameData.joints[15].visibility > 0.5
        ? frameData.joints[15]
        : null,
    rightWrist:
      frameData.joints[16].visibility != null && frameData.joints[16].visibility > 0.5
        ? frameData.joints[16]
        : null,
    leftHip:
      frameData.joints[23].visibility != null && frameData.joints[23].visibility > 0.5
        ? frameData.joints[23]
        : null,
    rightHip:
      frameData.joints[24].visibility != null && frameData.joints[24].visibility > 0.5
        ? frameData.joints[24]
        : null,
    leftKnee: frameData.joints[25].visibility != null && frameData.joints[25].visibility > 0.5
        ? frameData.joints[25]
        : null,
    rightKnee: frameData.joints[26].visibility != null && frameData.joints[26].visibility > 0.5
        ? frameData.joints[26]
        : null,
    leftAnkle: frameData.joints[27].visibility != null && frameData.joints[27].visibility > 0.5
        ? frameData.joints[27]
        : null,
    rightAnkle: frameData.joints[28].visibility != null && frameData.joints[28].visibility > 0.5
        ? frameData.joints[28]
        : null,
  };
}

export function useSwingRecorder(frameData: FrameData | null): UseSwingRecorderResult {
  const [recordedFrames, setRecordedFrames] = useState<Keypoints[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const recordedFramesRef = useRef<Keypoints[]>([]);

  useEffect(() => {
    if (!isRecording || !frameData) return;
    const keyPoints = extractKeypoints(frameData);
    recordedFramesRef.current.push(keyPoints);
  }, [frameData, isRecording]);

  const startRecording = useCallback(() => {
    recordedFramesRef.current = [];
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setRecordedFrames(recordedFramesRef.current);
  }, []);

  const resetRecording = useCallback(() => {
    recordedFramesRef.current = [];
    setRecordedFrames([]);
    setIsRecording(false);
  }, []);

  return {
    recordedFrames,
    isRecording,
    startRecording,
    stopRecording,
    resetRecording,
  };
}
