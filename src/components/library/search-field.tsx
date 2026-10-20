"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { FIELD_BOX } from "@/components/ui/text-field";
import {
  LIBRARY_PATH,
  LIBRARY_Q_MAX,
  type LibraryFilter,
  libraryHref,
} from "@/lib/library/filter";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 250;
const PLACEHOLDER = "Search captions";

/** What the URL's ?q= becomes for this text: trimmed, or nothing for one character (q needs 2–100). */
function nextQ(text: string): string | undefined | null {
  const q = text.trim();
  if (q === "") return undefined;
  return q.length >= 2 ? q : null;
}

/**
 * SearchField (04 §9.14): a GET form for ?q= that keeps the platform and account filters (hidden inputs, so it works
 * without JS), 36 px with a 44 px target, a leading Search icon and a Clear button while it has text. Typing navigates
 * 250 ms after the last key; the placeholder is also its accessible name.
 */
export function SearchField({
  filter,
  className,
}: {
  /** The page's filter, without its cursor. */
  filter: Omit<LibraryFilter, "cursor">;
  className?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(filter.q ?? "");
  const input = useRef<HTMLInputElement>(null);
  // The q this field last sent: a different one in the URL came from elsewhere (Clear search, the back button).
  const sent = useRef(filter.q);
  useEffect(() => {
    if (filter.q !== sent.current) {
      sent.current = filter.q;
      setValue(filter.q ?? "");
    }
  }, [filter.q]);

  const go = (text: string) => {
    const q = nextQ(text);
    if (q === null || q === sent.current) return;
    sent.current = q;
    router.replace(libraryHref({ ...filter, q }), { scroll: false });
  };

  useEffect(() => {
    const timer = setTimeout(() => go(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    go(value);
  };

  return (
    <search className={className}>
      <form
        action={LIBRARY_PATH}
        onSubmit={onSubmit}
        className="relative isolate"
      >
        {filter.platform ? (
          <input type="hidden" name="platform" value={filter.platform} />
        ) : null}
        {filter.accountId ? (
          <input type="hidden" name="account" value={filter.accountId} />
        ) : null}
        {/* An <input> can't hold the 44 px ::after target, so its label does (a tap on it focuses the field). */}
        <label className="hit-44 block">
          <Search
            aria-hidden
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 z-20 -translate-y-1/2 text-ink-2"
          />
          <input
            ref={input}
            type="search"
            name="q"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={LIBRARY_Q_MAX}
            placeholder={PLACEHOLDER}
            aria-label={PLACEHOLDER}
            autoComplete="off"
            className={cn(
              FIELD_BOX,
              // text-body (FIELD_BOX's 17 px) also keeps iOS from zooming in on focus.
              // Above the label's 44 px band, so a click lands in the text (caret, selection, paste menu).
              "relative z-10 block h-9 pr-11 pl-9 [&::-webkit-search-cancel-button]:appearance-none",
            )}
          />
        </label>
        {value !== "" ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setValue("");
              go("");
              input.current?.focus();
            }}
            className="hit-44 absolute top-1/2 right-1.5 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 hover:text-ink"
          >
            <X aria-hidden size={16} />
          </button>
        ) : null}
      </form>
    </search>
  );
}
