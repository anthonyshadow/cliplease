"use client";

import { useEffect } from "react";

// Gallery-only review aid: sets <html data-theme> after mount and removes it on unmount. The MVP has no theme
// toggle; 04 §3.1's CSS honours data-theme for review.
export function ThemeAttribute({ theme }: { theme?: "light" | "dark" }) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);
  return null;
}
