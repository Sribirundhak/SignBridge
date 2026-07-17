import React, { useEffect, useRef, useState } from "react";
import "./App.css";
import type {
  GestureName,
  GestureResult,
} from "./utils/gestureTypes";

import { defaultGestureRecognizer } from "./utils/gestureRecognition";

type CameraState = "starting" | "connected" | "denied";

interface HistoryEntry {
  id: string;
  gesture: GestureName;
  label: string;
  confidence: number;
  timestamp: number;
}

const MAX_HISTORY = 20;
const STABLE_DURATION_MS = 1000; // gesture must hold for 1s
const MIN_HISTORY_CONFIDENCE = 0.8;
const CURRENT_GESTURE_RESET_MS = 2000; // reset to "Waiting..." after 2s idle
const FRAME_BUFFER_SIZE = 5; // rolling buffer holds the last 5 raw predictions
const CONSECUTIVE_CONFIRM_COUNT = 3; // gesture must appear 3 consecutive frames within that buffer to be confirmed

// Gestures that count as "real" detections (excludes UNKNOWN / NO_HAND)
const RECOGNIZED_GESTURES: GestureName[] = [
  "HELLO",
  "STOP",
  "YES",
  "NO",
  "POINT",
  "PEACE",
  "I_LOVE_YOU",
  "OK",
];

const loadScript = (src: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handsRef = useRef<any>(null);

  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [handDetected, setHandDetected] = useState(false);
  const [handsReady, setHandsReady] = useState(false);

  // Live gesture shown in the "Gesture Output" card (resets to "Waiting..." after idle)
  const [displayedGesture, setDisplayedGesture] = useState<GestureResult | null>(
    null
  );

  // Committed conversation history (newest first)
  const [gestureHistory, setGestureHistory] = useState<HistoryEntry[]>([]);

  // --- Refs for stability tracking / debouncing (do not trigger re-renders) ---
  const stableGestureRef = useRef<{ gesture: GestureName; startTime: number } | null>(
    null
  );
  const lastAddedGestureRef = useRef<GestureName | null>(null);
  const displayResetTimeoutRef = useRef<number | null>(null);

  // --- Ref for rolling-buffer frame smoothing (requirement 1) ---
  // Holds the last FRAME_BUFFER_SIZE (5) raw MediaPipe predictions in a
  // FIFO window. A gesture is only forwarded to the existing
  // handleGestureFrame() pipeline once it occupies the most recent
  // CONSECUTIVE_CONFIRM_COUNT (3) consecutive slots of that buffer —
  // filtering single/double-frame jitter without touching the recognizer.
  const frameBufferRef = useRef<GestureName[]>([]);

  // Start webcam
  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setCameraState("connected");
      } catch (err) {
        if (!cancelled) {
          setCameraState("denied");
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Clear the "Current Gesture" reset timer on unmount
  useEffect(() => {
    return () => {
      if (displayResetTimeoutRef.current !== null) {
        window.clearTimeout(displayResetTimeoutRef.current);
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /**
   * Rolling-buffer frame smoothing (requirements 1 & 2).
   * Consumes the *raw*, unmodified output of defaultGestureRecognizer.recognize()
   * every frame, pushes it into a FIFO buffer of the last 5 predictions, and
   * only lets a gesture through once it fills the most recent 3 consecutive
   * slots of that buffer. Until then it reports "NO_HAND" downstream, which
   * the existing handleGestureFrame() logic already treats as "no detection"
   * (breaking any in-progress stability streak) — so no changes were needed
   * to that function's logic.
   */
  const smoothGesture = (raw: GestureResult): GestureResult => {
    const buffer = frameBufferRef.current;

    buffer.push(raw.gesture);
    if (buffer.length > FRAME_BUFFER_SIZE) {
      buffer.shift(); // keep only the last FRAME_BUFFER_SIZE predictions
    }

    const mostRecent = buffer.slice(-CONSECUTIVE_CONFIRM_COUNT);
    const isConfirmed =
      mostRecent.length === CONSECUTIVE_CONFIRM_COUNT &&
      mostRecent.every((gesture) => gesture === raw.gesture);

    if (isConfirmed) {
      return raw;
    }

    return { gesture: "NO_HAND", label: "No Hand Detected", confidence: 0 };
  };

  /**
   * Speech synthesis (requirement 3).
   * Speaks a gesture label using the browser SpeechSynthesis API.
   * Wrapped defensively since SpeechSynthesis support/availability can vary.
   */
  const speakGesture = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel(); // avoid queued/overlapping utterances
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    } catch {
      // ignore speech synthesis errors (e.g. unsupported browsers)
    }
  };

  /**
   * Called on every recognized gesture frame.
   * Handles:
   *  - Live "Current Gesture" display + its 2s idle reset.
   *  - Committing a gesture to history once it has been held stably
   *    for >= 1s with confidence >= 0.8, ignoring consecutive duplicates.
   */
  const handleGestureFrame = (gesture: GestureResult) => {
    const now = Date.now();
    const isRecognized = RECOGNIZED_GESTURES.includes(gesture.gesture);

    if (isRecognized) {
      // Update live display + restart the 2s idle reset timer.
      setDisplayedGesture(gesture);
      if (displayResetTimeoutRef.current !== null) {
        window.clearTimeout(displayResetTimeoutRef.current);
      }
      displayResetTimeoutRef.current = window.setTimeout(() => {
        setDisplayedGesture(null);
      }, CURRENT_GESTURE_RESET_MS);

      // Track how long this gesture has been held continuously.
      if (stableGestureRef.current?.gesture === gesture.gesture) {
        // same gesture as last frame -> keep the original startTime
      } else {
        stableGestureRef.current = { gesture: gesture.gesture, startTime: now };
      }

      const elapsed = now - (stableGestureRef.current?.startTime ?? now);
      const heldLongEnough = elapsed >= STABLE_DURATION_MS;
      const confident = gesture.confidence >= MIN_HISTORY_CONFIDENCE;
      const isDuplicateConsecutive =
        lastAddedGestureRef.current === gesture.gesture;

      if (heldLongEnough && confident && !isDuplicateConsecutive) {
        const entry: HistoryEntry = {
          id: `${now}-${gesture.gesture}`,
          gesture: gesture.gesture,
          label: gesture.label,
          confidence: gesture.confidence,
          timestamp: now,
        };

        setGestureHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));
        lastAddedGestureRef.current = gesture.gesture;
        speakGesture(gesture.label); // requirement 3: speak on new confirmation
      }
    } else {
      // No hand / unknown gesture -> stability streak is broken.
      stableGestureRef.current = null;
    }
  };

  // Load MediaPipe Hands (via CDN, no npm install) and set up detection
  useEffect(() => {
    let isMounted = true;
    let handsInstance: any;

    const initHands = async () => {
      try {
        await loadScript(
          "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"
        );
        await loadScript(
          "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js"
        );

        if (!isMounted) return;

        const w = window as any;
        handsInstance = new w.Hands({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        handsInstance.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        handsInstance.onResults((results: any) => {
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (!canvas || !video) return;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const hasHand =
            results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

          if (hasHand) {
            setHandDetected(true);
            const landmarks = results.multiHandLandmarks[0];

            for (const handLandmarks of results.multiHandLandmarks) {
              w.drawConnectors(ctx, handLandmarks, w.HAND_CONNECTIONS, {
                color: "#6d5bff",
                lineWidth: 3,
              });
              w.drawLandmarks(ctx, handLandmarks, {
                color: "#2fd67a",
                lineWidth: 1,
                radius: 4,
              });
            }

            // MediaPipe -> Hand Landmarks -> Gesture Detection Function
            const gesture = defaultGestureRecognizer.recognize(landmarks);
            handleGestureFrame(smoothGesture(gesture));
          } else {
            setHandDetected(false);
            handleGestureFrame(smoothGesture(defaultGestureRecognizer.recognize(null)));
          }

          ctx.restore();
        });

        handsRef.current = handsInstance;
        if (isMounted) setHandsReady(true);
      } catch (err) {
        if (isMounted) setHandsReady(false);
      }
    };

    initHands();

    return () => {
      isMounted = false;
      if (handsInstance) {
        handsInstance.close?.();
      }
      handsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame loop: feed video frames to MediaPipe Hands while camera is connected
  useEffect(() => {
    let rafId: number;
    let cancelled = false;

    const detectLoop = async () => {
      if (
        !cancelled &&
        cameraState === "connected" &&
        handsReady &&
        handsRef.current &&
        videoRef.current &&
        videoRef.current.readyState >= 2
      ) {
        try {
          await handsRef.current.send({ image: videoRef.current });
        } catch {
          // ignore transient send errors (e.g. during teardown)
        }
      }
      rafId = requestAnimationFrame(detectLoop);
    };

    rafId = requestAnimationFrame(detectLoop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [cameraState, handsReady]);

  const isConnected = cameraState === "connected";
  const isDenied = cameraState === "denied";

  const modelStatus = !handsReady
    ? "Loading"
    : isConnected
    ? "Detecting"
    : "Ready";
  const modelStatusActive = modelStatus === "Detecting";

  const confidencePercent = displayedGesture
    ? Math.round(displayedGesture.confidence * 100)
    : null;

  // Requirement 4: sentence built from history, oldest -> newest
  // (gestureHistory itself stays newest-first, unchanged, for the list UI).
  const sentence = gestureHistory.length
    ? [...gestureHistory].reverse().map((entry) => entry.label).join(" ")
    : "";

  // Requirement 7: Clear
  const handleClearConversation = () => {
    setGestureHistory([]);
    lastAddedGestureRef.current = null;
    frameBufferRef.current = []; // reset rolling smoothing buffer too
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  // Requirement 8: Export History as conversation.txt
  const handleExportConversation = () => {
    if (gestureHistory.length === 0) return;

    const chronological = [...gestureHistory].reverse();
    const lines = chronological.map(
      (entry) =>
        `[${formatTime(entry.timestamp)}] ${entry.label} (${Math.round(
          entry.confidence * 100
        )}%)`
    );
    const content = `SignBridge AI - Conversation Export\n\nSentence: ${sentence}\n\n${lines.join(
      "\n"
    )}\n`;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "conversation.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sb-app">
      {/* Header */}
      <header className="sb-header">
        <div className="sb-header-left">
          <div className="sb-logo-placeholder" aria-label="SignBridge AI logo">
            <span>SB</span>
          </div>
          <div className="sb-title-group">
            <h1 className="sb-title">SignBridge AI</h1>
            <p className="sb-subtitle">
              Breaking communication barriers between Deaf and Hearing people.
            </p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="sb-main">
        {/* Left: Webcam */}
        <section className="sb-main-left">
          <div className="sb-card sb-webcam-card">
            <div className="sb-card-header">
              <h2>Webcam Feed</h2>
            </div>
            <div className="sb-webcam-placeholder">
              <video
                ref={videoRef}
                className="sb-webcam-video"
                autoPlay
                playsInline
                muted
                style={{ display: isConnected ? "block" : "none" }}
              />

              {isConnected && (
                <canvas ref={canvasRef} className="sb-webcam-canvas" />
              )}

              {!isConnected && (
                <>
                  <div className="sb-webcam-icon" aria-hidden="true">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M17 10.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5l4 4v-11l-4 4Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <p className="sb-webcam-text">
                    {isDenied
                      ? "Camera access denied."
                      : "Starting camera..."}
                  </p>
                </>
              )}

              <span
                className={`sb-badge ${
                  isConnected ? "sb-badge-connected" : "sb-badge-idle"
                }`}
              >
                {isConnected ? "Connected" : "Not connected"}
              </span>

              {isConnected && (
                <span
                  className={`sb-badge sb-hand-badge ${
                    handDetected ? "sb-badge-connected" : "sb-badge-idle"
                  }`}
                >
                  {handDetected ? "Hand Detected" : "No Hand Detected"}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Right: Gesture Output, AI Status, Conversation History */}
        <section className="sb-main-right">
          <div className="sb-card">
            <div className="sb-card-header">
              <h2>Gesture Output</h2>
            </div>
            {displayedGesture ? (
              <div className="sb-gesture-result">
                <div className="sb-gesture-row">
                  <span className="sb-gesture-key">Current Gesture:</span>
                  <span className="sb-gesture-value">
                    {displayedGesture.label}
                  </span>
                </div>
                <div className="sb-gesture-row">
                  <span className="sb-gesture-key">Confidence:</span>
                  <span className="sb-gesture-value">
                    {confidencePercent}%
                  </span>
                </div>
              </div>
            ) : (
              <div className="sb-gesture-output">
                <p className="sb-gesture-placeholder">Waiting...</p>
              </div>
            )}
          </div>

          <div className="sb-card">
            <div className="sb-card-header">
              <h2>AI Status</h2>
            </div>
            <div className="sb-ai-status">
              <div className="sb-status-row">
                <span
                  className={`sb-dot ${
                    modelStatusActive ? "sb-dot-connected" : "sb-dot-idle"
                  }`}
                />
                <span>Model: {modelStatus}</span>
              </div>
              <div className="sb-status-row">
                <span
                  className={`sb-dot ${
                    isConnected ? "sb-dot-connected" : "sb-dot-idle"
                  }`}
                />
                <span>Camera: {isConnected ? "Connected" : "Disconnected"}</span>
              </div>
              <div className="sb-status-row">
                <span
                  className={`sb-dot ${
                    handDetected ? "sb-dot-connected" : "sb-dot-idle"
                  }`}
                />
                <span>
                  Translation: {handDetected ? "Detecting" : "Waiting"}
                </span>
              </div>
            </div>
          </div>

          <div className="sb-card sb-sentence-card">
            <div className="sb-card-header">
              <h2>Sentence</h2>
            </div>
            <p className="sb-sentence-text">
              {sentence || "No sentence yet."}
            </p>
            <div className="sb-sentence-actions">
              <button
                type="button"
                className="sb-btn sb-btn-secondary"
                onClick={handleClearConversation}
                disabled={gestureHistory.length === 0}
                aria-label="Clear conversation history"
              >
                Clear
              </button>
              <button
                type="button"
                className="sb-btn sb-btn-primary"
                onClick={handleExportConversation}
                disabled={gestureHistory.length === 0}
                aria-label="Export conversation history as a text file"
              >
                Export History
              </button>
            </div>
          </div>

          <div className="sb-card sb-history-card">
            <div className="sb-card-header">
              <h2>Conversation History</h2>
            </div>
            {gestureHistory.length === 0 ? (
              <div className="sb-history-list">
                <p className="sb-history-empty">
                  No conversation yet. Start signing to begin.
                </p>
              </div>
            ) : (
              <div className="sb-history-items">
                {gestureHistory.map((entry) => (
                  <div key={entry.id} className="sb-history-item">
                    <span className="sb-history-item-label">
                      {entry.label}
                    </span>
                    <span className="sb-history-item-meta">
                      {Math.round(entry.confidence * 100)}% ·{" "}
                      {formatTime(entry.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="sb-footer">
        <p>Powered by Sri</p>
      </footer>
    </div>
  );
};

export default App;