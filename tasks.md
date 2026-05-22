# TASKS.md

## Current Priorities

### 1. Rework AI Coach. - drafted

**Goal:** Allow users to receive custom golf swing drills and coaching based on their swing metrics. Users should also be able to talk with their AI coach and provide extra context about what they are struggling with.

#### Tasks
- Run swing analysis benchmarks and extract key values:
  - swing path
  - knee angle
  - spine angle
  - hip movement
  - shoulder movement
  - tempo/timing metrics
- Display the key benchmarks to the user.
- Clearly explain what the system determined from the metrics.
- Allow users to edit or correct benchmark interpretations.
  - Example: “I came through too steep.”
  - Example: “My posture was too upright.”
  - Example: “My knees were too bent.”
- Use both system-generated metrics and user feedback to generate:
  - custom drills
  - coaching tips
  - swing improvement priorities
- Allow the user to chat with the AI coach about specific swing issues.

---

## Bugs

### Frame impact
- the impact frame on the pose is at the perfect time, however in the video it seems to be about 100-175ms late. The frames clearly line up, but the top of the backswing and impact markers are at different times for the video and the pose. currently both the pose and video are the exact same lenghts. Some research into the 200ms lead for the video may be needed, as it does not seems to be diffrent between the two. The swing currently starts at the perfect time for both the pose and video and should not be changed.

### Video / Pose Switching
- After switching between pose mode and video mode, the first few frames sometimes show the first frame of the recording not the swing. It switches to the first frames of the swing after watching it.

### Timeline / Slider
- The video slider sometimes gets out of sync.
- The slider does not always reach the end when the video finishes mainly after the users slides it around.

### Pose Tracking
- Sometimes pose tracking gets stuck on the first detected position.
- Tracking may stop updating even while the video continues.
- this problem only is on my phone which is a 60fps camera

---

## Agent Instructions

Before making changes:
1. Inspect the relevant files.
2. Explain the current architecture.
3. Propose a plan.
4. Implement only the requested task.
5. Avoid unrelated UI or architecture changes.
6. Run lint/tests if available.
