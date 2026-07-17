// Core types for the gesture recognition system.
// Kept separate so any future ML-based recognizer can share the same contracts.

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type GestureName =
  | "HELLO"
  | "STOP"
  | "YES"
  | "NO"
  | "POINT"
  | "PEACE"
  | "I_LOVE_YOU"
  | "OK"
  | "THANK_YOU"
  | "GOOD"
  | "BAD"
  | "COME"
  | "UNKNOWN"
  | "NO_HAND";


export interface GestureResult {
  gesture: GestureName;
  label: string; // Human-readable output, e.g. "HELLO"
  confidence: number; // 0 - 1
}

/**
 * Common interface for anything that can turn hand landmarks into a gesture.
 * The current implementation is rule-based. A future TensorFlow/PyTorch
 * powered recognizer can implement this same interface and be swapped in
 * without touching any UI code.
 */
export interface GestureRecognizer {
  recognize(landmarks: Landmark[] | null): GestureResult;
}