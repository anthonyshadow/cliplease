// For calling Server Actions and the session gates outside a request (tests/helpers/next-headers.ts supplies the
// cookies): the errors redirect() and notFound() throw, the FormData a form would post, and the Rights step's form as
// posted.

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

/** Rights' form as posted: both boxes ticked and both answers No, with `change` on top (the music Switches among them). */
export const rightsForm = (
  videoId: string,
  change: Record<string, string> = {},
) =>
  formOf({
    videoId,
    ownsRights: "on",
    notReupload: "on",
    containsMusic: "no",
    identifiablePeople: "no",
    ...change,
  });
