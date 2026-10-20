import "server-only";

// The server's upload limits (02 §5.9): the shared ones from src/lib/upload/limits.ts, plus how long a signed URL lives.

export * from "../../lib/upload/limits";

export const PUT_URL_TTL_S = 3600; // poster PUT
export const PART_URL_TTL_S = 3600; // UploadPart URLs
export const GET_URL_TTL_S = 300; // downloads (07 D61: 5 minutes)
