import type { FrameData } from '../../hooks/usePoseDetection';

export type SwingAnalysis = {
  metadata: {
    durationMs: number;
    fps: number;
    handedness: "right" | "left";
  };

  // Key reference points in the swing
  phases: {
    setupFrame: number;
    topFrame: number;
    impactFrame: number;
  };


  // Setup + posture characteristics
  posture: {
    spineAngle: number;        // torso lean at setup
    stanceWidth: number;       // distance between feet
    kneeFlex: {
      setup: number;
      min: number;
      atImpact: number;
    };
    reach: number;             // hands distance from body at setup
  };

  // Joint + rotation mechanics
  kinematics: {
    leadElbow: {
      min: number;
      atTop: number;
      atImpact: number;
    };

    trailElbow: {
      min: number;
      atTop: number;
      atImpact: number;
    };

    shoulderRotation: {
      max: number;
      atTop: number;
      atImpact: number;
    };

    hipRotation: {
      max: number;
      atTop: number;
      atImpact: number;
    };

    weightShift: {
      lateralHipMovement: number;
    }

  };

  // Motion sequencing (VERY important for coaching)
  sequencing: {
    hipLead: boolean;              // hips start before shoulders
    hipVsShoulderTiming: number;   // ms difference
    hipPeakFrame: number;
    shoulderPeakFrame: number;
  };

  // Swing path (club path approximation via wrists)
  swingPath: {
    pathType: "inside-out" | "outside-in" | "neutral";
  
    // Core geometry
    backswingVector: {
      x: number;
      y: number;
    };
  
    downswingVector: {
      x: number;
      y: number;
    };
  
    // Angle between backswing and downswing (KEY METRIC)
    transitionAngle: number;
  
    // Direction relative to target line (simplified horizontal axis)
    downswingAngle: number;
  
    // How extreme the path is
    pathSeverity: number;
  
    // How consistent the swing plane is over time
    planeConsistency: number;
  };
  // Speed + power
  speed: {
    handSpeedMax: number;
    handSpeedAtImpact: number;
  };

  // Stability + posture maintenance
  stability: {
    headMovement: number; // total movement over swing
    headRise: number;     // vertical change (top → impact)
    hipRise: number;      // detects early extension
  };
};
/**
 * Basic swing metric scaffolding.
 * This is intentionally minimal so you can plug in real calculations later.
 */
export function calculateSwingMetrics(recordedFrames: FrameData[]): SwingAnalysis {
  if (!recordedFrames.length) {
    return null;
  }


  return null;
}

