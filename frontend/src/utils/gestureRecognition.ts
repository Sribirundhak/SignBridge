// Rule-based gesture recognition engine.
//
// Pipeline:
//   MediaPipe -> Hand Landmarks -> recognizeGesture() -> GestureResult
//
// This module is intentionally decoupled from React and MediaPipe specifics —
// it only depends on a plain array of {x, y, z} landmarks — so it can later
// be swapped for a trained TensorFlow/PyTorch classifier behind the same
// GestureRecognizer interface without changing any calling code.

import type {
  Landmark,
  GestureName,
  GestureResult,
  GestureRecognizer,
} from "./gestureTypes";
import { getFingerState, isThumbPointingUp, type FingerState } from "./fingerUtils";

const LABELS: Record<GestureName, string> = {
  HELLO: "HELLO",
  STOP: "STOP",
  YES: "YES",
  POINT: "POINT",
  UNKNOWN: "No Gesture",
  NO_HAND: "No Hand Detected",
};

const result = (gesture: GestureName, confidence: number): GestureResult => ({
  gesture,
  label: LABELS[gesture],
  confidence,
});

/**
 * Each matcher scores how well the current finger state fits a gesture,
 * returning a confidence between 0 and 1. Highest-scoring match above the
 * MIN_CONFIDENCE threshold wins.
 */
type GestureMatcher = (
  fingers: FingerState,
  landmarks: Landmark[]
) => number;

const MIN_CONFIDENCE = 0.6;

const scoreOpenPalm: GestureMatcher = (fingers) => {
  const extendedCount = Object.values(fingers).filter(Boolean).length;
  return extendedCount === 5 ? 1 : extendedCount / 5;
};

const scoreClosedFist: GestureMatcher = (fingers) => {
  const curledCount = Object.values(fingers).filter((v) => !v).length;
  return curledCount === 5 ? 1 : curledCount / 5;
};

const scoreThumbUp: GestureMatcher = (fingers, landmarks) => {
  const othersCurled = [
    !fingers.index,
    !fingers.middle,
    !fingers.ring,
    !fingers.pinky,
  ].filter(Boolean).length;

  if (!fingers.thumb) return 0;
  if (!isThumbPointingUp(landmarks)) return 0;

  // 4 other fingers curled + thumb extended + pointing up = full confidence
  return 0.4 + (othersCurled / 4) * 0.6;
};

const scoreIndexPoint: GestureMatcher = (fingers) => {
  if (!fingers.index) return 0;

  const othersCurled = [!fingers.middle, !fingers.ring, !fingers.pinky].filter(
    Boolean
  ).length;

  return 0.4 + (othersCurled / 3) * 0.6;
};

const MATCHERS: { gesture: GestureName; score: GestureMatcher }[] = [
  { gesture: "HELLO", score: scoreOpenPalm },
  { gesture: "STOP", score: scoreClosedFist },
  { gesture: "YES", score: scoreThumbUp },
  { gesture: "POINT", score: scoreIndexPoint },
];

/**
 * Pure function: landmarks in, gesture result out.
 * Handles the "no hand" case explicitly.
 */
export const recognizeGesture = (
  landmarks: Landmark[] | null
): GestureResult => {
  if (!landmarks || landmarks.length < 21) {
    return result("NO_HAND", 0);
  }

  const fingers = getFingerState(landmarks);

  let best: { gesture: GestureName; confidence: number } = {
    gesture: "UNKNOWN",
    confidence: 0,
  };

  for (const matcher of MATCHERS) {
    const confidence = matcher.score(fingers, landmarks);
    if (confidence > best.confidence) {
      best = { gesture: matcher.gesture, confidence };
    }
  }

  if (best.confidence < MIN_CONFIDENCE) {
    return result("UNKNOWN", best.confidence);
  }

  return result(best.gesture, best.confidence);
};

/**
 * Class wrapper implementing GestureRecognizer, in case the app wants to
 * hold a recognizer instance (e.g. to later swap in a stateful ML model
 * that needs setup/teardown, calibration, or internal smoothing).
 */
export class RuleBasedGestureRecognizer implements GestureRecognizer {
  recognize(landmarks: Landmark[] | null): GestureResult {
    return recognizeGesture(landmarks);
  }
}

export const defaultGestureRecognizer = new RuleBasedGestureRecognizer();