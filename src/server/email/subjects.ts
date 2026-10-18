import "server-only";
import { APP_NAME } from "@/lib/app-name";

// Email subjects (05 §8), built from APP_NAME. A subject never contains a sign-in code, token or link (07 D34).
export const signInCodeSubject = (): string => `Your ${APP_NAME} sign-in code`;
