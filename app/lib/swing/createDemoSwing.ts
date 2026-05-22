import type { Joint, Keypoints } from '../../hooks/useSwingRecorder';

const SOURCE_WIDTH = 1280;
const SOURCE_HEIGHT = 720;
const FRAME_COUNT = 72;
const FRAME_MS = 1000 / 30;

function joint(x: number, y: number, z = 0): Joint {
  return { x, y, z, visibility: 0.98 };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function trianglePhase(index: number, start: number, peak: number, end: number) {
  if (index <= start) return 0;
  if (index < peak) return (index - start) / (peak - start);
  if (index < end) return 1 - (index - peak) / (end - peak);
  return 0;
}

export function createDemoSwingFrames(startTimestamp = 0): Keypoints[] {
  return Array.from({ length: FRAME_COUNT }, (_, index) => {
    const takeaway = Math.min(1, index / 27);
    const downswing = index < 27 ? 0 : Math.min(1, (index - 27) / 16);
    const followThrough = index < 43 ? 0 : Math.min(1, (index - 43) / 24);
    const shoulderSway = Math.sin((index / (FRAME_COUNT - 1)) * Math.PI) * 0.015;
    const headSway = Math.sin((index / (FRAME_COUNT - 1)) * Math.PI * 1.4) * 0.012;
    const kneePulse = trianglePhase(index, 12, 38, 58) * 0.025;

    const shoulderY = 0.34 + shoulderSway * 0.3;
    const hipY = 0.58;
    const leftWristX =
      index < 27
        ? lerp(0.44, 0.31, takeaway)
        : index < 43
          ? lerp(0.31, 0.53, downswing)
          : lerp(0.53, 0.66, followThrough);
    const leftWristY =
      index < 27
        ? lerp(0.43, 0.17, takeaway)
        : index < 43
          ? lerp(0.17, 0.55, downswing)
          : lerp(0.55, 0.26, followThrough);
    const rightWristX =
      index < 27
        ? lerp(0.48, 0.35, takeaway)
        : index < 43
          ? lerp(0.35, 0.56, downswing)
          : lerp(0.56, 0.68, followThrough);
    const rightWristY =
      index < 27
        ? lerp(0.44, 0.2, takeaway)
        : index < 43
          ? lerp(0.2, 0.56, downswing)
          : lerp(0.56, 0.29, followThrough);

    return {
      timestamp: startTimestamp + index * FRAME_MS,
      sourceWidth: SOURCE_WIDTH,
      sourceHeight: SOURCE_HEIGHT,
      rightEar: joint(0.53 + headSway, 0.22),
      leftShoulder: joint(0.45 + shoulderSway, shoulderY),
      rightShoulder: joint(0.56 + shoulderSway, shoulderY + 0.015),
      leftElbow: joint(lerp(0.44, leftWristX, 0.55), lerp(0.37, leftWristY, 0.55)),
      rightElbow: joint(lerp(0.56, rightWristX, 0.55), lerp(0.38, rightWristY, 0.55)),
      leftWrist: joint(leftWristX, leftWristY),
      rightWrist: joint(rightWristX, rightWristY),
      leftHip: joint(0.46, hipY),
      rightHip: joint(0.56, hipY + 0.01),
      leftKnee: joint(0.45, 0.76 - kneePulse),
      rightKnee: joint(0.57, 0.75 - kneePulse * 0.7),
      leftAnkle: joint(0.43, 0.93),
      rightAnkle: joint(0.59, 0.93),
    };
  });
}
