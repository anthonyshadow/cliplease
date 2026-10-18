import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";

// Better Auth's HTTP endpoints (sign-in code, sign in, sign out, session). The rate limiter and the origin checks run
// here, not on server-side auth.api calls.
export const { GET, POST } = toNextJsHandler(auth);
