/** 04 §11.10's generic error: what a Server Action says when the input or the target is wrong. */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Try again.";

// Returned by every Server Action (02 §5).
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fields?: Record<string, string[]>;
      };
    };

export type ActionError = Extract<ActionResult, { ok: false }>;

/** A refusal with one field error that is also the form's message. */
export function fieldError(
  code: string,
  field: string,
  message: string,
): ActionError {
  return {
    ok: false,
    error: { code, message, fields: { [field]: [message] } },
  };
}

/** A refusal with one error per field; the first one is also the form's message. */
export function fieldErrors(
  code: string,
  fields: readonly (readonly [key: string, message: string])[],
): ActionError {
  return {
    ok: false,
    error: {
      code,
      message: fields[0]?.[1] ?? GENERIC_ERROR_MESSAGE,
      fields: Object.fromEntries(fields.map(([key, msg]) => [key, [msg]])),
    },
  };
}

/** A posted text field, or "" when it is missing or a file. */
export function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
