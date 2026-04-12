import type { Keypoints } from '../../hooks/useSwingRecorder';
import type { Joint } from '../../hooks/useSwingRecorder';

export type SwingAnalysis = {
  metadata: {
    durationMs: number;
    handedness: "right" | "left";
  };

  // Setup + posture characteristics
  posture: {
    spineAngle: {
      setup: number | null;
      top: number | null;
      impact: number | null;
    };
    kneeFlex: {
      min: number | null;
      setup: number | null;
      top: number | null;
      impact: number | null;
    };
  };

  // Joint + rotation mechanics
  kinematics: {

    shoulderTilt: {
      max: number | null;
      setup: number | null;
      top: number | null;
      impact: number | null;
    };

    hipTilt: {
      max: number | null;
      top: number | null;
      impact: number | null;
    };

    weightShift: {
      lateralHipMovement: number | null;
    };
  };

  // Motion sequencing — timing split so offsets vs inter-event deltas cannot be confused
  sequencing: {
    timing: {
      /** Elapsed ms from recording start (first frame `timestamp` = origin) */
      absolute: {
        hipPeakMs: number | null;
        shoulderPeakMs: number | null;
        topMs: number | null;
        impactMs: number | null;
      };
      /** Differences between event timestamps only (not vs recording start) */
      relative: {
        /** shoulder peak time − hip peak time (positive = shoulder peaks later) */
        hipVsShoulderMs: number | null;
      };
    };
  };

  // Swing path (club path approximation via wrists)
  swingPath: {
    pathType: "inside-out" | "outside-in" | "neutral";
    /** Wrist displacement: |v|/torsoLength + direction (angle not scaled). */
    backswingVector: { magnitude: number; angleDeg: number } | null;
    downswingVector: { magnitude: number; angleDeg: number } | null;
    transitionAngle: number | null;
    downswingAngle: number | null;
    pathSeverity: number | null;
  };

  // Stability + posture maintenance
  stability: {
    headMovement: number | null;
    headRise: number | null;
    hipRise: number | null;
  };
};

type context = {
  recordedFrames: Keypoints[];
  setupFrame: Keypoints;
  topFrame: Keypoints;
  impactFrame: Keypoints;
  /** First frame timestamp (ms); offsets are relative to this */
  recordingStartTimestamp: number;
  torsoLength: number | null;
};

const PATH_ANGLE_THRESHOLD_DEG = 5;
const NEUTRAL_PATH_ANGLE_DEG = -101;

function finiteOrNull(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return n;
}

function midPoint2D(a: Joint, b: Joint): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function hipMidpoint(f: Keypoints): { x: number; y: number } | null {
  if (f.leftHip && f.rightHip) return midPoint2D(f.leftHip, f.rightHip);
  return null;
}

function torsoLengthFromSetup(setup: Keypoints): number | null {
  const s = setup.rightShoulder;
  const h = setup.rightHip;
  if (!s || !h) return null;
  const len = Math.hypot(h.x - s.x, h.y - s.y);
  if (!Number.isFinite(len) || len <= 1e-9) return null;
  return len;
}

/**
 * Wrist displacement normalized by torso length: magnitude = hypot(v)/torso.
 * Direction is the raw vector angle (scaling a vector does not change atan2).
 */
function torsoNormalizedDisplacement(
  v: { x: number; y: number } | null,
  torso: number | null,
): { magnitude: number; angleDeg: number } | null {
  if (!v || torso == null || torso <= 0) return null;
  const mag = Math.hypot(v.x, v.y);
  const magnitude = finiteOrNull(mag / torso);
  const angleDeg = finiteOrNull(Math.atan2(v.y, v.x) * (180 / Math.PI));
  if (magnitude == null || angleDeg == null) return null;
  return { magnitude, angleDeg };
}

function scaleDistance(d: number | null, torso: number | null): number | null {
  if (d == null || torso == null || torso <= 0) return null;
  return finiteOrNull(d / torso);
}

function angleBetweenVectorsDeg(v1: { x: number; y: number }, v2: { x: number; y: number }): number | null {
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 === 0 || m2 === 0) return null;
  let c = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
  c = Math.max(-1, Math.min(1, c));
  const rad = Math.acos(c);
  return finiteOrNull(rad * (180 / Math.PI));
}

function varianceSample(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  return finiteOrNull(sumSq / (values.length - 1));
}

function calculateMetadata(recordedFrames: Keypoints[]): SwingAnalysis["metadata"] {
  return {
    durationMs: recordedFrames[recordedFrames.length - 1].timestamp - recordedFrames[0].timestamp,
    handedness: "right",
  };
}

function calculatePhases(recordedFrames: Keypoints[]) {
  let topframe = 0;
  while (topframe < recordedFrames.length && !recordedFrames[topframe].leftWrist) {
    topframe += 1;
  }
  if (topframe >= recordedFrames.length) {
    const f0 = recordedFrames[0];
    const t0 = f0.timestamp;
    return {
      setupFrame: f0,
      topFrame: f0,
      impactFrame: f0,
      timeTopMs: 0,
      timeImpactMs: 0,
    };
  }

  let impactframe = topframe;
  for (let i = 0; i < recordedFrames.length; i++) {
    const lw = recordedFrames[i].leftWrist;
    if (!lw) continue;

    const topLw = recordedFrames[topframe].leftWrist;
    if (topLw && lw.y > topLw.y) {
      topframe = i;
    }

    const impLw = recordedFrames[impactframe].leftWrist;
    if (impLw && lw.y < impLw.y && topframe < i) {
      impactframe = i;
    }
  }

  const t0 = recordedFrames[0].timestamp;
  return {
    setupFrame: recordedFrames[0],
    topFrame: recordedFrames[topframe],
    impactFrame: recordedFrames[impactframe],
    timeTopMs: finiteOrNull(recordedFrames[topframe].timestamp - t0),
    timeImpactMs: finiteOrNull(recordedFrames[impactframe].timestamp - t0),
  };
}

function threeJoinAngle(top: Joint, middle: Joint, bottom: Joint) {
  if (!top || !middle || !bottom) return null;

  const v1 = {
    x: top.x - middle.x,
    y: top.y - middle.y,
  };

  const v2 = {
    x: bottom.x - middle.x,
    y: bottom.y - middle.y,
  };

  const dot = v1.x * v2.x + v1.y * v2.y;

  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);

  if (mag1 === 0 || mag2 === 0) return null;

  let cosAngle = dot / (mag1 * mag2);

  cosAngle = Math.max(-1, Math.min(1, cosAngle));

   return Math.acos(cosAngle) * (180 / Math.PI);

}

function calculatePosture(context: context) {
  // angle between right shoulder and right hip
  let  spineAngleStart = null
  if (context.setupFrame.rightShoulder && context.setupFrame.rightHip) {
    spineAngleStart = Math.atan2(context.setupFrame.rightShoulder.y - context.setupFrame.rightHip.y, context.setupFrame.rightShoulder.x - context.setupFrame.rightHip.x);
    spineAngleStart = spineAngleStart * (180 / Math.PI);
  }
  let spineAngleTop = null
  if (context.topFrame.rightShoulder && context.topFrame.rightHip) {
    spineAngleTop = Math.atan2(context.topFrame.rightShoulder.y - context.topFrame.rightHip.y, context.topFrame.rightShoulder.x - context.topFrame.rightHip.x);
    spineAngleTop = spineAngleTop * (180 / Math.PI);
  }
  let spineAngleImpact = null
  if (context.impactFrame.rightShoulder && context.impactFrame.rightHip) {
    spineAngleImpact = Math.atan2(context.impactFrame.rightShoulder.y - context.impactFrame.rightHip.y, context.impactFrame.rightShoulder.x - context.impactFrame.rightHip.x);
    spineAngleImpact = spineAngleImpact * (180 / Math.PI);
  }
  let kneeFlexStart = null
  if (context.setupFrame.rightKnee && context.setupFrame.rightAnkle && context.setupFrame.rightHip) {
    kneeFlexStart = threeJoinAngle(context.setupFrame.rightHip, context.setupFrame.rightKnee, context.setupFrame.rightAnkle);
  }
  let kneeFlexImpact: number | null = null;
  if (context.impactFrame.rightKnee && context.impactFrame.rightAnkle && context.impactFrame.rightHip) {
    kneeFlexImpact = threeJoinAngle(context.impactFrame.rightHip, context.impactFrame.rightKnee, context.impactFrame.rightAnkle);
  }
  let kneeFlexTop = null
  if (context.topFrame.rightKnee && context.topFrame.rightAnkle && context.topFrame.rightHip) {
    kneeFlexTop = threeJoinAngle(context.topFrame.rightHip, context.topFrame.rightKnee, context.topFrame.rightAnkle);
  }
  let kneeFlexMin = Infinity;
  for (const f of context.recordedFrames) {
    if (f.timestamp > context.impactFrame.timestamp) break;
    if (f.rightKnee && f.rightAnkle && f.rightHip) {
      const kneeFlex = threeJoinAngle(f.rightHip, f.rightKnee, f.rightAnkle);
      if (kneeFlex !== null && kneeFlex < kneeFlexMin) {
        kneeFlexMin = kneeFlex;
      }
    }
  }
  if (kneeFlexMin === Infinity) kneeFlexMin = null;

  return {
    spineAngle: {
      setup: spineAngleStart,
      top: spineAngleTop,
      impact: spineAngleImpact,
    },
    kneeFlex: {
      min: kneeFlexMin,
      setup: kneeFlexStart,
      top: kneeFlexTop,
      impact: kneeFlexImpact,
    },
  };
}

function calculateKinematics(context: context) {
  const T = context.torsoLength;


  let shoulderMax = -Infinity;
  let shoulderSetup = null;
  let shoulderTop = null;
  let shoulderImpact = null;

  let hipMax = -Infinity;
  let hipTop = null;
  let hipImpact = null;
  
  for (const f of context.recordedFrames) {
    if (f.timestamp > context.impactFrame.timestamp) break;
    if (f.leftShoulder && f.rightShoulder) {
      const dx = f.rightShoulder.x - f.leftShoulder.x;
      const dy = f.rightShoulder.y - f.leftShoulder.y;

      const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));

      if (angle > shoulderMax) shoulderMax = angle;

      if (f === context.setupFrame) shoulderSetup = angle;
      if (f === context.topFrame) shoulderTop = angle;
      if (f === context.impactFrame) shoulderImpact = angle;

      if (f.leftHip && f.rightHip) {
        const hdx = f.rightHip.x - f.leftHip.x;
        const hdy = f.rightHip.y - f.leftHip.y;

        const hAngle = Math.abs(Math.atan2(hdy, hdx) * (180 / Math.PI));

        if (hAngle > hipMax) hipMax = hAngle;

        if (f === context.topFrame) hipTop = hAngle;
        if (f === context.impactFrame) hipImpact = hAngle;
      }
    }
  }
  if (shoulderMax === -Infinity) shoulderMax = null;
  if (hipMax === -Infinity) hipMax = null;

  let lateralHipMovement = null;


  const setupMid = hipMidpoint(context.setupFrame);
  const impactMid = hipMidpoint(context.impactFrame);
  if (setupMid && impactMid) {
    lateralHipMovement = scaleDistance(impactMid.x - setupMid.x, T);
  }

  return {
    shoulderTilt: {
      max: shoulderMax,
      setup: shoulderSetup,
      top: shoulderTop,
      impact: shoulderImpact,
    },
  
    hipTilt: {
      max: hipMax,
      top: hipTop,
      impact: hipImpact,
    },
  
    weightShift: {
      lateralHipMovement,
    },
  };
}

function calculateSequencing(ctx: context): SwingAnalysis["sequencing"] {
  let maxHipTilt = -Infinity;
  let hipPeakTs: number | null = null;
  let maxShoulderTilt = -Infinity;
  let shoulderPeakTs: number | null = null;

  for (const f of ctx.recordedFrames) {
    if (f.timestamp > ctx.impactFrame.timestamp) break;
    if (f.leftHip && f.rightHip) {
      const dx = f.rightHip.x - f.leftHip.x;
      const dy = f.rightHip.y - f.leftHip.y;
      const tilt = Math.atan2(dy, dx) * (180 / Math.PI);
      if (Number.isFinite(tilt) && tilt > maxHipTilt) {
        maxHipTilt = tilt;
        hipPeakTs = f.timestamp;
      }
    }
    if (f.leftShoulder && f.rightShoulder) {
      const dx = f.rightShoulder.x - f.leftShoulder.x;
      const dy = f.rightShoulder.y - f.leftShoulder.y;
      const tilt = Math.atan2(dy, dx) * (180 / Math.PI);
      if (Number.isFinite(tilt) && tilt > maxShoulderTilt) {
        maxShoulderTilt = tilt;
        shoulderPeakTs = f.timestamp;
      }
    }
  }

  if (maxHipTilt === -Infinity) hipPeakTs = null;
  if (maxShoulderTilt === -Infinity) shoulderPeakTs = null;

  const t0 = ctx.recordingStartTimestamp;
  let hipVsShoulderMs: number | null = null;

  if (hipPeakTs !== null && shoulderPeakTs !== null) {
    if (Number.isFinite(hipPeakTs) && Number.isFinite(shoulderPeakTs)) {
      hipVsShoulderMs = finiteOrNull(shoulderPeakTs - hipPeakTs);
    }
  }

  return {
    timing: {
      absolute: {
        hipPeakMs: hipPeakTs != null ? finiteOrNull(hipPeakTs - t0) : null,
        shoulderPeakMs: shoulderPeakTs != null ? finiteOrNull(shoulderPeakTs - t0) : null,
        topMs: finiteOrNull(ctx.topFrame.timestamp - t0),
        impactMs: finiteOrNull(ctx.impactFrame.timestamp - t0),
      },
      relative: {
        hipVsShoulderMs,
      },
    },
  };
}

function calculateSwingPath(ctx: context): SwingAnalysis["swingPath"] {
  const T = ctx.torsoLength;
  const w0 = ctx.setupFrame.leftWrist;
  const wTop = ctx.topFrame.leftWrist;
  const wImp = ctx.impactFrame.leftWrist;

  const backswingVectorRaw =
    w0 && wTop ? { x: wTop.x - w0.x, y: wTop.y - w0.y } : null;
  const downswingVectorRaw =
    wTop && wImp ? { x: wImp.x - wTop.x, y: wImp.y - wTop.y } : null;

  const backswingVector = torsoNormalizedDisplacement(backswingVectorRaw, T);
  const downswingVector = torsoNormalizedDisplacement(downswingVectorRaw, T);

  const transitionAngle =
    backswingVectorRaw && downswingVectorRaw
      ? angleBetweenVectorsDeg(backswingVectorRaw, downswingVectorRaw)
      : null;

  let downswingAngle: number | null = null;
  if (downswingVectorRaw) {
    downswingAngle = finiteOrNull(
      Math.atan2(downswingVectorRaw.y, downswingVectorRaw.x) * (180 / Math.PI),
    );
  }

  let pathType: SwingAnalysis["swingPath"]["pathType"] = "neutral";
  if (downswingAngle !== null) {
    if (downswingAngle > NEUTRAL_PATH_ANGLE_DEG + PATH_ANGLE_THRESHOLD_DEG) pathType = "inside-out";
    else if (downswingAngle < NEUTRAL_PATH_ANGLE_DEG - PATH_ANGLE_THRESHOLD_DEG) pathType = "outside-in";
    else pathType = "neutral";
  }

  const pathSeverity = downswingAngle !== null ? finiteOrNull(downswingAngle) : null;

  return {
    pathType,
    backswingVector,
    downswingVector,
    transitionAngle,
    downswingAngle,
    pathSeverity,
  };
}


function calculateStability(ctx: context): SwingAnalysis["stability"] {
  const T = ctx.torsoLength;
  let prevHead: { x: number; y: number } | null = null;
  let total = 0;
  let segmentCount = 0;

  for (const f of ctx.recordedFrames) {
    if (f.timestamp > ctx.impactFrame.timestamp) break;
    const h = f.rightEar;
    if (!h) continue;
    if (prevHead) {
      const d = Math.hypot(h.x - prevHead.x, h.y - prevHead.y);
      if (Number.isFinite(d)) {
        total += d;
        segmentCount += 1;
      }
    }
    prevHead = h;
  }

  const headMovementRaw = segmentCount > 0 ? finiteOrNull(total) : null;
  const headMovement = scaleDistance(headMovementRaw, T);

  const headTop = ctx.topFrame.rightEar;
  const headImp = ctx.impactFrame.rightEar;
  let headRise: number | null = null;
  if (headTop && headImp) {
    headRise = scaleDistance(finiteOrNull(headTop.y - headImp.y), T);
  }

  const hipSetup = hipMidpoint(ctx.setupFrame);
  const hipImp = hipMidpoint(ctx.impactFrame);
  let hipRise: number | null = null;
  if (hipSetup && hipImp) {
    hipRise = scaleDistance(finiteOrNull(hipSetup.y - hipImp.y), T);
  }

  return { headMovement, headRise, hipRise };
}

export function calculateSwingMetrics(recordedFrames: Keypoints[]): SwingAnalysis | null {
  if (!recordedFrames.length) {
    return null;
  }

  const torsoLength = torsoLengthFromSetup(recordedFrames[0]);
  const phases = calculatePhases(recordedFrames);
  const metadata = calculateMetadata(recordedFrames);
  const contextObj: context = {
    recordedFrames: recordedFrames,
    setupFrame: phases.setupFrame,
    topFrame: phases.topFrame,
    impactFrame: phases.impactFrame,
    recordingStartTimestamp: recordedFrames[0].timestamp,
    torsoLength,
  };
  const posture = calculatePosture(contextObj);
  const kinematics = calculateKinematics(contextObj);
  const sequencing = calculateSequencing(contextObj);
  const swingPath = calculateSwingPath(contextObj);
  const stability = calculateStability(contextObj);

  return {
    metadata,
    posture,
    kinematics,
    sequencing,
    swingPath,
    stability,
  };
}