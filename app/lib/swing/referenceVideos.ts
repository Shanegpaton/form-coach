import type { SwingClubId } from "./clubConfig";

export type ReferenceSwingVideo = {
  label: string;
  src: string;
};

export const DRIVER_BENCHMARK_VIDEO_URLS = [
  "/swings/Driver/billyDriver.mp4",
  "/swings/Driver/danDriver.mp4",
  "/swings/Driver/ianDriver.mp4",
  "/swings/Driver/rickieDriver.mp4",
] as const;

export const SEVEN_IRON_BENCHMARK_VIDEO_URLS = [
  "/swings/Iron%20Swings/justinThomas.mp4",
  "/swings/Iron%20Swings/louisOosthuizen.mp4",
  "/swings/Iron%20Swings/matteoManassero.mp4",
] as const;

export const REFERENCE_SWINGS_BY_CLUB: Record<SwingClubId, ReferenceSwingVideo[]> = {
  driver: [
    { label: "Billy driver", src: DRIVER_BENCHMARK_VIDEO_URLS[0] },
    { label: "Dan driver", src: DRIVER_BENCHMARK_VIDEO_URLS[1] },
    { label: "Ian driver", src: DRIVER_BENCHMARK_VIDEO_URLS[2] },
    { label: "Rickie driver", src: DRIVER_BENCHMARK_VIDEO_URLS[3] },
  ],
  sevenIron: [
    { label: "Justin Thomas 7 iron", src: SEVEN_IRON_BENCHMARK_VIDEO_URLS[0] },
    { label: "Louis Oosthuizen 7 iron", src: SEVEN_IRON_BENCHMARK_VIDEO_URLS[1] },
    { label: "Matteo Manassero 7 iron", src: SEVEN_IRON_BENCHMARK_VIDEO_URLS[2] },
  ],
};
