// `bun run email:dev` (02 §11.1): the template with sample values. Preview only; nothing in the app imports it.
import { SignInCode } from "../sign-in-code";

export default function SignInCodePreview() {
  return <SignInCode code="482913" />;
}
