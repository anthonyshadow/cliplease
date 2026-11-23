"use client";

import { useState } from "react";

/**
 * A row action's sheet (05 §7): `open` and `onOpenChange` for the sheet; `openings`, its key, so each opening starts it
 * afresh; `mounted` once it first opened (the sheet mounts then, not with the row). `show` opens it anew.
 */
export function useSheetOpenings() {
  const [open, setOpen] = useState(false);
  const [openings, setOpenings] = useState(0);
  return {
    open,
    onOpenChange: setOpen,
    openings,
    mounted: openings > 0,
    show() {
      setOpenings((n) => n + 1);
      setOpen(true);
    },
  };
}
