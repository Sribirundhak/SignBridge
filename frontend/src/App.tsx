import React, { useEffect, useRef, useState } from "react";
import "./App.css";

type CameraState = "starting" | "connected" | "denied";

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("starting");

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

  const isConnected = cameraState === "connected";
  const isDenied = cameraState === "denied";

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
            </div>
          </div>
        </section>

        {/* Right: Gesture Output, AI Status, Conversation History */}
        <section className="sb-main-right">
          <div className="sb-card">
            <div className="sb-card-header">
              <h2>Gesture Output</h2>
            </div>
            <div className="sb-gesture-output">
              <p className="sb-gesture-placeholder">
                Detected sign language output will appear here…
              </p>
            </div>
          </div>

          <div className="sb-card">
            <div className="sb-card-header">
              <h2>AI Status</h2>
            </div>
            <div className="sb-ai-status">
              <div className="sb-status-row">
                <span className="sb-dot sb-dot-idle" />
                <span>Model: Idle</span>
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
                <span className="sb-dot sb-dot-idle" />
                <span>Translation: Waiting</span>
              </div>
            </div>
          </div>

          <div className="sb-card sb-history-card">
            <div className="sb-card-header">
              <h2>Conversation History</h2>
            </div>
            <div className="sb-history-list">
              <p className="sb-history-empty">
                No conversation yet. Start signing to begin.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="sb-footer">
        <p>Powered by AI</p>
      </footer>
    </div>
  );
};

export default App;