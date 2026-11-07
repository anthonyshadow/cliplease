import { SupportEmailLink } from "@/components/ui/support-email-link";
import { SUPPORT_EMAIL } from "@/lib/app-name";

/** Record copy that names the support address (research/license.md §6.4), the address as a mailto link. */
export function SupportText({ text }: { text: string }) {
  const at = text.indexOf(SUPPORT_EMAIL);
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <SupportEmailLink />
      {text.slice(at + SUPPORT_EMAIL.length)}
    </>
  );
}
