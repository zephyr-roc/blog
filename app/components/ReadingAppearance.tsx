"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Glass, type GlassOptics } from "./liquid-glass";

const STORAGE_KEY = "blog-reading-appearance:v1";
const DEFAULT_BACKGROUND = "#08070f";
const DEFAULT_TEXT = "#f7f4ff";

const readingAppearanceTriggerOptics: Partial<GlassOptics> = {
  strength: .2,
  scaleX: .22,
  scaleY: .18,
  depth: .92,
  curvature: .72,
  bend: .88,
  bendWidth: .28,
  dispersion: 0,
  frost: 1,
  saturate: 1.35,
  specular: 0,
  sheen: 0,
  sheenWidth: 2.5,
  glow: 0,
};

const readingAppearancePanelOptics: Partial<GlassOptics> = {
  strength: .14,
  scaleX: .16,
  scaleY: .12,
  depth: .92,
  curvature: .42,
  bend: .8,
  bendWidth: .18,
  dispersion: 0,
  frost: 4,
  saturate: 1.3,
  specular: 0,
  sheen: 0,
  sheenWidth: 3,
  glow: 0,
};

type TextMode = "auto" | "manual";

type ReadingAppearanceState = {
  background: string;
  text: string;
  textMode: TextMode;
  customized: boolean;
};

const defaultState: ReadingAppearanceState = {
  background: DEFAULT_BACKGROUND,
  text: DEFAULT_TEXT,
  textMode: "auto",
  customized: false,
};

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= .04045
      ? value / 12.92
      : ((value + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

function automaticTextColor(background: string) {
  return relativeLuminance(background) >= .24 ? "#17131e" : DEFAULT_TEXT;
}

function initialState(): ReadingAppearanceState {
  if (typeof window === "undefined") return defaultState;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const saved = JSON.parse(raw) as Partial<ReadingAppearanceState>;
    if (!isHexColor(saved.background) || !isHexColor(saved.text)) {
      return defaultState;
    }
    return {
      background: saved.background.toLowerCase(),
      text: saved.text.toLowerCase(),
      textMode: saved.textMode === "manual" ? "manual" : "auto",
      customized: true,
    };
  } catch {
    return defaultState;
  }
}

export function ReadingAppearance() {
  const [appearance, setAppearance] = useState(initialState);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>(".post-shell");
    if (!shell) return;

    if (!appearance.customized) {
      delete shell.dataset.readingAppearance;
      shell.style.removeProperty("--reading-background");
      shell.style.removeProperty("--reading-text");
      return;
    }

    shell.dataset.readingAppearance = "custom";
    shell.style.setProperty("--reading-background", appearance.background);
    shell.style.setProperty("--reading-text", appearance.text);
  }, [appearance]);

  useEffect(() => {
    if (!appearance.customized) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        background: appearance.background,
        text: appearance.text,
        textMode: appearance.textMode,
      }),
    );
  }, [appearance]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const setBackground = (background: string) => {
    setAppearance((current) => ({
      ...current,
      background,
      text: current.textMode === "auto"
        ? automaticTextColor(background)
        : current.text,
      customized: true,
    }));
  };

  const setText = (text: string) => {
    setAppearance((current) => ({
      ...current,
      text,
      textMode: "manual",
      customized: true,
    }));
  };

  const setAutomaticText = (automatic: boolean) => {
    setAppearance((current) => ({
      ...current,
      text: automatic ? automaticTextColor(current.background) : current.text,
      textMode: automatic ? "auto" : "manual",
      customized: true,
    }));
  };

  return (
    <div ref={rootRef} className="reading-appearance" data-open={open}>
      <Glass
        className="reading-appearance__trigger-glass"
        radius={999}
        optics={readingAppearanceTriggerOptics}
        aria-hidden="true"
      >
        <span className="reading-appearance__trigger-tint" />
      </Glass>
      <button
        ref={triggerRef}
        className="reading-appearance__trigger"
        type="button"
        aria-label={open ? "关闭阅读外观设置" : "打开阅读外观设置"}
        aria-expanded={open}
        aria-controls="reading-appearance-panel"
        title="阅读外观"
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.25a8.75 8.75 0 1 0 0 17.5h1.2a1.8 1.8 0 0 0 0-3.6h-.9a1.55 1.55 0 0 1 0-3.1h2.45A5.25 5.25 0 0 0 20 8.8C20 5.73 16.42 3.25 12 3.25Z" />
          <circle cx="7.8" cy="9.1" r=".8" />
          <circle cx="10.1" cy="6.8" r=".8" />
          <circle cx="14" cy="6.8" r=".8" />
          <circle cx="16.4" cy="9.2" r=".8" />
        </svg>
      </button>

      {open ? (
        <Glass
          id="reading-appearance-panel"
          className="reading-appearance__panel"
          radius={18}
          optics={readingAppearancePanelOptics}
          role="dialog"
          aria-label="阅读外观"
        >
          <span className="reading-appearance__panel-tint" aria-hidden="true" />
          <div className="reading-appearance__panel-content">
            <header>
              <strong>阅读外观</strong>
              <span>仅应用于文章页面</span>
            </header>

            <label className="reading-appearance__color">
              <span>页面背景</span>
              <input
                type="color"
                value={appearance.background}
                onChange={(event) => setBackground(event.currentTarget.value)}
              />
            </label>

            <label className="reading-appearance__color">
              <span>正文文字</span>
              <input
                type="color"
                value={appearance.text}
                onChange={(event) => setText(event.currentTarget.value)}
              />
            </label>

            <label className="reading-appearance__automatic">
              <input
                type="checkbox"
                checked={appearance.textMode === "auto"}
                onChange={(event) => setAutomaticText(event.currentTarget.checked)}
              />
              <span>文字颜色跟随背景</span>
            </label>

            <button
              className="reading-appearance__reset"
              type="button"
              onClick={() => setAppearance(defaultState)}
            >
              恢复默认
            </button>
          </div>
        </Glass>
      ) : null}
    </div>
  );
}
