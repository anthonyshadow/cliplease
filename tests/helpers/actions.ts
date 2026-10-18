// For calling Server Actions and the session gates outside a request (tests/helpers/next-headers.ts supplies the
// cookies): the errors redirect() and notFound() throw, and the FormData a form would post.

/** What redirect(url) throws outside a request. */
export const redirectTo = (url: string) => ({
  digest: `NEXT_REDIRECT;replace;${url};307;`,
});

/** What notFound() throws outside a request. */
export const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

/** A FormData with `fields`, as a form posts them. */
export function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}
