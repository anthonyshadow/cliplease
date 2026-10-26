"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LICENSE_PAGE_COPY } from "@/lib/licensing/license-page";
import { creatorUrl } from "@/lib/urls";
import { handleFromParam } from "@/lib/validation/handle";

/**
 * The license 404's "See @{handle}'s videos" (01 J6.5; owner answer Q-105 a): a not-found file gets no params, so this
 * reads the route's own. It shows for any handle-shaped param; an unknown creator's link then lands on /@handle's "No
 * creator here.". `fallback` when the param can't be a handle.
 */
export function CreatorVideosLink({ fallback }: { fallback: ReactNode }) {
  const params = useParams<{ handle?: string }>();
  const route = params.handle ? handleFromParam(params.handle) : null;
  if (!route) return fallback;
  return (
    <Button asChild variant="link">
      <Link href={creatorUrl(route.handle)}>
        {LICENSE_PAGE_COPY.seeVideos(route.handle)}
      </Link>
    </Button>
  );
}
