"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type BackdropLayoutValue = {
  revision: number;
  commitLayout: () => void;
};

const BackdropLayoutContext = createContext<BackdropLayoutValue | null>(null);

/**
 * Coordinates dynamic page layout with fixed backdrop filters.
 *
 * Components that reposition content behind fixed glass commit a layout
 * revision after their geometry is final. Glass consumers can then rebind their
 * filter in the same React lifecycle, before the next paint.
 */
export function BackdropLayoutProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const commitLayout = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);
  const value = useMemo(
    () => ({ revision, commitLayout }),
    [revision, commitLayout],
  );

  return (
    <BackdropLayoutContext.Provider value={value}>
      {children}
    </BackdropLayoutContext.Provider>
  );
}

export function useBackdropLayout() {
  const value = useContext(BackdropLayoutContext);
  if (!value) {
    throw new Error("useBackdropLayout must be used inside BackdropLayoutProvider");
  }
  return value;
}
