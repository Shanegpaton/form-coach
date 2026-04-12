import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

type JointCoordinate = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type FrameData = {
  timestamp: number;
  joints: JointCoordinate[];
};

function humanMediaError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
      return 'Camera access was blocked. Allow the camera in your browser or site settings, then tap Arm recording again.';
    }
    if (e.name === 'NotFoundError') {
      return 'No camera was found on this device.';
    }
    return e.message || 'Could not open the camera.';
  }
  if (e instanceof Error) return e.message;
  return 'Could not open the camera.';
}

type UsePoseDetectionResult = {
  landmarks: NormalizedLandmark[][];
  frameData: FrameData | null;
  /** True once the model is loaded and the camera stream is running and detection has started. */
  isReady: boolean;
  /** Pose model (WASM) finished loading; camera may still be off until startCamera(). */
  isModelReady: boolean;
  /** User has granted camera and stream is attached. */
  hasCamera: boolean;
  cameraError: string | null;
  /** Call from a button tap (user gesture) so phones show the permission prompt. Safe to call again if permission was denied. */
  startCamera: () => Promise<void>;
};

export function usePoseDetection(
  videoRef: RefObject<HTMLVideoElement | null>
): UsePoseDetectionResult {
  const detectorRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameIdRef = useRef(0);
  const detectingRef = useRef(false);
  const startingRef = useRef(false);

  const [landmarks, setLandmarks] = useState<NormalizedLandmark[][]>([]);
  const [frameData, setFrameData] = useState<FrameData | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopDetectionLoop = useCallback(() => {
    detectingRef.current = false;
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = 0;
    }
  }, []);

  const detectFrame = useCallback(() => {
    if (!detectingRef.current) return;
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) return;

    const timestamp = performance.now();
    const result = detector.detectForVideo(video, timestamp);
    setLandmarks(result.landmarks ?? []);
    const firstPose = result.landmarks?.[0] ?? [];
    const joints = firstPose.map((joint) => ({
      x: joint.x,
      y: joint.y,
      z: joint.z,
      visibility: joint.visibility,
    }));
    setFrameData({ timestamp, joints });
    animationFrameIdRef.current = requestAnimationFrame(detectFrame);
  }, [videoRef]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
        );
        if (!isMounted) return;
        detectorRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        if (isMounted) setIsModelReady(true);
      } catch (error) {
        console.error('Error loading pose model:', error);
        if (isMounted) {
          setCameraError(
            error instanceof Error ? error.message : 'Could not load the pose model.',
          );
        }
      }
    })();

    return () => {
      isMounted = false;
      stopDetectionLoop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (detectorRef.current) {
        detectorRef.current.close();
        detectorRef.current = null;
      }
      setLandmarks([]);
      setFrameData(null);
      setIsReady(false);
      setIsModelReady(false);
      setHasCamera(false);
    };
  }, [stopDetectionLoop]);

  const startCamera = useCallback(async () => {
    setCameraError(null);

    if (streamRef.current) {
      return;
    }
    if (startingRef.current) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support camera access (use Safari or Chrome, and HTTPS).');
      throw new Error('no getUserMedia');
    }

    const deadline = Date.now() + 30_000;
    while (!detectorRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!detectorRef.current) {
      const msg = 'Pose model is still loading. Wait a moment and tap Arm recording again.';
      setCameraError(msg);
      throw new Error(msg);
    }

    startingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('Video element not mounted');
      }

      streamRef.current = stream;
      video.srcObject = stream;
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.muted = true;

      if (video.readyState < 1 || video.videoWidth <= 0) {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = window.setTimeout(() => {
            video.removeEventListener('loadedmetadata', onMeta);
            video.removeEventListener('error', onErr);
            reject(new Error('Camera preview timed out'));
          }, 15_000);
          const cleanup = () => window.clearTimeout(timeoutId);
          const onMeta = () => {
            cleanup();
            resolve();
          };
          const onErr = () => {
            cleanup();
            reject(new Error(video.error?.message ?? 'Video failed to load'));
          };
          video.addEventListener('loadedmetadata', onMeta, { once: true });
          video.addEventListener('error', onErr, { once: true });
        });
      }

      await video.play().catch(() => undefined);

      setHasCamera(true);
      detectingRef.current = true;
      setIsReady(true);
      animationFrameIdRef.current = requestAnimationFrame(detectFrame);
    } catch (error) {
      const msg = humanMediaError(error);
      setCameraError(msg);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const v = videoRef.current;
      if (v) v.srcObject = null;
      setHasCamera(false);
      setIsReady(false);
      stopDetectionLoop();
      throw error;
    } finally {
      startingRef.current = false;
    }
  }, [detectFrame, stopDetectionLoop, videoRef]);

  return {
    landmarks,
    frameData,
    isReady,
    isModelReady,
    hasCamera,
    cameraError,
    startCamera,
  };
}
