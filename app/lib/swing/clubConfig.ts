export const SWING_CLUBS = {
  driver: {
    id: "driver",
    label: "Driver",
    shortLabel: "Driver",
    referenceLabel: "professional driver reference",
  },
  sevenIron: {
    id: "sevenIron",
    label: "7 iron",
    shortLabel: "7 iron",
    referenceLabel: "professional 7-iron reference",
  },
} as const;

export type SwingClubId = keyof typeof SWING_CLUBS;

export function isSwingClubId(value: unknown): value is SwingClubId {
  return typeof value === "string" && value in SWING_CLUBS;
}
