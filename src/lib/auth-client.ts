"use client";

import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// The browser client: same origin (/api/auth), so the limiter and the origin checks apply to every call.
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
