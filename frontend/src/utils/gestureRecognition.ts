// Rule-based gesture detection engine.
//
// Pipeline:
//   MediaPipe -> Hand Landmarks (21 points) -> recognizeGesture() -> GestureResult
//
// This module is intentionally decoupled from React and MediaPipe specifics —
// it only depends on a plain array of {x, y, z} landmarks — so it can later
// be swapped for a trained TensorFlow/PyTorch classifier behind the same
// GestureRecognizer interface without changing any calling code.

import type{
  GestureName,
  GestureResult,
  GestureRecognizer,
} from "./gestureTypes";

import {
  LANDMARK,
  getFingerState,
  getCurledState,
  isThumbPointingUp,
  isPinching,
  isThumbPointingDown
} from "./fingerUtils";

import type { FingerState } from "./fingerUtils";
import type { Landmark } from "./gestureTypes";

const LABELS: Record<GestureName, string> = {
  HELLO: "HELLO",
  STOP: "STOP",
  YES: "YES",
  NO: "NO",   // 👈 idha add pannu
  POINT: "POINT",
  THANK_YOU: "THANK YOU",
  I_LOVE_YOU: "I LOVE YOU",
  OK: "OK",
  PEACE: "PEACE",
  COME: "COME HERE",
  GOOD: "GOOD",
  BAD: "BAD",
  UNKNOWN: "No Gesture",
  NO_HAND: "No Hand Detected",
};

const buildResult = (
  gesture: GestureName,
  confidence: number
): GestureResult => ({
  gesture,
  label: LABELS[gesture],
  confidence,
});

/**
 * Each matcher scores how well the current finger state fits a gesture,
 * returning a confidence between 0 and 1. Highest-scoring match above the
 * MIN_CONFIDENCE threshold wins.
 *
 * IMPORTANT: THANK_YOU, COME, GOOD, and BAD are motion-based signs (they
 * depend on hand trajectory over time, not a single static hand shape).
 * They are intentionally NOT included in MATCHERS below — a single-frame
 * landmark heuristic cannot reliably distinguish them from other static
 * poses, so they remain defined in GestureName for a future motion-based
 * recognizer and will simply never be returned by this rule-based engine
 * (any frame that would otherwise be one of these resolves to UNKNOWN).
 */
type GestureMatcher = (
  fingers: FingerState,
  curled: FingerState,
  landmarks: Landmark[]
) => number;

const MIN_CONFIDENCE = 0.55;

// --- Existing gestures (unchanged behavior) ---------------------------------

// All five fingers extended.
const scoreOpenPalm: GestureMatcher = (
  fingers,
  _curled,
  landmarks
) => {

  // Thumb touching index => probably OK sign
  if (
    isPinching(
      landmarks,
      LANDMARK.THUMB_TIP,
      LANDMARK.INDEX_TIP,
      0.35
    )
  ) {
    return 0;
  }

  const extendedCount =
    Object.values(fingers).filter(Boolean).length;

  return extendedCount === 5 ? 1 : extendedCount / 5;
};

// All five fingers curled into the palm.
const scoreFist: GestureMatcher = (_fingers, curled) => {
  const curledCount = Object.values(curled).filter(Boolean).length;
  return curledCount === 5 ? 1 : curledCount / 5;
};

// Thumb extended and pointing up, other four fingers curled.
const scoreThumbsUp: GestureMatcher = (
  fingers,
  curled,
  landmarks
) => {
  if (!fingers.thumb) return 0;

  if (!isThumbPointingUp(landmarks)) return 0;

  if (
    curled.index &&
    curled.middle &&
    curled.ring &&
    curled.pinky
  ) {
    return 1;
  }

  return 0;
};
const scoreThumbsDown: GestureMatcher = (
  fingers,
  curled,
  landmarks
) => {
  if (!fingers.thumb) return 0;

  if (!isThumbPointingDown(landmarks)) return 0;

  if (
    curled.index &&
    curled.middle &&
    curled.ring &&
    curled.pinky
  ) {
    return 1;
  }

  return 0;
};

const scorePointing: GestureMatcher = (fingers) => {
  if (
    fingers.index &&
    !fingers.middle &&
    !fingers.ring &&
    !fingers.pinky
  ) {
    return 1;
  }

  return 0;
};
// --- New static gestures ------------------------------------------------

// Index + middle extended and spread apart ("V" shape), ring/pinky curled,
// thumb tucked in.

const scorePeace: GestureMatcher = (fingers) => {
  if (
    fingers.index &&
    fingers.middle &&
    !fingers.ring &&
    !fingers.pinky
  ) {
    return 1;
  }

  return 0;
};
// ILY sign: thumb + index + pinky extended, middle + ring curled.
const scoreILoveYou: GestureMatcher = (
  fingers,

) => {

  if (
    fingers.thumb &&
    fingers.index &&
    fingers.pinky &&
    !fingers.middle &&
    !fingers.ring
  ) {
    return 1;
  }

  return 0;
};

// OK sign: thumb tip and index tip pinched together, middle/ring/pinky
// extended and spread out.
const scoreOK: GestureMatcher = (
  fingers,
  _curled,
  landmarks
) => {

  if (
    !isPinching(
      landmarks,
      LANDMARK.THUMB_TIP,
      LANDMARK.INDEX_TIP,
      0.25
    )
  ) {
    return 0;
  }

  if (
    fingers.middle &&
    fingers.ring &&
    fingers.pinky
  ) {
    return 1;
  }

  return 0;
};

const MATCHERS: { gesture: GestureName; score: GestureMatcher }[] = [
  { gesture: "I_LOVE_YOU", score: scoreILoveYou },
  { gesture: "OK", score: scoreOK },
  { gesture: "PEACE", score: scorePeace },
  { gesture: "POINT", score: scorePointing },
  { gesture: "YES", score: scoreThumbsUp },
  { gesture: "NO", score: scoreThumbsDown },
  { gesture: "HELLO", score: scoreOpenPalm },
  { gesture: "STOP", score: scoreFist },
];
/**
 * Pure function: landmarks in, gesture result out.
 * Handles the "no hand" case explicitly.
 */
export const recognizeGesture = (
  landmarks: Landmark[] | null
): GestureResult => {
  if (!landmarks || landmarks.length < 21) {
    return buildResult("NO_HAND", 0);
  }

  const fingers = getFingerState(landmarks);
  const curled = getCurledState(landmarks);

  console.log("Fingers:", fingers);
  console.log("Curled:", curled);

  let best: { gesture: GestureName; confidence: number } = {
    gesture: "UNKNOWN",
    confidence: 0,
  };

  for (const matcher of MATCHERS) {
    const confidence = matcher.score(fingers, curled, landmarks);

    console.log(matcher.gesture, confidence);

    if (confidence > best.confidence) {
      best = {
        gesture: matcher.gesture,
        confidence,
      };
    }
  }

  if (best.confidence < MIN_CONFIDENCE) {
    return buildResult("UNKNOWN", best.confidence);
  }

  return buildResult(best.gesture, best.confidence);
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