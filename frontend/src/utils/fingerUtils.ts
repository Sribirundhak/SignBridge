// Low-level geometry helpers shared by gesture recognizers.
// Based on the standard 21-point MediaPipe Hands landmark model.

import type { Landmark } from "./gestureTypes";

export const LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const distance = (a: Landmark, b: Landmark): number =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

/**
 * A finger is treated as "extended" when its fingertip is meaningfully
 * farther from the wrist than its MCP (knuckle) joint. This is a simple,
 * rotation-tolerant heuristic that works well for a hand facing the camera.
 */
export const isFingerExtended = (
  landmarks: Landmark[],
  tipIdx: number,
  mcpIdx: number,
  threshold = 1.2
): boolean => {
  const wrist = landmarks[LANDMARK.WRIST];
  const tipDist = distance(landmarks[tipIdx], wrist);
  const mcpDist = distance(landmarks[mcpIdx], wrist);
  return tipDist > mcpDist * threshold;
};

export interface FingerState {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

/**
 * Returns which of the five fingers are currently extended.
 */
export const getFingerState = (landmarks: Landmark[]): FingerState => {
  return {
    thumb: isFingerExtended(
      landmarks,
      LANDMARK.THUMB_TIP,
      LANDMARK.THUMB_MCP,
      1.1
    ),
    index: isFingerExtended(landmarks, LANDMARK.INDEX_TIP, LANDMARK.INDEX_MCP),
    middle: isFingerExtended(
      landmarks,
      LANDMARK.MIDDLE_TIP,
      LANDMARK.MIDDLE_MCP
    ),
    ring: isFingerExtended(landmarks, LANDMARK.RING_TIP, LANDMARK.RING_MCP),
    pinky: isFingerExtended(landmarks, LANDMARK.PINKY_TIP, LANDMARK.PINKY_MCP),
  };
};

/**
 * True when the thumb tip sits clearly above the wrist (screen-space "up"),
 * used to disambiguate a "thumbs up" from a thumb merely extended sideways.
 */
export const isThumbPointingUp = (landmarks: Landmark[]): boolean => {
  const thumbTip = landmarks[LANDMARK.THUMB_TIP];
  const wrist = landmarks[LANDMARK.WRIST];
  return thumbTip.y < wrist.y;
};