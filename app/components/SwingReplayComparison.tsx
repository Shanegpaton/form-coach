'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Joint, Keypoints } from '../hooks/useSwingRecorder';
import { SWING_CLUBS, type SwingClubId } from '../lib/swing/clubConfig';
import { REFERENCE_SWINGS_BY_CLUB } from '../lib/swing/referenceVideos';

type SwingReplayComparisonProps = {
  club: SwingClubId;
  frames: Keypoints[];
  swingVideoUrl: string | null;
  swingVideoClipStartSeconds?: number;
  swingVideoFrameTimesSeconds?: number[];
  swingVideoSize?: { width: number; height: number } | null;
  topTimeMs?: number | null;
  impactTimeMs?: number | null;
};

type KeypointName = Exclude<keyof Keypoints, 'timestamp' | 'sourceWidth' | 'sourceHeight'>;
type ReplaySpeed = (typeof SPEED_OPTIONS)[number];
type UserReplayMode = 'pose' | 'video';

const SKELETON_CONNECTIONS: [KeypointName, KeypointName][] = [
  ['rightEar', 'rightShoulder'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
];

const KEYPOINTS: KeypointName[] = [
  'rightEar',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
];

const SPEED_OPTIONS = [0.25, 0.5, 1] as const;
const VIDEO_STEP_SECONDS = 1 / 30;

function visibleJoint(joint: Joint | null): joint is Joint {
  return joint != null && Number.isFinite(joint.x) && Number.isFinite(joint.y);
}

function frameIndexForProgress(frameCount: number, progress: number): number {
  if (frameCount <= 1) return 0;
  return Math.max(0, Math.min(frameCount - 1, Math.round(progress * (frameCount - 1))));
}

function medianFrameStepSeconds(frames: Keypoints[]): number | null {
  const deltas = frames
    .slice(1)
    .map((frame, index) => frame.timestamp - frames[index].timestamp)
    .filter((delta) => Number.isFinite(delta) && delta > 0)
    .sort((a, b) => a - b);
  if (deltas.length === 0) return null;
  const middle = Math.floor(deltas.length / 2);
  const medianMs =
    deltas.length % 2 === 0 ? (deltas[middle - 1] + deltas[middle]) / 2 : deltas[middle];
  return medianMs / 1000;
}

function nearestFrameIndexForTime(frameTimes: number[], time: number): number {
  if (frameTimes.length <= 1) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  frameTimes.forEach((frameTime, index) => {
    const distance = Math.abs(frameTime - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.00s';
  return `${seconds.toFixed(2)}s`;
}

function drawSwingFrame(canvas: HTMLCanvasElement, frame: Keypoints | null) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext('2d');
  if (!context) return;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const gradient = context.createLinearGradient(0, 0, rect.width, rect.height);
  gradient.addColorStop(0, '#18181b');
  gradient.addColorStop(1, '#27272a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, rect.width, rect.height);

  context.strokeStyle = 'rgba(255,255,255,0.08)';
  context.lineWidth = 1;
  for (let x = rect.width / 4; x < rect.width; x += rect.width / 4) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, rect.height);
    context.stroke();
  }
  for (let y = rect.height / 4; y < rect.height; y += rect.height / 4) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(rect.width, y);
    context.stroke();
  }

  if (!frame) {
    context.fillStyle = 'rgba(244,244,245,0.72)';
    context.font = '14px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('Capture a swing to replay it here', rect.width / 2, rect.height / 2);
    return;
  }

  const point = (joint: Joint) => ({
    x: joint.x * rect.width,
    y: joint.y * rect.height,
  });

  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 5;
  context.strokeStyle = '#22d3ee';
  SKELETON_CONNECTIONS.forEach(([from, to]) => {
    const a = frame[from];
    const b = frame[to];
    if (!visibleJoint(a) || !visibleJoint(b)) return;
    const p1 = point(a);
    const p2 = point(b);
    context.beginPath();
    context.moveTo(p1.x, p1.y);
    context.lineTo(p2.x, p2.y);
    context.stroke();
  });

  KEYPOINTS.forEach((name) => {
    const joint = frame[name];
    if (!visibleJoint(joint)) return;
    const p = point(joint);
    context.beginPath();
    context.fillStyle = name.includes('Wrist') ? '#facc15' : '#f4f4f5';
    context.arc(p.x, p.y, name.includes('Wrist') ? 5 : 4, 0, Math.PI * 2);
    context.fill();
  });
}

function setVideoTime(video: HTMLVideoElement | null, seconds: number) {
  if (!video) return;
  const upperBound = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
  video.currentTime = Math.max(0, upperBound == null ? seconds : Math.min(upperBound, seconds));
}

function stepVideo(video: HTMLVideoElement | null, direction: -1 | 1, maxTime?: number) {
  if (!video) return 0;
  const durationBound = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Number.POSITIVE_INFINITY;
  const upperBound = Number.isFinite(maxTime) && maxTime != null ? Math.min(durationBound, maxTime) : durationBound;
  const nextTime = Math.max(0, Math.min(upperBound, video.currentTime + VIDEO_STEP_SECONDS * direction));
  video.currentTime = nextTime;
  return nextTime;
}

function cappedUserVideoDuration(videoDuration: number, poseDuration: number): number {
  if (poseDuration > 0) {
    return Number.isFinite(videoDuration) && videoDuration > 0
      ? Math.min(videoDuration, poseDuration)
      : poseDuration;
  }
  return Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : 0;
}

function validVideoSize(size: SwingReplayComparisonProps['swingVideoSize']) {
  return (
    size != null &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

export function SwingReplayComparison({
  club,
  frames,
  swingVideoUrl,
  swingVideoClipStartSeconds = 0,
  swingVideoFrameTimesSeconds = [],
  swingVideoSize = null,
  topTimeMs = null,
  impactTimeMs = null,
}: SwingReplayComparisonProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const userVideoRef = useRef<HTMLVideoElement | null>(null);
  const proVideoRef = useRef<HTMLVideoElement | null>(null);
  const poseAnimationRef = useRef<number>(0);
  const lastPoseTickRef = useRef<number | null>(null);

  const [userMode, setUserMode] = useState<UserReplayMode>(swingVideoUrl ? 'video' : 'pose');
  const referenceSwings = REFERENCE_SWINGS_BY_CLUB[club];
  const [selectedReference, setSelectedReference] = useState<string>(
    referenceSwings[referenceSwings.length - 1]?.src ?? '',
  );

  const [poseProgress, setPoseProgress] = useState(0);
  const [isPosePlaying, setIsPosePlaying] = useState(false);
  const [userVideoTime, setUserVideoTime] = useState(0);
  const [userVideoDuration, setUserVideoDuration] = useState(0);
  const [userVideoReadyKey, setUserVideoReadyKey] = useState<string | null>(null);
  const [isUserVideoPlaying, setIsUserVideoPlaying] = useState(false);
  const [userSpeed, setUserSpeed] = useState<ReplaySpeed>(0.5);

  const [proTime, setProTime] = useState(0);
  const [proDuration, setProDuration] = useState(0);
  const [isProPlaying, setIsProPlaying] = useState(false);
  const [proSpeed, setProSpeed] = useState<ReplaySpeed>(0.5);

  const frameCount = frames.length;
  const effectiveUserMode: UserReplayMode = swingVideoUrl ? userMode : 'pose';
  const currentIndex = frameIndexForProgress(frameCount, poseProgress);
  const currentFrame = frames[currentIndex] ?? null;
  const poseDurationSeconds = useMemo(() => {
    if (frames.length <= 1) return 0;
    return Math.max(0, frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000;
  }, [frames]);
  const poseFrameStepSeconds = useMemo(() => medianFrameStepSeconds(frames), [frames]);
  const poseElapsedSeconds = poseDurationSeconds * poseProgress;
  const topPoseSeconds =
    topTimeMs != null && Number.isFinite(topTimeMs) ? Math.max(0, topTimeMs / 1000) : null;
  const impactPoseSeconds =
    impactTimeMs != null && Number.isFinite(impactTimeMs) ? Math.max(0, impactTimeMs / 1000) : null;
  const topFrameIndex = useMemo(() => {
    if (topPoseSeconds == null || frames.length === 0) return null;
    const targetTimestamp = frames[0].timestamp + topPoseSeconds * 1000;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    frames.forEach((frame, index) => {
      const distance = Math.abs(frame.timestamp - targetTimestamp);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, [frames, topPoseSeconds]);
  const impactFrameIndex = useMemo(() => {
    if (impactPoseSeconds == null || frames.length === 0) return null;
    const targetTimestamp = frames[0].timestamp + impactPoseSeconds * 1000;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    frames.forEach((frame, index) => {
      const distance = Math.abs(frame.timestamp - targetTimestamp);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, [frames, impactPoseSeconds]);
  const topVideoSeconds = topPoseSeconds;
  const impactVideoSeconds = impactPoseSeconds;

  const activeUserVideo = effectiveUserMode === 'video' && swingVideoUrl != null;
  const showPoseCues = !activeUserVideo;
  const userVideoClipStart = Math.max(0, swingVideoClipStartSeconds);
  const userVideoClipKey = `${swingVideoUrl ?? 'none'}:${userVideoClipStart.toFixed(3)}`;
  const userVideoAvailableDuration =
    userVideoDuration > userVideoClipStart ? userVideoDuration - userVideoClipStart : 0;
  const userVideoReplayDuration = cappedUserVideoDuration(
    userVideoAvailableDuration,
    poseDurationSeconds,
  );
  const userVideoStepSeconds = poseFrameStepSeconds ?? VIDEO_STEP_SECONDS;
  const fallbackUserVideoFrameTimes = useMemo(() => {
    if (userVideoReplayDuration <= 0) return [];
    const count = Math.max(1, Math.round(userVideoReplayDuration / userVideoStepSeconds) + 1);
    return Array.from({ length: count }, (_, index) =>
      Math.min(userVideoReplayDuration, index * userVideoStepSeconds),
    );
  }, [userVideoReplayDuration, userVideoStepSeconds]);
  const capturedUserVideoFrameTimes = useMemo(
    () =>
      swingVideoFrameTimesSeconds
        .filter(
          (seconds) =>
            Number.isFinite(seconds) &&
            seconds >= -0.001 &&
            (userVideoReplayDuration <= 0 || seconds <= userVideoReplayDuration + 0.001),
        )
        .map((seconds) => Math.max(0, Math.min(userVideoReplayDuration, seconds)))
        .sort((a, b) => a - b),
    [swingVideoFrameTimesSeconds, userVideoReplayDuration],
  );
  const userVideoFrameTimes =
    capturedUserVideoFrameTimes.length > 0 ? capturedUserVideoFrameTimes : fallbackUserVideoFrameTimes;
  const userVideoFrameCount = userVideoFrameTimes.length;
  const userVideoFrameIndex =
    userVideoFrameCount > 0 ? nearestFrameIndexForTime(userVideoFrameTimes, userVideoTime) : 0;
  const userVideoReadyAtClipStart = !activeUserVideo || userVideoReadyKey === userVideoClipKey;
  const userScrubMax = activeUserVideo ? Math.max(0, userVideoFrameCount - 1) : Math.max(0, frameCount - 1);
  const userScrubValue = activeUserVideo ? userVideoFrameIndex : currentIndex;
  const startScrubPercent = showPoseCues && userScrubMax > 0 ? 0 : null;
  const topScrubValue = showPoseCues ? topFrameIndex : null;
  const topScrubPercent =
    topScrubValue != null && userScrubMax > 0
      ? Math.max(0, Math.min(100, (topScrubValue / userScrubMax) * 100))
      : null;
  const impactScrubValue = showPoseCues ? impactFrameIndex : null;
  const impactScrubPercent =
    impactScrubValue != null && userScrubMax > 0
      ? Math.max(0, Math.min(100, (impactScrubValue / userScrubMax) * 100))
      : null;
  const showingImpact =
    showPoseCues && impactFrameIndex != null && currentIndex === impactFrameIndex;
  const currentSegment = (() => {
    const t = poseElapsedSeconds;
    if (topPoseSeconds != null && t < topPoseSeconds) return 'Backswing / takeaway';
    if (impactPoseSeconds != null && t <= impactPoseSeconds) return 'Downswing';
    return 'Follow-through';
  })();
  const currentPhaseLabel = showingImpact ? 'Impact frame' : currentSegment;
  const currentPhaseClassName = showingImpact
    ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100'
    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';
  const userMediaStyle = {
    aspectRatio: validVideoSize(swingVideoSize)
      ? `${swingVideoSize.width} / ${swingVideoSize.height}`
      : '16 / 9',
  };

  const setPoseScrubProgress = useCallback((nextProgress: number) => {
    const bounded = Math.max(0, Math.min(1, nextProgress));
    setPoseProgress(bounded);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawSwingFrame(canvas, currentFrame);
  }, [currentFrame, effectiveUserMode]);

  useEffect(() => {
    const drawOnResize = () => {
      const canvas = canvasRef.current;
      if (canvas) drawSwingFrame(canvas, currentFrame);
    };
    window.addEventListener('resize', drawOnResize);
    return () => window.removeEventListener('resize', drawOnResize);
  }, [currentFrame]);

  useEffect(() => {
    const video = userVideoRef.current;
    if (!video) return;
    video.playbackRate = userSpeed;
    if (activeUserVideo && isUserVideoPlaying) {
      const playResult = video.play();
      if (playResult) playResult.catch(() => setIsUserVideoPlaying(false));
    } else {
      video.pause();
    }
  }, [activeUserVideo, isUserVideoPlaying, userSpeed, swingVideoUrl]);

  useEffect(() => {
    const video = proVideoRef.current;
    if (!video) return;
    video.playbackRate = proSpeed;
    if (isProPlaying) {
      const playResult = video.play();
      if (playResult) playResult.catch(() => setIsProPlaying(false));
    } else {
      video.pause();
    }
  }, [isProPlaying, proSpeed, selectedReference]);

  useEffect(() => {
    if (!isPosePlaying) {
      if (poseAnimationRef.current) cancelAnimationFrame(poseAnimationRef.current);
      poseAnimationRef.current = 0;
      lastPoseTickRef.current = null;
      return;
    }

    const tick = (now: number) => {
      const lastTick = lastPoseTickRef.current ?? now;
      const deltaSeconds = ((now - lastTick) / 1000) * userSpeed;
      lastPoseTickRef.current = now;
      setPoseProgress((previous) => {
        const duration = poseDurationSeconds > 0 ? poseDurationSeconds : 1.8;
        const next = Math.min(1, previous + deltaSeconds / duration);
        if (next >= 1) setIsPosePlaying(false);
        return next;
      });
      poseAnimationRef.current = requestAnimationFrame(tick);
    };

    poseAnimationRef.current = requestAnimationFrame(tick);
    return () => {
      if (poseAnimationRef.current) cancelAnimationFrame(poseAnimationRef.current);
      poseAnimationRef.current = 0;
    };
  }, [isPosePlaying, poseDurationSeconds, userSpeed]);

  function pauseUserReplay() {
    setIsPosePlaying(false);
    setIsUserVideoPlaying(false);
  }

  function stepUser(direction: -1 | 1) {
    pauseUserReplay();
    if (activeUserVideo) {
      if (userVideoFrameCount <= 1) return;
      const nextFrameIndex = Math.max(
        0,
        Math.min(userVideoFrameCount - 1, userVideoFrameIndex + direction),
      );
      const nextTime = userVideoFrameTimes[nextFrameIndex] ?? userVideoTime;
      setVideoTime(userVideoRef.current, userVideoClipStart + nextTime);
      setUserVideoTime(nextTime);
      return;
    }
    if (frameCount <= 1) return;
    const nextIndex = Math.max(0, Math.min(frameCount - 1, currentIndex + direction));
    setPoseScrubProgress(nextIndex / (frameCount - 1));
  }

  function jumpToImpact() {
    pauseUserReplay();
    if (activeUserVideo) {
      if (impactVideoSeconds == null) return;
      const bounded = Math.max(0, Math.min(userVideoReplayDuration, impactVideoSeconds));
      setVideoTime(userVideoRef.current, userVideoClipStart + bounded);
      setUserVideoTime(bounded);
      return;
    }
    if (impactFrameIndex == null || frameCount <= 1) return;
    setPoseScrubProgress(impactFrameIndex / (frameCount - 1));
  }

  function jumpToTop() {
    pauseUserReplay();
    if (activeUserVideo) {
      if (topVideoSeconds == null) return;
      const bounded = Math.max(0, Math.min(userVideoReplayDuration, topVideoSeconds));
      setVideoTime(userVideoRef.current, userVideoClipStart + bounded);
      setUserVideoTime(bounded);
      return;
    }
    if (topFrameIndex == null || frameCount <= 1) return;
    setPoseScrubProgress(topFrameIndex / (frameCount - 1));
  }

  function toggleUserPlay() {
    if (activeUserVideo) {
      const video = userVideoRef.current;
      if (
        video &&
        userVideoReplayDuration > 0 &&
        video.currentTime >= userVideoClipStart + userVideoReplayDuration
      ) {
        video.currentTime = userVideoClipStart;
        setUserVideoTime(0);
      }
      if (!userVideoReadyAtClipStart) {
        setVideoTime(video, userVideoClipStart);
        return;
      }
      setIsPosePlaying(false);
      if (isUserVideoPlaying) {
        video?.pause();
        setIsUserVideoPlaying(false);
        return;
      }
      if (!video) return;
      video.playbackRate = userSpeed;
      setIsUserVideoPlaying(true);
      const playResult = video.play();
      if (playResult) playResult.catch(() => setIsUserVideoPlaying(false));
      return;
    }
    if (poseProgress >= 1) setPoseScrubProgress(0);
    setIsUserVideoPlaying(false);
    setIsPosePlaying((playing) => !playing);
  }

  function stepPro(direction: -1 | 1) {
    setIsProPlaying(false);
    setProTime(stepVideo(proVideoRef.current, direction));
  }

  return (
    <section
      className="rounded-xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/40 sm:px-5"
      aria-label="Swing replay comparison"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Replay comparison
          </h3>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
            Review your swing and a {SWING_CLUBS[club].referenceLabel} with separate controls.
          </p>
        </div>
        <label className="text-sm text-zinc-600 dark:text-zinc-300">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Reference
          </span>
          <select
            value={selectedReference}
            onChange={(event) => {
              setIsProPlaying(false);
              setProTime(0);
              setSelectedReference(event.target.value);
            }}
            className="min-h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {referenceSwings.map((reference) => (
              <option key={reference.src} value={reference.src}>
                {reference.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-3">
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Your swing</h4>
                {showPoseCues ? (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${currentPhaseClassName}`}>
                    {currentPhaseLabel}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="inline-flex rounded-lg border border-zinc-300 p-1 dark:border-zinc-700">
              <button
                type="button"
                className={`min-h-8 rounded-md px-3 text-sm font-medium transition-colors ${
                  effectiveUserMode === 'video'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
                }`}
                disabled={!swingVideoUrl}
                onClick={() => {
                  pauseUserReplay();
                  setUserMode('video');
                }}
              >
                Video
              </button>
              <button
                type="button"
                className={`min-h-8 rounded-md px-3 text-sm font-medium transition-colors ${
                  effectiveUserMode === 'pose'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
                }`}
                onClick={() => {
                  pauseUserReplay();
                  setUserMode('pose');
                }}
              >
                Pose
              </button>
            </div>
          </div>

          <figure className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 dark:border-zinc-800">
            {activeUserVideo ? (
              <div className="relative bg-zinc-950" style={userMediaStyle}>
                <video
                  ref={userVideoRef}
                  key={userVideoClipKey}
                  src={swingVideoUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className={`absolute inset-0 h-full w-full bg-zinc-950 object-contain ${
                    userVideoReadyAtClipStart ? 'opacity-100' : 'opacity-0'
                  }`}
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    const targetTime = userVideoClipStart + userVideoTime;
                    setUserVideoReadyKey(null);
                    setUserVideoDuration(video.duration);
                    setVideoTime(video, targetTime);
                    if (Math.abs(video.currentTime - targetTime) < 0.02) {
                      setUserVideoReadyKey(userVideoClipKey);
                    }
                  }}
                  onSeeked={(event) => {
                    if (event.currentTarget.currentTime >= userVideoClipStart - 0.02) {
                      setUserVideoReadyKey(userVideoClipKey);
                    }
                  }}
                  onTimeUpdate={(event) => {
                    const video = event.currentTarget;
                    const clipEnd = userVideoClipStart + userVideoReplayDuration;
                    if (!userVideoReadyAtClipStart && video.currentTime >= userVideoClipStart - 0.02) {
                      setUserVideoReadyKey(userVideoClipKey);
                    }
                    if (video.currentTime < userVideoClipStart) {
                      video.currentTime = userVideoClipStart;
                      setUserVideoTime(0);
                      return;
                    }
                    const nextTime = Math.min(
                      Math.max(0, video.currentTime - userVideoClipStart),
                      userVideoReplayDuration || video.currentTime,
                    );
                    if (userVideoReplayDuration > 0 && video.currentTime >= clipEnd) {
                      video.pause();
                      video.currentTime = clipEnd;
                      setIsUserVideoPlaying(false);
                    }
                    setUserVideoTime(nextTime);
                  }}
                  onEnded={() => setIsUserVideoPlaying(false)}
                />
                {!userVideoReadyAtClipStart ? (
                  <div className="absolute inset-0 grid place-items-center bg-zinc-950 text-sm text-zinc-300">
                    Preparing swing frame…
                  </div>
                ) : null}
              </div>
            ) : (
              <canvas ref={canvasRef} className="block w-full" style={userMediaStyle} />
            )}
            <figcaption className="border-t border-white/10 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-300">
              {activeUserVideo ? 'Recorded video' : 'Pose replay'}
            </figcaption>
          </figure>

          <div className="space-y-3">
            <div>
              <div className="relative">
                <input
                  type="range"
                  min="0"
                  max={userScrubMax}
                  step={1}
                  value={userScrubValue}
                  disabled={
                    activeUserVideo
                      ? userVideoReplayDuration <= 0 || !userVideoReadyAtClipStart
                      : frameCount <= 1
                  }
                  aria-label="Your swing replay position"
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    pauseUserReplay();
                    if (activeUserVideo) {
                      const boundedFrame = Math.max(0, Math.min(userVideoFrameCount - 1, nextValue));
                      const bounded = userVideoFrameTimes[boundedFrame] ?? 0;
                      setVideoTime(userVideoRef.current, userVideoClipStart + bounded);
                      setUserVideoTime(bounded);
                    } else {
                      setPoseScrubProgress(frameCount > 1 ? nextValue / (frameCount - 1) : 0);
                    }
                  }}
                  className="w-full accent-zinc-900 disabled:opacity-50 dark:accent-zinc-100"
                />
                {impactScrubPercent != null ? (
                  <span
                    className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-amber-500"
                    style={{ left: `${impactScrubPercent}%` }}
                    aria-hidden
                  />
                ) : null}
                {topScrubPercent != null ? (
                  <span
                    className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-sky-500"
                    style={{ left: `${topScrubPercent}%` }}
                    aria-hidden
                  />
                ) : null}
                {startScrubPercent != null ? (
                  <span
                    className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-emerald-500"
                    style={{ left: `${startScrubPercent}%` }}
                    aria-hidden
                  />
                ) : null}
              </div>
              {showPoseCues && impactFrameIndex != null ? (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>
                    Green = start, blue = top/downswing start, amber = impact/end of downswing.
                  </span>
                  <span className="inline-flex flex-wrap gap-3">
                    {topFrameIndex != null ? (
                      <button
                        type="button"
                        className="font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950 dark:text-zinc-200 dark:decoration-zinc-600 dark:hover:text-white"
                        onClick={jumpToTop}
                      >
                        Jump to top
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950 dark:text-zinc-200 dark:decoration-zinc-600 dark:hover:text-white"
                      onClick={jumpToImpact}
                    >
                      Jump to impact
                    </button>
                  </span>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className="min-h-10 rounded-lg border border-zinc-300 px-2 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:px-3 sm:text-sm"
                  disabled={activeUserVideo ? userVideoTime <= 0 : frameCount <= 1 || currentIndex === 0}
                  onClick={() => stepUser(-1)}
                  aria-label="Previous frame"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 sm:px-4 sm:text-sm"
                  disabled={
                    activeUserVideo
                      ? userVideoReplayDuration <= 0 || !userVideoReadyAtClipStart
                      : frameCount <= 1
                  }
                  onClick={toggleUserPlay}
                >
                  {activeUserVideo
                    ? isUserVideoPlaying
                      ? 'Pause'
                      : 'Play'
                    : isPosePlaying
                      ? 'Pause'
                      : 'Play'}
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-lg border border-zinc-300 px-2 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:px-3 sm:text-sm"
                  disabled={
                    activeUserVideo
                      ? userVideoReplayDuration <= 0 || userVideoTime >= userVideoReplayDuration
                        || !userVideoReadyAtClipStart
                      : frameCount <= 1 || currentIndex === frameCount - 1
                  }
                  onClick={() => stepUser(1)}
                  aria-label="Next frame"
                >
                  ›
                </button>
              </div>

              <label className="flex items-center gap-2 xl:justify-end">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Speed
                </span>
                <select
                  value={userSpeed}
                  onChange={(event) => setUserSpeed(Number(event.target.value) as ReplaySpeed)}
                  className="min-h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  aria-label="Your replay speed"
                >
                  {SPEED_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}x
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              {activeUserVideo ? (
                <>
                  <span>
                    Frame {userVideoFrameCount > 0 ? userVideoFrameIndex + 1 : 0} of {userVideoFrameCount}
                  </span>
                  <span>{formatTime(userVideoTime)} / {formatTime(userVideoReplayDuration)}</span>
                </>
              ) : (
                <>
                  <span>
                    Frame {frameCount > 0 ? currentIndex + 1 : 0} of {frameCount}
                  </span>
                  <span>{formatTime(poseElapsedSeconds)} / {formatTime(poseDurationSeconds)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="flex min-h-12 items-center">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Pro reference</h4>
          </div>
          <figure className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950 dark:border-zinc-800">
            <video
              ref={proVideoRef}
              key={selectedReference}
              src={selectedReference}
              muted
              playsInline
              preload="metadata"
              className="block aspect-video w-full bg-zinc-950 object-contain"
              onLoadedMetadata={(event) => {
                setProDuration(event.currentTarget.duration);
                setVideoTime(event.currentTarget, proTime);
              }}
              onTimeUpdate={(event) => setProTime(event.currentTarget.currentTime)}
              onEnded={() => setIsProPlaying(false)}
            />
            <figcaption className="border-t border-white/10 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-300">
              {SWING_CLUBS[club].referenceLabel}
            </figcaption>
          </figure>

          <div className="space-y-3">
            <input
              type="range"
              min="0"
              max={Math.max(proDuration, 0)}
              step={VIDEO_STEP_SECONDS}
              value={proTime}
              disabled={proDuration <= 0}
              aria-label="Professional reference replay position"
              onChange={(event) => {
                const nextTime = Number(event.target.value);
                setIsProPlaying(false);
                setVideoTime(proVideoRef.current, nextTime);
                setProTime(nextTime);
              }}
              className="w-full accent-zinc-900 disabled:opacity-50 dark:accent-zinc-100"
            />

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className="min-h-10 rounded-lg border border-zinc-300 px-2 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:px-3 sm:text-sm"
                  disabled={proTime <= 0}
                  onClick={() => stepPro(-1)}
                  aria-label="Previous professional frame"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 sm:px-4 sm:text-sm"
                  disabled={proDuration <= 0}
                  onClick={() => {
                    const video = proVideoRef.current;
                    if (video && Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration) {
                      video.currentTime = 0;
                      setProTime(0);
                    }
                    setIsProPlaying((playing) => !playing);
                  }}
                >
                  {isProPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-lg border border-zinc-300 px-2 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:px-3 sm:text-sm"
                  disabled={proDuration <= 0 || proTime >= proDuration}
                  onClick={() => stepPro(1)}
                  aria-label="Next professional frame"
                >
                  ›
                </button>
              </div>

              <label className="flex items-center gap-2 xl:justify-end">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Speed
                </span>
                <select
                  value={proSpeed}
                  onChange={(event) => setProSpeed(Number(event.target.value) as ReplaySpeed)}
                  className="min-h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  aria-label="Professional replay speed"
                >
                  {SPEED_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}x
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{formatTime(proTime)} / {formatTime(proDuration)}</span>
              <span>Frame step uses 1/30s increments</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
