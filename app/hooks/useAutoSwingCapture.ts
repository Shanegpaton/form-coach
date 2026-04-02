import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameData } from './usePoseDetection';
import type { Keypoints } from './useSwingRecorder';

type AutoSwingStatus =
  | 'idle'
  | 'armed_waiting_still'
  | 'armed_waiting_motion'
  | 'recording'
  | 'completed';

type UseAutoSwingCaptureResult = {
  status: AutoSwingStatus;
  isRecording: boolean;
  isArmed: boolean;
  recordedFrames: Keypoints[];
  arm: () => void;
  cancel: () => void;
  reset: () => void;
};

// Heuristic defaults for normalized MediaPipe coords.
const STILLNESS_WINDOW_MS = 1000;
const STILL_SPEED_THRESHOLD = 0.0015; // normalized units per ms
const MOTION_SPEED_THRESHOLD = 0.001; // normalized units per ms
const MOTION_CONFIRM_FRAMES = 5;
const RISE_CONFIRM_FRAMES = 6;
const MIN_RECORDING_MS = 250;

type Point2D = { x: number; y: number };

function toKeypoints(frameData: FrameData): Keypoints {
  const j = frameData.joints;
  const joint = (idx: number) =>
    j[idx] != null && j[idx].visibility != null && j[idx].visibility > 0.5 ? (j[idx] as any) : null;

  return {
    timestamp: frameData.timestamp,
    rightEar: joint(8),
    leftShoulder: joint(11),
    rightShoulder: joint(12),
    leftElbow: joint(13),
    rightElbow: joint(14),
    leftWrist: joint(15),
    rightWrist: joint(16),
    leftHip: joint(23),
    rightHip: joint(24),
    leftKnee: joint(25),
    rightKnee: joint(26),
    leftAnkle: joint(27),
    rightAnkle: joint(28),
  };
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function motionPoint(f: Keypoints): Point2D | null {
  // Prefer left wrist; fallback to shoulder midpoint; then hip midpoint.
  if (f.leftWrist) return { x: f.leftWrist.x, y: f.leftWrist.y };
  if (f.leftShoulder && f.rightShoulder) return midpoint(f.leftShoulder, f.rightShoulder);
  if (f.leftHip && f.rightHip) return midpoint(f.leftHip, f.rightHip);
  return null;
}

function speedBetween(prev: { t: number; p: Point2D }, curr: { t: number; p: Point2D }): number | null {
  const dt = curr.t - prev.t;
  if (!Number.isFinite(dt) || dt <= 0) return null;
  const d = Math.hypot(curr.p.x - prev.p.x, curr.p.y - prev.p.y);
  if (!Number.isFinite(d)) return null;
  return d / dt;
}

/**
 * Auto-capture flow:
 * - user clicks Arm
 * - wait for ~1s of stillness (low motion)
 * - once still, wait for consistent motion to start recording
 * - stop when left wrist has passed its lowest point and is rising consistently (post-impact follow-through proxy)
 */
export function useAutoSwingCapture(frameData: FrameData | null): UseAutoSwingCaptureResult {
  const [status, setStatus] = useState<AutoSwingStatus>('idle');
  const [recordedFrames, setRecordedFrames] = useState<Keypoints[]>([]);

  const isArmed = status === 'armed_waiting_still' || status === 'armed_waiting_motion';
  const isRecording = status === 'recording';

  const recordedRef = useRef<Keypoints[]>([]);
  const lastMotionSampleRef = useRef<{ t: number; p: Point2D } | null>(null);
  const latestKeypointsRef = useRef<Keypoints | null>(null);

  const stillStartRef = useRef<number | null>(null);
  const motionConfirmRef = useRef<number>(0);

  const recordStartTsRef = useRef<number | null>(null);
  const minWristYRef = useRef<number | null>(null);
  const riseConfirmRef = useRef<number>(0);

  useEffect(() => {
    if (!frameData) return;
    latestKeypointsRef.current = toKeypoints(frameData);
  }, [frameData]);

  useEffect(() => {
    if (status === 'idle' || status === 'completed') return;

    let rafId = 0;

    const tick = () => {
      const kp = latestKeypointsRef.current;
      if (!kp) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const mp = motionPoint(kp);
      if (!mp) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const curr = { t: kp.timestamp, p: mp };
      const prev = lastMotionSampleRef.current;
      lastMotionSampleRef.current = curr;

      const speed = prev ? speedBetween(prev, curr) : null;

      if (status === 'armed_waiting_still') {
        if (speed != null) {
          const isStillNow = speed < STILL_SPEED_THRESHOLD;
          if (isStillNow) {
            if (stillStartRef.current == null) stillStartRef.current = kp.timestamp;
            const stillForMs = kp.timestamp - stillStartRef.current;
            if (stillForMs >= STILLNESS_WINDOW_MS) {
              motionConfirmRef.current = 0;
              setStatus('armed_waiting_motion');
            }
          } else {
            stillStartRef.current = null;
          }
        }
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (status === 'armed_waiting_motion') {
        if (speed != null) {
          const isMoving = speed > MOTION_SPEED_THRESHOLD;
          motionConfirmRef.current = isMoving ? motionConfirmRef.current + 1 : 0;
          if (motionConfirmRef.current >= MOTION_CONFIRM_FRAMES) {
            recordedRef.current = [];
            recordStartTsRef.current = kp.timestamp;
            minWristYRef.current = kp.leftWrist?.y ?? null;
            riseConfirmRef.current = 0;
            recordedRef.current.push(kp);
            setStatus('recording');
            rafId = requestAnimationFrame(tick);
            return;
          }
        }
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (status === 'recording') {
        recordedRef.current.push(kp);

        const startTs = recordStartTsRef.current;
        if (startTs != null && kp.timestamp - startTs >= MIN_RECORDING_MS) {
          const wy = kp.leftWrist?.y;
          if (wy != null && Number.isFinite(wy)) {
            if (minWristYRef.current == null || wy < minWristYRef.current) {
              minWristYRef.current = wy;
              riseConfirmRef.current = 0;
            } else {
              const minY = minWristYRef.current;
              const risingFromLow = wy > minY + 0.002;
              riseConfirmRef.current = risingFromLow ? riseConfirmRef.current + 1 : 0;
              if (riseConfirmRef.current >= RISE_CONFIRM_FRAMES) {
                setRecordedFrames(recordedRef.current);
                setStatus('completed');
                return;
              }
            }
          }
        }

        rafId = requestAnimationFrame(tick);
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [status]);

  const arm = useCallback(() => {
    recordedRef.current = [];
    setRecordedFrames([]);
    lastMotionSampleRef.current = null;
    stillStartRef.current = null;
    motionConfirmRef.current = 0;
    recordStartTsRef.current = null;
    minWristYRef.current = null;
    riseConfirmRef.current = 0;
    setStatus('armed_waiting_still');
  }, []);

  const cancel = useCallback(() => {
    recordedRef.current = [];
    setRecordedFrames([]);
    lastMotionSampleRef.current = null;
    stillStartRef.current = null;
    motionConfirmRef.current = 0;
    recordStartTsRef.current = null;
    minWristYRef.current = null;
    riseConfirmRef.current = 0;
    setStatus('idle');
  }, []);

  const reset = useCallback(() => {
    cancel();
  }, [cancel]);

  return { status, isRecording, isArmed, recordedFrames, arm, cancel, reset };
}

