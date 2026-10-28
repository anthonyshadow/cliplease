"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageBody } from "./public-shell";

/** How often a RefreshingMessage refreshes its page, and how many times (02 §4.1, §8.3): every 3 s for 30 s. */
export const REFRESH_EVERY_MS = 3_000;
export const REFRESH_TIMES = 10;

/**
 * A message whose page is about to change on the server (02 §8.3; 05 §4.3): `title` led by a 16 px spinner while the
 * page refreshes every 3 s; after the last refresh, `body` in the spinner's place. The page's next state renders
 * something else, which unmounts this and stops the refreshes. Reduced motion stills the spinner (globals.css).
 */
export function RefreshingMessage({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return;
    let left = REFRESH_TIMES;
    const timer = setInterval(() => {
      router.refresh();
      left -= 1;
      if (left === 0) {
        clearInterval(timer);
        setDone(true);
      }
    }, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [router, done]);
  return (
    <MessageBody
      title={title}
      icon={
        done ? null : (
          <LoaderCircle size={16} strokeWidth={2} className="animate-spin" />
        )
      }
    >
      {done ? <p className="text-body text-ink-2">{body}</p> : null}
    </MessageBody>
  );
}
