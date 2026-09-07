"use client";

import { useEffect } from "react";

export function CodeCopyEnhancer() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".post-content");
    if (!root) return;

    const buttons = root.querySelectorAll<HTMLButtonElement>(".code-block__copy");
    const timers = new Map<HTMLButtonElement, number>();

    const resetAfter = (button: HTMLButtonElement) => {
      const previous = timers.get(button);
      if (previous) window.clearTimeout(previous);
      timers.set(button, window.setTimeout(() => {
        button.textContent = "复制";
        delete button.dataset.copied;
        timers.delete(button);
      }, 1600));
    };

    const copy = async (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const code = button.closest(".code-block")?.querySelector("code")?.textContent;
      if (code === undefined) return;

      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "已复制";
        button.dataset.copied = "true";
        resetAfter(button);
      } catch {
        button.textContent = "复制失败";
        resetAfter(button);
      }
    };

    buttons.forEach((button) => {
      button.hidden = false;
      button.addEventListener("click", copy);
    });

    return () => {
      buttons.forEach((button) => button.removeEventListener("click", copy));
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return null;
}
