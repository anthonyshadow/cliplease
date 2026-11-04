import { useState } from "react";

type Refusal = { message: string; n: number };

/**
 * An in-place editor's refusal (ReviewDetails, useChoiceDraft, the music Switches, a rate card's Enter): `refuse` numbers
 * each one, so RefusalAlert announces it again even in the same words; `clear` drops it.
 */
export function useRefusal() {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const refuse = (message: string) =>
    setRefusal((last) => ({ message, n: (last?.n ?? 0) + 1 }));
  const clear = () => setRefusal(null);
  return [refusal, refuse, clear] as const;
}

/** The refusal for screen readers (the field or group shows it): keyed by its number, so each one is announced. */
export function RefusalAlert({ refusal }: { refusal: Refusal | null }) {
  return refusal ? (
    <p key={refusal.n} role="alert" className="sr-only">
      {refusal.message}
    </p>
  ) : null;
}
