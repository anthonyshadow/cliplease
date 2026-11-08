import { MY_LICENSES_COPY as COPY } from "@/lib/licensing/my-licenses-copy";

/** S30's two-tone title (05 §4.9), shared by the page and its error state. */
export function MyLicensesTitle() {
  return (
    <h1 className="text-title-1 text-ink">
      {COPY.heading.lead}{" "}
      <span className="text-ink-2">{COPY.heading.rest}</span>
    </h1>
  );
}
