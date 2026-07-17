// Low-level geometry helpers shared by gesture recognizers.
// Based on the standard 21-point MediaPipe Hands landmark model.

import type{ Landmark } from "./gestureTypes";
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
  mcpIdx: number
): boolean => {
  // Thumb is sideways, so X-axis works better
  if (tipIdx === LANDMARK.THUMB_TIP) {
  return distance(
    landmarks[LANDMARK.THUMB_TIP],
    landmarks[LANDMARK.THUMB_MCP]
  ) > 0.10;
}

  // Other fingers: tip should be above MCP
  return (
    landmarks[tipIdx].y <
    landmarks[mcpIdx].y
  );
};
/**
 * A finger is treated as "curled" when its tip sits close to (or below,
 * in landmark-distance terms) its PIP joint distance from the wrist —
 * i.e. the tip has folded back toward the palm.
 */
export const isFingerCurled = (
  landmarks: Landmark[],
  tipIdx: number,
  pipIdx: number
): boolean => {
  const wrist = landmarks[LANDMARK.WRIST];
  const tipDist = distance(landmarks[tipIdx], wrist);
  const pipDist = distance(landmarks[pipIdx], wrist);
  return tipDist <= pipDist * 1.05;
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
 * Returns which of the five fingers are currently curled (folded into palm).
 * Not simply the inverse of getFingerState — uses PIP-relative distance so
 * it stays reliable even in ambiguous "half-open" hand poses.
 */
export const getCurledState = (landmarks: Landmark[]): FingerState => {
  return {
    thumb: isFingerCurled(landmarks, LANDMARK.THUMB_TIP, LANDMARK.THUMB_IP),
    index: isFingerCurled(landmarks, LANDMARK.INDEX_TIP, LANDMARK.INDEX_PIP),
    middle: isFingerCurled(
      landmarks,
      LANDMARK.MIDDLE_TIP,
      LANDMARK.MIDDLE_PIP
    ),
    ring: isFingerCurled(landmarks, LANDMARK.RING_TIP, LANDMARK.RING_PIP),
    pinky: isFingerCurled(landmarks, LANDMARK.PINKY_TIP, LANDMARK.PINKY_PIP),
  };
};

/**
 * True when the thumb tip sits clearly above the wrist (screen-space "up"),
 * used to disambiguate a "thumbs up" from a thumb merely extended sideways.
 */
export const isThumbPointingUp = (landmarks: Landmark[]): boolean => {
  return (
    landmarks[LANDMARK.THUMB_TIP].y <
    landmarks[LANDMARK.THUMB_IP].y
  );
};

/**
 * True when the thumb tip sits clearly below the wrist (screen-space
 * "down"), reserved for a possible future "thumbs down" gesture.
 */
export const isThumbPointingDown = (landmarks: Landmark[]): boolean => {
  return (
    landmarks[LANDMARK.THUMB_TIP].y >
    landmarks[LANDMARK.THUMB_IP].y
  );
};

/**
 * Distance between two fingertips, normalized by hand size (wrist-to-
 * middle-MCP distance), so the metric stays consistent regardless of how
 * close the hand is to the camera.
 */
export const normalizedTipDistance = (
  landmarks: Landmark[],
  tip1: number,
  tip2: number
): number => {
  const handSize = distance(
    landmarks[LANDMARK.WRIST],
    landmarks[LANDMARK.MIDDLE_MCP]
  );

  if (handSize === 0) return 0;

  return distance(landmarks[tip1], landmarks[tip2]) / handSize;
};

/**
 * True when two fingertips are close enough together to be considered
 * "pinched" (e.g. thumb + index forming the ring of an OK sign).
 */
export const isPinching = (
  landmarks: Landmark[],
  point1: number,
  point2: number,
  threshold = 0.35
): boolean => {
  return (
    normalizedTipDistance(landmarks, point1, point2) < threshold
  );
};
