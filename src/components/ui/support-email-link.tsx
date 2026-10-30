import { SUPPORT_EMAIL } from "@/lib/app-name";
import { INLINE_LINK } from "./inline-link";

/** The support address as an inline mailto link, in running text. */
export function SupportEmailLink() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className={INLINE_LINK}>
      {SUPPORT_EMAIL}
    </a>
  );
}
