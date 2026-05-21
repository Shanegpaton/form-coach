# Computer Vision Coaching Project Notes

## Project Summary

This is a Next.js App Router project for browser-based golf swing coaching. The app uses a webcam, MediaPipe pose tracking, deterministic swing metric extraction, and a Gemini-powered coaching endpoint to give short driver-swing feedback.

The main product flow is:

1. User taps **Arm recording**.
2. Camera starts from a user gesture and MediaPipe pose landmarks stream in the browser.
3. `useAutoSwingCapture` waits for full-body framing, stillness, then motion.
4. A single swing is recorded as pose keypoints.
5. `calculateSwingMetrics` converts keypoints into posture, kinematics, sequencing, swing path, and stability metrics.
6. `/api/swing/coach` compares those metrics to driver pro ranges and streams concise coaching text from Gemini.

## Stack And Commands

- Framework: Next.js 16 App Router, React 19, TypeScript enabled.
- Styling: Tailwind CSS v4 via `@import "tailwindcss"` in `app/globals.css`.
- Pose detection: `@mediapipe/tasks-vision`.
- AI: `ai` SDK with `@ai-sdk/google`.
- Markdown rendering: `react-markdown`.
- Benchmark automation: Playwright plus a temporary dev route.

Common commands:

```bash
npm run dev
npm run build
npm run lint
npm run benchmark:driver
```

AI coaching requires `.env.local`:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
```

## Important Files

- `app/page.js`: Home page, setup instructions, and mount point for the camera workflow.
- `app/components/cameraStream.tsx`: Primary UI and user workflow. Draws pose overlays, manages capture summaries, and streams coach responses.
- `app/hooks/usePoseDetection.ts`: Loads MediaPipe WASM/model from remote URLs, starts the webcam only after a user gesture, and emits normalized landmark frames.
- `app/hooks/useAutoSwingCapture.ts`: Swing capture state machine. Handles full-body framing, stillness validation, motion start, recording, and stop heuristics.
- `app/hooks/useSwingRecorder.ts`: Older/manual recorder helper and the shared `Joint`/`Keypoints` types used by the metric pipeline.
- `app/lib/swing/calculateSwingMetrics.ts`: Converts recorded keypoints into the `SwingAnalysis` object.
- `app/api/swing/coach/route.ts`: Gemini streaming API. Validates request shape, strips incomparable timing ranges, adds metric importance/notes, and strongly constrains coach style.
- `app/lib/swing/data/driverProRanges.json`: Compact pro reference ranges used by the coach endpoint.
- `app/lib/swing/data/driverMetricImportance.json`: Priority weights and caveats for metric interpretation.
- `app/dev/driver-benchmarks/*`: Temporary/dev-only benchmark UI used by the benchmark script.
- `scripts/capture-driver-benchmarks.mjs`: Starts Next, opens `/dev/driver-benchmarks` in headless Chromium, and rewrites driver benchmark JSON/ranges.
- `public/setup.png`: Camera setup image shown on the home page.
- `public/swings/Driver/*.mp4`: Benchmark videos served by Next for the dev benchmark route.

## Capture Pipeline Notes

`usePoseDetection` loads MediaPipe from:

- `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm`
- `https://storage.googleapis.com/mediapipe-models/pose_landmarker/.../pose_landmarker_lite.task`

Because the model and WASM are remote, local development and production need network access. Camera access also requires a secure context in most browsers, except localhost.

`useAutoSwingCapture` uses this state flow:

```text
idle -> armed_waiting_still -> armed_waiting_motion -> recording -> completed
```

Key heuristics:

- Full-body framing checks require right-side swing landmarks from ear through ankle to be visible and inside normalized image bounds.
- Stillness is based on low normalized motion for about one second.
- Recording starts after several consecutive frames above the motion threshold.
- Recording stops on hand rise after the bottom of the arc, a post-bottom plateau, or a hard max duration.
- The code currently assumes right-handed analysis in `calculateMetadata`.

## Metrics And Coaching Notes

`calculateSwingMetrics` produces a `SwingAnalysis` with:

- `metadata`: duration and handedness.
- `posture`: spine angle and knee flex.
- `kinematics`: shoulder/hip tilt and lateral hip movement.
- `sequencing`: absolute phase timings and hip-vs-shoulder timing.
- `swingPath`: wrist-vector path approximation and path type.
- `stability`: head movement, head rise, hip rise.

Most distances are normalized by setup torso length so the coach can compare across body sizes and camera scales. Some metrics are intentionally weak 2D proxies; check `driverMetricImportance.json` before treating a metric as high-confidence.

The coach endpoint deliberately removes duration and sequencing timing from pro reference comparisons because live capture and offline benchmark sampling use different timing pipelines. Do not reintroduce pro timing comparisons unless the capture pipelines are made comparable.

## Benchmark Data

The driver reference set is built from four local videos:

- `billyDriver`
- `danDriver`
- `ianDriver`
- `rickieDriver`

The browser benchmark samples clips at 16 FPS with the same MediaPipe model and metric code, then aggregates numeric ranges and padded coaching bands. `npm run benchmark:driver` rewrites:

- `app/lib/swing/data/driverProBenchmarks.full.json`
- `app/lib/swing/data/driverProRanges.json`

The script serves videos from `public/swings/Driver`. There is also an `app/swings/Driver` copy in the repo, but the configured benchmark URLs point at `/swings/Driver/...` from `public`.

## Development Sharp Edges

- `AGENTS.md` was initially present but empty/untracked.
- `tsconfig.json` has `strict: false` and `allowJs: true`; expect mixed JS/TS and some loose typing.
- `cameraStream.tsx` contains an important video/canvas alignment note: keep the video as `display: block` to avoid pose overlay offset.
- `useAutoSwingCapture.toKeypoints` and `useSwingRecorder.extractKeypoints` duplicate landmark extraction logic; prefer consolidating carefully if touching both.
- The AI coach button is intentionally one-use per capture to avoid duplicate requests.
- The dev benchmark page says it can be removed when no longer needed, but the benchmark script depends on it.
- The pro sample is small, so weights and `metricNotes` matter. Avoid coaching low-priority/camera-dependent metrics as if they were precise biomechanical truth.
- The current UI expects a side-on/down-the-line, waist-height camera setup; changing camera assumptions affects the meaning of nearly every 2D metric.

## Suggested Verification

For ordinary code changes:

```bash
npm run lint
npm run build
```

For capture/UI changes, also run the app and test in a browser with camera permissions:

```bash
npm run dev
```

For metric or benchmark-data changes:

```bash
npm run benchmark:driver
```

Then inspect the rewritten JSON for obviously broken ranges, missing metrics, or timing values that should not be used by the coach.
