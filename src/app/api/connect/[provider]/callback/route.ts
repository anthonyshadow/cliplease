import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ConnectErrorCode, SocialProviderId } from "@/lib/domain/values";
import { getCreatorForApi, toActor } from "@/server/auth/session";
import { env } from "@/server/env";
import { errorName, logEvent } from "@/server/log";
import { AlreadyLinkedError } from "@/server/social/errors";
import {
  isPlatformAccountLive,
  linkAccount,
  revokeQuietly,
} from "@/server/social/link";
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  openOAuthState,
  parseReturnTo,
  stateMatches,
} from "@/server/social/oauth-state";
import { getProvider, redirectUriFor } from "@/server/social/registry";
import { syncSocialAccount } from "@/server/social/sync";

// Connect, step 2 (02 §7.2, 07 D37). A cookie that is missing, tampered, too old, for another provider, another state or
// another signed-in user lands on Connections with error=state before any token exchange; every later outcome goes back
// to the returnTo the connect started from, with ?connected= or ?error=. A linked account gets its first sync before the
// redirect (07 D13). The cookie is deleted on every outcome. Never logs the code, a token or the cookie.

/** The first sync (07 D13): up to 50 kept videos within 8 s; Sync now fetches the rest. */
const FIRST_SYNC = { maxPosts: 50, budgetMs: 8000 } as const;

const callbackQuery = z.object({
  code: z.string().max(2048).nullable(),
  state: z.string().max(2048).nullable(),
  error: z.string().max(2048).nullable(),
});

function connectionsUrl(code: ConnectErrorCode): URL {
  const url = new URL("/dashboard/connections", env.APP_URL);
  url.searchParams.set("error", code);
  return url;
}

/**
 * The value, or null when the platform call throws: logged by stage and error class only (a wrong client secret or
 * redirect URI shows up here; a code reused by Back is the creator's, hence warn).
 */
async function attempt<T>(
  stage: "exchange" | "profile",
  platform: SocialProviderId,
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    logEvent("warn", "social.connect_failed", {
      provider: platform,
      stage,
      reason: errorName(err),
    });
    return null;
  }
}

/** Where this callback lands; GET sends the redirect and deletes the cookie. */
async function landing(request: NextRequest, param: string): Promise<URL> {
  const search = request.nextUrl.searchParams;
  const q = callbackQuery.safeParse({
    code: search.get("code"),
    state: search.get("state"),
    error: search.get("error"),
  });
  const cookie = openOAuthState(request.cookies.get(OAUTH_COOKIE)?.value);
  if (!q.success || !cookie || cookie.provider !== param) {
    return connectionsUrl("state");
  }
  const provider = getProvider(cookie.provider);
  if (!provider || !stateMatches(q.data.state, cookie.state)) {
    return connectionsUrl("state");
  }
  const creator = await getCreatorForApi();
  if (!creator || creator.user.id !== cookie.userId) {
    return connectionsUrl("state");
  }

  const backTo = (key: "connected" | "error", value: string) => {
    const url = parseReturnTo(cookie.returnTo);
    url.searchParams.set(key, value);
    return url;
  };
  const fail = (code: ConnectErrorCode) => backTo("error", code);

  const { code, error } = q.data;
  if (error) return fail("denied");
  if (!code) return fail("provider_error");
  const tokens = await attempt("exchange", provider.platform, () =>
    provider.exchangeCode({
      code,
      codeVerifier: cookie.codeVerifier,
      redirectUri: redirectUriFor(provider.platform),
    }),
  );
  if (!tokens) return fail("provider_error");

  // A connect we refuse (07 D37: missing_scope, already_linked; ig_personal and no_channel from P28/P27) gives the new
  // tokens back only when we know the platform account and no live ClipLease account holds it (owner answer, amending
  // 07 D37 and 02 §7.2): on Google and TikTok a revoke ends the whole grant, and a live account still uses it. Otherwise
  // the tokens are dropped unstored. A failure never revokes, for the same reason.
  const refuse = async (
    reason: "missing_scope" | "already_linked",
    externalAccountId: string | null,
  ) => {
    if (
      externalAccountId !== null &&
      !(await isPlatformAccountLive(provider.platform, externalAccountId))
    ) {
      await revokeQuietly(provider, tokens);
    } else {
      logEvent("info", "social.revoke_skipped", {
        provider: provider.platform,
        reason,
      });
    }
    return fail(reason);
  };
  const readProfile = () =>
    attempt("profile", provider.platform, () =>
      provider.getProfile(tokens.accessToken),
    );
  if (!provider.requiredScopes.every((s) => tokens.scopes.includes(s))) {
    // Without the scope the profile may not be readable: then the account is unknown and nothing is revoked.
    const profile = await readProfile();
    return refuse("missing_scope", profile?.externalAccountId ?? null);
  }
  // Only scopes we asked for and were granted (owner answer Q3 a; an optional one not granted is not an error).
  const scopes = tokens.scopes.filter((s) =>
    cookie.requestedScopes.includes(s),
  );

  const profile = await readProfile();
  if (!profile) return fail("provider_error");
  let socialAccountId: string;
  try {
    ({ socialAccountId } = await linkAccount({
      creatorId: creator.creator.id,
      platform: provider.platform,
      tokens: { ...tokens, scopes },
      profile,
    }));
  } catch (err) {
    if (err instanceof AlreadyLinkedError) {
      return refuse("already_linked", profile.externalAccountId);
    }
    logEvent("error", "social.connect_failed", {
      provider: provider.platform,
      stage: "link",
      reason: errorName(err),
    });
    return fail("provider_error");
  }
  // The account is linked whatever the first sync returns: its outcome is on the row (07 D02), and Sync now retries.
  // The creator actor, not 02 §7.2's system: the session is here, and Actor has no callback source.
  try {
    await syncSocialAccount(socialAccountId, toActor(creator), FIRST_SYNC);
  } catch (err) {
    logEvent("error", "social.first_sync_failed", {
      provider: provider.platform,
      reason: errorName(err),
    });
  }
  return backTo("connected", provider.platform);
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/connect/[provider]/callback">,
) {
  let target: URL;
  try {
    target = await landing(request, (await ctx.params).provider);
  } catch (error) {
    logEvent("error", "social.connect_failed", {
      reason: errorName(error),
    });
    target = connectionsUrl("provider_error");
  }
  const response = NextResponse.redirect(target, 302);
  response.cookies.delete({ name: OAUTH_COOKIE, path: OAUTH_COOKIE_PATH });
  return response;
}
