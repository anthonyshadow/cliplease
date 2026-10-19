import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signInPath } from "@/lib/sign-in";
import { getCreatorForApi } from "@/server/auth/session";
import { env } from "@/server/env";
import {
  OAUTH_COOKIE,
  oauthCookieOptions,
  parseReturnTo,
  sealOAuthState,
} from "@/server/social/oauth-state";
import { createPkcePair } from "@/server/social/pkce";
import { getProvider, redirectUriFor } from "@/server/social/registry";

// Connect, step 1 (02 §7.2, 07 D37): seal state, the PKCE verifier and where to come back in a short-lived cookie, then
// send the creator to the platform (the mock comes straight back to our callback).

// Flags other than "1" count as absent rather than failing the connect; parseReturnTo validates returnTo.
const startQuery = z.object({
  switch: z.literal("1").nullable().catch(null),
  insights: z.literal("1").nullable().catch(null),
});

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/connect/[provider]/start">,
) {
  const creator = await getCreatorForApi();
  if (!creator) {
    return NextResponse.redirect(
      new URL(signInPath("/dashboard/connections"), env.APP_URL),
      302,
    );
  }
  const provider = getProvider((await ctx.params).provider);
  if (!provider) return new NextResponse(null, { status: 404 });

  const search = request.nextUrl.searchParams;
  const q = startQuery.parse({
    switch: search.get("switch"),
    insights: search.get("insights"),
  });
  const returnTo = parseReturnTo(search.get("returnTo"));
  const state = randomBytes(32).toString("base64url");
  const pkce = provider.capabilities.usesPkce ? createPkcePair() : null;
  // Optional scopes only on request (?insights=1; Instagram views, 07 D83).
  const extraScopes = q.insights ? provider.optionalScopes : [];

  const response = NextResponse.redirect(
    provider.getAuthorizeUrl({
      state,
      codeChallenge: pkce?.challenge ?? null,
      redirectUri: redirectUriFor(provider.platform),
      forceAccountChoice: q.switch === "1",
      extraScopes,
      mockSubject: provider.platform === "mock" ? creator.user.id : undefined,
    }),
    302,
  );
  response.cookies.set(
    OAUTH_COOKIE,
    sealOAuthState({
      provider: provider.platform,
      state,
      codeVerifier: pkce?.verifier ?? null,
      userId: creator.user.id,
      returnTo: returnTo.pathname + returnTo.search,
      requestedScopes: [...provider.requiredScopes, ...extraScopes],
      createdAt: Date.now(),
    }),
    oauthCookieOptions(env.APP_URL),
  );
  return response;
}
