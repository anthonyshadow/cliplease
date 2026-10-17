import { Inter } from "next/font/google";

export const inter = Inter({
  subsets: ["latin"],
  axes: ["opsz"], // Inter's optical-size axis (14–32) tightens display sizes on its own
  display: "swap",
  preload: false, // Apple devices render SF first and never request Inter; don't make iPhones download it
  variable: "--font-inter",
  // adjustFontFallback defaults to true: metric-matched fallback, less layout shift on the swap
});
