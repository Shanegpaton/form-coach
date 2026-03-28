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
    leadElbowBend: {
      min: number | null;
    };

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

  // Motion sequencing (VERY important for coaching)
  sequencing: {
    hipLead: boolean | null;
    hipVsShoulderTiming: number | null;
    hipPeakFrame: number | null;
    shoulderPeakFrame: number | null;
  };

  // Swing path (club path approximation via wrists)
  swingPath: {
    pathType: "inside-out" | "outside-in" | "neutral";
    backswingVector: { x: number; y: number } | null;
    downswingVector: { x: number; y: number } | null;
    transitionAngle: number | null;
    downswingAngle: number | null;
    pathSeverity: number | null;
    planeConsistency: number | null;
  };
  // Speed + power
  speed: {
    handSpeedMax: number | null;
    handSpeedAtImpact: number | null;
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
  topframeIndex: number;
  impactframeIndex: number;
};

const PATH_ANGLE_THRESHOLD_DEG = 5;

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
  let impactframe = 0;
  for (let i = 0; i < recordedFrames.length; i++) {
    if (recordedFrames[i].leftWrist) {
      console.log(recordedFrames[i].leftWrist);
      console.log(recordedFrames[i].leftWrist.y);
      console.log(recordedFrames[topframe].leftWrist.y);
    }
    if (recordedFrames[i].leftWrist && recordedFrames[i].leftWrist.y > recordedFrames[topframe].leftWrist.y) {
      topframe = i;
    }
    if (recordedFrames[i].leftWrist && recordedFrames[i].leftWrist.y < recordedFrames[impactframe].leftWrist.y && topframe < i) {
      impactframe = i;
    }
  }
  return {
    setupFrame: recordedFrames[0],
    topFrame: recordedFrames[topframe],
    impactFrame: recordedFrames[impactframe],
    topframeIndex: topframe,
    impactframeIndex: impactframe,
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
  for (let i = 0; i < context.impactframeIndex; i++) {
    if (context.recordedFrames[i].rightKnee && context.recordedFrames[i].rightAnkle && context.recordedFrames[i].rightHip) {
      const kneeFlex = threeJoinAngle(context.recordedFrames[i].rightHip, context.recordedFrames[i].rightKnee, context.recordedFrames[i].rightAnkle);
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
  let leadElbowMin = Infinity;
  for (let i = 0; i < context.impactframeIndex; i++) {
    if (context.recordedFrames[i].leftElbow && context.recordedFrames[i].leftWrist && context.recordedFrames[i].leftShoulder) {
      const leadElbow = threeJoinAngle(context.recordedFrames[i].leftShoulder, context.recordedFrames[i].leftElbow, context.recordedFrames[i].leftWrist);
      if (leadElbow !== null && leadElbow < leadElbowMin) {
        leadElbowMin = leadElbow;
      }
    }
  }
  if (leadElbowMin === Infinity) leadElbowMin = null;

  let shoulderMax = -Infinity;
  let shoulderSetup = null;
  let shoulderTop = null;
  let shoulderImpact = null;

  let hipMax = -Infinity;
  let hipTop = null;
  let hipImpact = null;
  
  for (let i = 0; i < context.impactframeIndex; i++) {
    const f = context.recordedFrames[i];
    if (f.leftShoulder && f.rightShoulder) {
      const dx = f.rightShoulder.x - f.leftShoulder.x;
      const dy = f.rightShoulder.y - f.leftShoulder.y;
  
      const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
  
      if (angle > shoulderMax) shoulderMax = angle;
  
      if (i === 0) shoulderSetup = angle;
      if (i === context.topframeIndex) shoulderTop = angle;
      if (i === context.impactframeIndex) shoulderImpact = angle;

      if (f.leftHip && f.rightHip) {
        const dx = f.rightHip.x - f.leftHip.x;
        const dy = f.rightHip.y - f.leftHip.y;
    
        const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
    
        if (angle > hipMax) hipMax = angle;
    
        if (i === context.topframeIndex) hipTop = angle;
        if (i === context.impactframeIndex) hipImpact = angle;
      }
    }

  }
  if (shoulderMax === -Infinity) shoulderMax = null;
  if (hipMax === -Infinity) hipMax = null;

  let lateralHipMovement = null;


  const setupMid = hipMidpoint(context.setupFrame);
  const impactMid = hipMidpoint(context.impactFrame);
  if (setupMid && impactMid) {
    lateralHipMovement = impactMid.x - setupMid.x;
  }

  return {
    leadElbowBend: {
      min: leadElbowMin,
    },
  
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
  let hipPeakFrame: number | null = null;
  let maxShoulderTilt = -Infinity;
  let shoulderPeakFrame: number | null = null;

  for (let i = 0; i < ctx.impactframeIndex; i++) {
    const f = ctx.recordedFrames[i];
    if (f.leftHip && f.rightHip) {
      const dx = f.rightHip.x - f.leftHip.x;
      const dy = f.rightHip.y - f.leftHip.y;
      const tilt = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
      if (Number.isFinite(tilt) && tilt > maxHipTilt) {
        maxHipTilt = tilt;
        hipPeakFrame = i;
      }
    }
    if (f.leftShoulder && f.rightShoulder) {
      const dx = f.rightShoulder.x - f.leftShoulder.x;
      const dy = f.rightShoulder.y - f.leftShoulder.y;
      const tilt = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
      if (Number.isFinite(tilt) && tilt > maxShoulderTilt) {
        maxShoulderTilt = tilt;
        shoulderPeakFrame = i;
      }
    }
  }

  if (maxHipTilt === -Infinity) hipPeakFrame = null;
  if (maxShoulderTilt === -Infinity) shoulderPeakFrame = null;

  let hipVsShoulderTiming: number | null = null;
  let hipLead: boolean | null = null;

  if (
    hipPeakFrame !== null &&
    shoulderPeakFrame !== null &&
    hipPeakFrame >= 0 &&
    hipPeakFrame < ctx.recordedFrames.length &&
    shoulderPeakFrame >= 0 &&
    shoulderPeakFrame < ctx.recordedFrames.length
  ) {
    const tHip = ctx.recordedFrames[hipPeakFrame].timestamp;
    const tShoulder = ctx.recordedFrames[shoulderPeakFrame].timestamp;
    if (Number.isFinite(tHip) && Number.isFinite(tShoulder)) {
      hipVsShoulderTiming = tShoulder - tHip;
      hipLead = tHip < tShoulder;
    }
  }

  return {
    hipLead,
    hipVsShoulderTiming,
    hipPeakFrame,
    shoulderPeakFrame,
  };
}

function calculateSwingPath(ctx: context): SwingAnalysis["swingPath"] {
  const w0 = ctx.setupFrame.leftWrist;
  const wTop = ctx.topFrame.leftWrist;
  const wImp = ctx.impactFrame.leftWrist;

  const backswingVector =
    w0 && wTop ? { x: wTop.x - w0.x, y: wTop.y - w0.y } : null;
  const downswingVector =
    wTop && wImp ? { x: wImp.x - wTop.x, y: wImp.y - wTop.y } : null;

  const transitionAngle =
    backswingVector && downswingVector
      ? angleBetweenVectorsDeg(backswingVector, downswingVector)
      : null;

  let downswingAngle: number | null = null;
  if (downswingVector) {
    downswingAngle = finiteOrNull(Math.atan2(downswingVector.y, downswingVector.x) * (180 / Math.PI));
  }

  let pathType: SwingAnalysis["swingPath"]["pathType"] = "neutral";
  if (downswingAngle !== null) {
    if (downswingAngle > PATH_ANGLE_THRESHOLD_DEG) pathType = "inside-out";
    else if (downswingAngle < -PATH_ANGLE_THRESHOLD_DEG) pathType = "outside-in";
    else pathType = "neutral";
  }

  const pathSeverity = downswingAngle !== null ? finiteOrNull(Math.abs(downswingAngle)) : null;

  const segmentAngles: number[] = [];
  const start = Math.min(ctx.topframeIndex, ctx.impactframeIndex);
  const end = Math.max(ctx.topframeIndex, ctx.impactframeIndex);
  for (let i = start; i < end; i++) {
    const a = ctx.recordedFrames[i]?.leftWrist;
    const b = ctx.recordedFrames[i + 1]?.leftWrist;
    if (!a || !b) continue;
    const ang = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
    if (Number.isFinite(ang)) segmentAngles.push(ang);
  }
  const planeConsistency = varianceSample(segmentAngles);

  return {
    pathType,
    backswingVector,
    downswingVector,
    transitionAngle,
    downswingAngle,
    pathSeverity,
    planeConsistency,
  };
}

function calculateSpeed(ctx: context): SwingAnalysis["speed"] {
  let handSpeedMax: number | null = null;
  let handSpeedAtImpact: number | null = null;

  for (let i = 1; i < ctx.impactframeIndex; i++) {
    const prev = ctx.recordedFrames[i - 1].leftWrist;
    const curr = ctx.recordedFrames[i].leftWrist;
    if (!prev || !curr) continue;

    const dt = ctx.recordedFrames[i].timestamp - ctx.recordedFrames[i - 1].timestamp;
    if (!Number.isFinite(dt) || dt <= 0) continue;

    const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const v = dist / dt;
    if (!Number.isFinite(v)) continue;

    if (handSpeedMax === null || v > handSpeedMax) handSpeedMax = v;
    if (i === ctx.impactframeIndex) handSpeedAtImpact = v;
  }

  if (
    handSpeedAtImpact === null &&
    ctx.impactframeIndex > 0 &&
    ctx.impactframeIndex < ctx.recordedFrames.length
  ) {
    const prev = ctx.recordedFrames[ctx.impactframeIndex - 1].leftWrist;
    const curr = ctx.recordedFrames[ctx.impactframeIndex].leftWrist;
    if (prev && curr) {
      const dt =
        ctx.recordedFrames[ctx.impactframeIndex].timestamp -
        ctx.recordedFrames[ctx.impactframeIndex - 1].timestamp;
      if (Number.isFinite(dt) && dt > 0) {
        const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        const v = dist / dt;
        if (Number.isFinite(v)) handSpeedAtImpact = v;
      }
    }
  }

  return { handSpeedMax, handSpeedAtImpact };
}

function calculateStability(ctx: context): SwingAnalysis["stability"] {
  let prevHead: { x: number; y: number } | null = null;
  let total = 0;
  let segmentCount = 0;

  for (let i = 0; i < ctx.impactframeIndex; i++) {
    const h = ctx.recordedFrames[i].rightEar;
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

  const headMovement = segmentCount > 0 ? finiteOrNull(total) : null;

  const headTop = ctx.topFrame.rightEar;
  const headImp = ctx.impactFrame.rightEar;
  let headRise: number | null = null;
  if (headTop && headImp) {
    headRise = finiteOrNull(headTop.y - headImp.y);
  }

  const hipSetup = hipMidpoint(ctx.setupFrame);
  const hipImp = hipMidpoint(ctx.impactFrame);
  let hipRise: number | null = null;
  if (hipSetup && hipImp) {
    hipRise = finiteOrNull(hipSetup.y - hipImp.y);
  }

  return { headMovement, headRise, hipRise };
}

export function calculateSwingMetrics(recordedFrames: Keypoints[]): SwingAnalysis | null {
  if (!recordedFrames.length) {
    return null;
  }

  const metadata = calculateMetadata(recordedFrames);
  const phases = calculatePhases(recordedFrames);
  const contextObj: context = {
    recordedFrames: recordedFrames,
    setupFrame: phases.setupFrame,
    topFrame: phases.topFrame,
    impactFrame: phases.impactFrame,
    topframeIndex: phases.topframeIndex,
    impactframeIndex: phases.impactframeIndex,
  };
  const posture = calculatePosture(contextObj);
  const kinematics = calculateKinematics(contextObj);
  const sequencing = calculateSequencing(contextObj);
  const swingPath = calculateSwingPath(contextObj);
  const speed = calculateSpeed(contextObj);
  const stability = calculateStability(contextObj);

  return {
    metadata,
    posture,
    kinematics,
    sequencing,
    swingPath,
    speed,
    stability,
  };
}