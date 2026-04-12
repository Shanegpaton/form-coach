import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameData } from './usePoseDetection';
import type { Joint, Keypoints } from './useSwingRecorder';

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
  /** During "get still": true only when all swing key landmarks are visible and inside the frame. */
  fullBodyFramed: boolean;
  recordedFrames: Keypoints[];
  arm: () => void;
  cancel: () => void;
  reset: () => void;
};

// Heuristic defaults for normalized MediaPipe coords.
const STILLNESS_WINDOW_MS = 1000;
const STILL_SPEED_THRESHOLD = 0.00009; // normalized units per ms
const MOTION_SPEED_THRESHOLD = 0.0002; // normalized units per ms
const MOTION_CONFIRM_FRAMES = 5;
const RISE_CONFIRM_FRAMES = 3;
const MIN_RECORDING_MS = 50;
/** In normalized coords, y grows downward. Min y = top of backswing; must drop this much before we treat "deep" + follow-through. */
const DROP_FROM_APEX_Y = 0.055;
/** Wrist moving up on screen (y decreasing) after deepest point of arc. */
const RISE_FROM_DEEP_EPS = 0.004;
/** Allow tiny overshoot outside 0–1 normalized image bounds. */
const FRAME_PAD = 0.03;

type Point2D = { x: number; y: number };

function jointInNormalizedFrame(j: Joint): boolean {
  return (
    j.x >= -FRAME_PAD &&
    j.x <= 1 + FRAME_PAD &&
    j.y >= -FRAME_PAD &&
    j.y <= 1 + FRAME_PAD &&
    Number.isFinite(j.x) &&
    Number.isFinite(j.y)
  );
}

/**
 * Same key landmarks as Keypoints / swing pipeline: head (ear) through ankles.
 * All must be present (visibility already gated in toKeypoints) and inside the image.
 */
export function allSwingKeypointsFramed(kp: Keypoints): boolean {
  const joints: (Joint | null)[] = [
    kp.rightEar,
    kp.rightShoulder,
    kp.rightElbow,
    kp.rightWrist,
    kp.rightHip,
    kp.rightKnee,
    kp.rightAnkle,
  ];
  for (const j of joints) {
    if (!j || !jointInNormalizedFrame(j)) return false;
  }
  return true;
}


export function toKeypoints(frameData: FrameData): Keypoints {
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

/** For UI: framing check from raw pose frame. */
export function checkSwingFramingForStill(frameData: FrameData | null): boolean {
  if (!frameData) return false;
  return allSwingKeypointsFramed(toKeypoints(frameData));
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
 * - stop when left wrist has passed the bottom of the arc (max y) and is rising on screen (y decreasing) — post-impact proxy
 */
export function useAutoSwingCapture(frameData: FrameData | null): UseAutoSwingCaptureResult {
  const [status, setStatus] = useState<AutoSwingStatus>('idle');
  const [recordedFrames, setRecordedFrames] = useState<Keypoints[]>([]);
  const [fullBodyFramed, setFullBodyFramed] = useState(true);

  const isArmed = status === 'armed_waiting_still' || status === 'armed_waiting_motion';
  const isRecording = status === 'recording';

  const recordedRef = useRef<Keypoints[]>([]);
  const lastMotionSampleRef = useRef<{ t: number; p: Point2D } | null>(null);
  const latestKeypointsRef = useRef<Keypoints | null>(null);
  const fullBodyFramedRef = useRef(true);

  const stillStartRef = useRef<number | null>(null);
  const motionConfirmRef = useRef<number>(0);

  const recordStartTsRef = useRef<number | null>(null);
  /** Smallest y so far = hands highest on screen (backswing apex). */
  const apexYRef = useRef<number | null>(null);
  /** True once wrist has moved down from apex enough (downswing has started). */
  const hasExitedApexRef = useRef(false);
  /** Largest y since exiting apex = hands lowest on screen (through impact). */
  const deepYRef = useRef<number | null>(null);
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
        const framed = allSwingKeypointsFramed(kp);
        if (framed !== fullBodyFramedRef.current) {
          fullBodyFramedRef.current = framed;
          setFullBodyFramed(framed);
        }
        if (!framed) {
          stillStartRef.current = null;
          lastMotionSampleRef.current = null;
          rafId = requestAnimationFrame(tick);
          return;
        }

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
            apexYRef.current = kp.leftWrist?.y ?? null;
            hasExitedApexRef.current = false;
            deepYRef.current = null;
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
            const apex = apexYRef.current;
            if (apex == null) apexYRef.current = wy;
            else if (wy < apex) apexYRef.current = wy;

            const apexNow = apexYRef.current;
            if (!hasExitedApexRef.current && apexNow != null && wy > apexNow + DROP_FROM_APEX_Y) {
              hasExitedApexRef.current = true;
              deepYRef.current = wy;
            }

            if (hasExitedApexRef.current) {
              const deep = deepYRef.current;
              if (deep == null) deepYRef.current = wy;
              else deepYRef.current = Math.max(deep, wy);

              const deepNow = deepYRef.current;
              const risingOnScreen = wy < deepNow - RISE_FROM_DEEP_EPS;
              riseConfirmRef.current = risingOnScreen ? riseConfirmRef.current + 1 : 0;
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
    fullBodyFramedRef.current = true;
    setFullBodyFramed(true);
    lastMotionSampleRef.current = null;
    stillStartRef.current = null;
    motionConfirmRef.current = 0;
    recordStartTsRef.current = null;
    apexYRef.current = null;
    hasExitedApexRef.current = false;
    deepYRef.current = null;
    riseConfirmRef.current = 0;
    setStatus('armed_waiting_still');
  }, []);

  const cancel = useCallback(() => {
    recordedRef.current = [];
    setRecordedFrames([]);
    fullBodyFramedRef.current = true;
    setFullBodyFramed(true);
    lastMotionSampleRef.current = null;
    stillStartRef.current = null;
    motionConfirmRef.current = 0;
    recordStartTsRef.current = null;
    apexYRef.current = null;
    hasExitedApexRef.current = false;
    deepYRef.current = null;
    riseConfirmRef.current = 0;
    setStatus('idle');
  }, []);

  const reset = useCallback(() => {
    cancel();
  }, [cancel]);

  return {
    status,
    isRecording,
    isArmed,
    fullBodyFramed: status === 'armed_waiting_still' ? fullBodyFramed : true,
    recordedFrames,
    arm,
    cancel,
    reset,
  };
}

