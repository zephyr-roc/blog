"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GLASS_MOTION_RESET_EVENT,
  GLASS_MOTION_TILT_EVENT,
  type MotionTiltDetail,
} from "./motionTilt";

type MotionStatus = "idle" | "requesting" | "active" | "denied";

type OrientationEventConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

const clamp = (value: number) => Math.max(-1, Math.min(1, value));
const MOTION_FRAME_INTERVAL = 1000 / 30;

export function MotionTiltControl() {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<MotionStatus>("idle");
  const baseline = useRef<{ beta: number; gamma: number } | null>(null);
  const filteredTilt = useRef({ x: 0, y: 0 });
  const targetTilt = useRef({ x: 0, y: 0 });
  const animationFrame = useRef<number | null>(null);
  const lastEmission = useRef(0);
  const listening = useRef(false);

  const emitReset = useCallback(() => {
    window.dispatchEvent(new Event(GLASS_MOTION_RESET_EVENT));
  }, []);

  const recalibrate = useCallback(() => {
    baseline.current = null;
    filteredTilt.current = { x: 0, y: 0 };
    targetTilt.current = { x: 0, y: 0 };
  }, []);

  const handleOrientation = useCallback((event: globalThis.DeviceOrientationEvent) => {
    if (event.beta === null || event.gamma === null) return;

    if (!baseline.current) {
      baseline.current = { beta: event.beta, gamma: event.gamma };
      return;
    }

    const deltaBeta = event.beta - baseline.current.beta;
    const deltaGamma = event.gamma - baseline.current.gamma;
    const legacyAngle = (window as Window & { orientation?: number }).orientation ?? 0;
    const angle = ((window.screen.orientation?.angle ?? legacyAngle) + 360) % 360;
    let horizontal = deltaGamma;
    let vertical = deltaBeta;

    if (angle === 90) {
      horizontal = deltaBeta;
      vertical = -deltaGamma;
    } else if (angle === 270) {
      horizontal = -deltaBeta;
      vertical = deltaGamma;
    } else if (angle === 180) {
      horizontal = -deltaGamma;
      vertical = -deltaBeta;
    }

    targetTilt.current = {
      x: clamp(horizontal / 18),
      y: clamp(vertical / 18),
    };

    if (animationFrame.current !== null) return;
    const flushTilt = (time: number) => {
      if (time - lastEmission.current < MOTION_FRAME_INTERVAL) {
        animationFrame.current = window.requestAnimationFrame(flushTilt);
        return;
      }

      animationFrame.current = null;
      lastEmission.current = time;
      const previous = filteredTilt.current;
      const smoothing = 0.22;
      const next = {
        x: previous.x + (targetTilt.current.x - previous.x) * smoothing,
        y: previous.y + (targetTilt.current.y - previous.y) * smoothing,
      };
      filteredTilt.current = next;
      if (Math.abs(next.x - previous.x) < 0.002 && Math.abs(next.y - previous.y) < 0.002) {
        return;
      }
      window.dispatchEvent(
        new CustomEvent<MotionTiltDetail>(GLASS_MOTION_TILT_EVENT, {
          detail: next,
        }),
      );
    };
    animationFrame.current = window.requestAnimationFrame(flushTilt);
  }, []);

  const stopListening = useCallback(() => {
    if (listening.current) {
      window.removeEventListener("deviceorientation", handleOrientation);
      window.removeEventListener("orientationchange", recalibrate);
      listening.current = false;
    }
    if (animationFrame.current !== null) {
      window.cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
    recalibrate();
    lastEmission.current = 0;
    emitReset();
  }, [emitReset, handleOrientation, recalibrate]);

  const startListening = useCallback(() => {
    if (listening.current) return;
    recalibrate();
    window.addEventListener("deviceorientation", handleOrientation, { passive: true });
    window.addEventListener("orientationchange", recalibrate, { passive: true });
    listening.current = true;
  }, [handleOrientation, recalibrate]);

  useEffect(() => {
    const availabilityFrame = window.requestAnimationFrame(() => {
      setAvailable(window.isSecureContext && "DeviceOrientationEvent" in window);
    });
    return () => {
      window.cancelAnimationFrame(availabilityFrame);
      stopListening();
    };
  }, [stopListening]);

  const toggleMotion = async () => {
    if (status === "active") {
      stopListening();
      setStatus("idle");
      return;
    }

    setStatus("requesting");
    try {
      const OrientationEvent = window.DeviceOrientationEvent as OrientationEventConstructor;
      const permission = typeof OrientationEvent.requestPermission === "function"
        ? await OrientationEvent.requestPermission()
        : "granted";

      if (permission !== "granted") {
        setStatus("denied");
        return;
      }

      startListening();
      setStatus("active");
    } catch {
      setStatus("denied");
    }
  };

  if (!available) return null;

  const label = status === "active"
    ? "体感旋转已开启"
    : status === "requesting"
      ? "正在请求体感权限"
      : status === "denied"
        ? "体感权限未开启"
        : "启用体感旋转";

  return (
    <div className="motion-tilt-control" aria-live="polite">
      <button
        className="motion-tilt-control__button"
        type="button"
        data-state={status}
        aria-pressed={status === "active"}
        disabled={status === "requesting"}
        onClick={toggleMotion}
      >
        <span className="motion-tilt-control__sensor" aria-hidden="true" />
        {label}
      </button>
    </div>
  );
}
