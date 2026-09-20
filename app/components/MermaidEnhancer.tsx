"use client";

import { useEffect } from "react";

export function MermaidEnhancer({ contentVersion }: { contentVersion: string }) {
  useEffect(() => {
    const diagrams = Array.from(
      document.querySelectorAll<HTMLElement>("[data-mermaid-diagram]"),
    );
    if (diagrams.length === 0) return;

    let disposed = false;

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      if (disposed) return;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "base",
        flowchart: {
          htmlLabels: true,
          useMaxWidth: true,
        },
        themeVariables: {
          background: "transparent",
          primaryColor: "transparent",
          primaryBorderColor: "#8c8796",
          primaryTextColor: "#f7f4ff",
          lineColor: "#8c8796",
          fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
        },
      });

      for (const [index, diagram] of diagrams.entries()) {
        if (disposed || diagram.dataset.mermaidRendered === "true") continue;

        const source = diagram.querySelector<HTMLElement>(".mermaid-diagram__source");
        const code = source?.querySelector("code")?.textContent?.trim();
        const canvas = diagram.querySelector<HTMLElement>(".mermaid-diagram__canvas");
        if (!source || !code || !canvas) continue;

        try {
          const id = `mermaid-${contentVersion}-${index}`;
          const { svg, bindFunctions } = await mermaid.render(id, code);
          if (disposed) return;

          canvas.innerHTML = svg;
          canvas.hidden = false;
          source.hidden = true;
          diagram.dataset.mermaidRendered = "true";
          bindFunctions?.(canvas);
        } catch (error) {
          diagram.dataset.mermaidError = "true";
          console.error("Unable to render Mermaid diagram", error);
        }
      }
    };

    void render();

    return () => {
      disposed = true;
    };
  }, [contentVersion]);

  return null;
}
