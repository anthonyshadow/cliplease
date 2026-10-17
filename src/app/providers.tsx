"use client";

import { LucideProvider } from "lucide-react";
import type { ReactNode } from "react";

// 04 §8.1: default icons are 20 px with a 1.75 stroke. lucide's Icon is a client component, so this context
// also reaches icons rendered from Server Components. 16 px icons pass strokeWidth 2, 24 px pass 1.5.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <LucideProvider size={20} strokeWidth={1.75}>
      {children}
    </LucideProvider>
  );
}
