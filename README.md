# Computer Vision Swing Coach

Real-time golf swing coaching with browser-based pose tracking and AI-generated feedback.  
This project captures a single driver swing from webcam video, computes biomechanical metrics, and translates those into concise coaching cues.

## Why This Project

- Shows end-to-end product thinking: UX flow, motion capture, metrics pipeline, and coaching output.
- Demonstrates practical computer vision in a real-time, user-facing app.
- Bridges raw model output and human-friendly guidance with domain-aware prompt design.

## Demo

- Live app: [https://swing-coach-ochre.vercel.app](https://swing-coach-ochre.vercel.app/)
- Short walkthrough video (60-90s): `ADD_VIDEO_URL`
- Swing capture + coaching example GIF: `ADD_GIF_URL`

## Core Features

- Real-time webcam pose detection in the browser.
- Auto arm -> stillness validation -> motion-triggered swing recording.
- Heuristic swing end detection robust to hand occlusion during follow-through.
- Computation of posture, path, kinematic, and stability metrics from captured frames.
- AI coach endpoint that turns metrics into actionable golf feedback (with priority weighting and guardrails).
- Streamed coaching response rendering in the UI.

## Technical Highlights

- **Frontend + runtime:** Next.js App Router, React, TypeScript.
- **Pose tracking:** MediaPipe Tasks Vision.
- **AI integration:** Google Gemini via `ai-sdk` streaming.
- **Pipeline design:** deterministic metric extraction + constrained LLM prompting.
- **UX focus:** status-driven guidance, framing checks, and one-coach-request-per-capture controls.

## Architecture (High Level)

1. Camera feed initializes in `app/components/cameraStream.tsx`.
2. Pose landmarks are read frame-by-frame via `usePoseDetection`.
3. `useAutoSwingCapture` handles state machine transitions:
   - `idle` -> `armed_waiting_still` -> `armed_waiting_motion` -> `recording` -> `completed`
4. Captured keypoints are converted into swing metrics.
5. Metrics are posted to `app/api/swing/coach/route.ts`.
6. Prompt and reference data produce short-form coaching text streamed back to the UI.

## Notable Engineering Decisions

- **Separate capture heuristics from coaching logic** for clearer iteration and reliability.
- **Omit non-comparable timing dimensions** when referencing pro ranges to avoid false coaching.
- **Prioritize metric importance** so feedback focuses on impact-driving issues, not noisy stats.
- **Constrain output style** to produce practical coaching language instead of generic analysis.

## Local Setup

### Prerequisites

- Node.js 18+ (or current LTS)
- npm
- A webcam-enabled device/browser

### Install

```bash
npm install
```

### Environment

Create `.env.local`:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` - start local development server
- `npm run build` - production build
- `npm run start` - run production server
- `npm run lint` - lint checks

## What I Would Build Next

- Save and compare multiple swings over time for progress tracking.
- Add side-by-side frame overlays against reference swing phases.
- Introduce confidence scoring per metric based on landmark quality/visibility.
- Expand to club-specific models and coaching profiles.

## Repository Guide

- `app/components/cameraStream.tsx` - primary user workflow/UI
- `app/hooks/useAutoSwingCapture.ts` - swing capture state machine + stop heuristics
- `app/lib/swing/calculateSwingMetrics.ts` - metric computation
- `app/api/swing/coach/route.ts` - AI coaching API + prompt constraints
- `app/lib/swing/data/*` - reference ranges and metric priority metadata

## Contact

Created by `Shane Paton`  
LinkedIn: [www.linkedin.com/in/shanepaton](www.linkedin.com/in/shanepaton)  
Portfolio: [shanepaton.com](shanepaton.com)
