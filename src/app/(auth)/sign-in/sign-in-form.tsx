"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import * as z from "zod/mini";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { INLINE_LINK } from "@/components/ui/inline-link";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { TextField } from "@/components/ui/text-field";
import { authClient } from "@/lib/auth-client";
import {
  FORM_LEVEL_ERRORS,
  maskEmail,
  normalizeOtpInput,
  OTP_RESEND_DELAY_MS,
  SIGN_IN_COPY,
  type SignInErrorKey,
  shouldAutoSubmit,
  signInErrorKey,
} from "@/lib/sign-in";

type Step = "email" | "code";
/** `id` is new on every failure, so a repeated message is announced again. */
type Failure = { key: SignInErrorKey; id: number };

// zod/mini: the same email check without shipping all of Zod to the sign-in page.
const EMAIL = z.email();
const networkFailure = (): SignInErrorKey =>
  navigator.onLine === false ? "offline" : "generic";

/**
 * How a failure shows. Offline and server errors are an error Banner above the field (05 §1.4). The rest are the
 * field's error, plus a visually hidden alert: focus is often already in the field (Enter, a paste), so moving it there
 * announces nothing on its own.
 */
function failureViews(failure: Failure | null) {
  if (failure === null) return { fieldError: undefined, notice: null };
  const message = SIGN_IN_COPY[failure.key];
  if (FORM_LEVEL_ERRORS.has(failure.key)) {
    return {
      fieldError: undefined,
      notice: (
        <Banner key={failure.id} tone="error">
          {message}
        </Banner>
      ),
    };
  }
  return {
    fieldError: message,
    notice: (
      <p key={failure.id} role="alert" className="sr-only">
        {message}
      </p>
    ),
  };
}

/**
 * "m…@domain." as one block on its own line when it fits. The ellipsis is a line-break opportunity, so "m…@" is kept
 * together; a domain wider than the column still wraps (07 D153).
 */
function MaskedAddress({ email }: { email: string }) {
  const masked = maskEmail(email);
  const at = masked.indexOf("@") + 1;
  return (
    <span className="inline-block max-w-full">
      <span className="whitespace-nowrap">{masked.slice(0, at)}</span>
      {masked.slice(at)}.
    </span>
  );
}

/**
 * S10 (05 §5.1): step 1 asks for the email, step 2 for the 6-digit code. Enter submits each step. Six digits that arrive
 * in one change (paste, autofill) submit once by themselves; typing keeps the Sign in button in control. On success, a
 * full navigation to `next`.
 */
export function SignInForm({ next }: { next: string }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState<"send" | "verify" | null>(null);
  // Codes sent so far, and the send whose 30 s have passed: "Send a new code" shows 30 s after the latest send (01 J1.1).
  const [sends, setSends] = useState(0);
  const [resendReadyFor, setResendReadyFor] = useState(0);
  // Bumped to move focus to the step's field after the next render: on a step change and on every failure.
  const [focusTick, setFocusTick] = useState(0);
  const fieldRef = useRef<HTMLInputElement>(null); // the step's one field
  const busy = useRef(false); // one request at a time: auto-submit, Enter and clicks never overlap
  const lastTried = useRef<string | null>(null);
  const leaving = useRef(false);
  const codeHintId = useId();
  const canResend = sends > 0 && resendReadyFor === sends;

  useEffect(() => {
    if (sends === 0) return;
    const timer = setTimeout(
      () => setResendReadyFor(sends),
      OTP_RESEND_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [sends]);

  useEffect(() => {
    if (focusTick > 0) fieldRef.current?.focus();
  }, [focusTick]);

  // Back after a sign-in can restore this page from the back/forward cache (Safari), still "Signing in…". Reload it
  // instead: the server sends a signed-in visitor on to `next`.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && leaving.current) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const fail = (key: SignInErrorKey) => {
    setFailure((previous) => ({ key, id: (previous?.id ?? 0) + 1 }));
    setFocusTick((tick) => tick + 1);
  };

  const goTo = (nextStep: Step) => {
    setStep(nextStep);
    setFocusTick((tick) => tick + 1);
  };

  /** Sends a code to `address` and restarts the resend timer; false, with the failure shown, when none went out. */
  async function sendCode(address: string, from: Step): Promise<boolean> {
    busy.current = true;
    setPending("send");
    setFailure(null);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email: address,
        type: "sign-in",
      });
      if (error) {
        fail(signInErrorKey(error, from));
        return false;
      }
      setCode("");
      lastTried.current = null;
      setSends((count) => count + 1);
      return true;
    } catch {
      fail(networkFailure());
      return false;
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const address = email.trim().toLowerCase();
    if (!EMAIL.safeParse(address).success) {
      fail("invalidEmail");
      return;
    }
    if (await sendCode(address, "email")) {
      setEmail(address);
      goTo("code");
    }
  }

  async function verify(raw: string) {
    if (busy.current || leaving.current) return;
    const otp = normalizeOtpInput(raw);
    if (otp === null) {
      fail("badCode");
      return;
    }
    busy.current = true;
    lastTried.current = otp;
    setPending("verify");
    setFailure(null);
    try {
      const { error } = await authClient.signIn.emailOtp({ email, otp });
      if (error) {
        fail(signInErrorKey(error, "code"));
        return;
      }
      // Keep the loading state until the next page replaces this one.
      leaving.current = true;
      window.location.assign(next);
    } catch {
      fail(networkFailure());
    } finally {
      if (!leaving.current) {
        busy.current = false;
        setPending(null);
      }
    }
  }

  function changeCode(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setCode(value);
    // A plain Event (some autofill) has no inputType or data.
    const input = event.nativeEvent as Partial<InputEvent>;
    if (
      shouldAutoSubmit({
        value,
        inputType: input.inputType,
        data: input.data,
        lastTried: lastTried.current,
      })
    ) {
      void verify(value);
    }
  }

  async function resend() {
    if (busy.current) return;
    if (await sendCode(email, "code")) fieldRef.current?.focus();
  }

  function useDifferentEmail() {
    // Not while a check or a resend is out: its answer would land on step 1.
    if (busy.current) return;
    setFailure(null);
    goTo("email");
  }

  const { fieldError, notice } = failureViews(failure);

  if (step === "email") {
    return (
      <form noValidate onSubmit={submitEmail} className="flex flex-col gap-6">
        <h1 className="text-title-1 text-ink">Sign in</h1>
        {notice}
        <TextField
          ref={fieldRef}
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError}
        />
        <Button
          type="submit"
          loading={pending === "send"}
          loadingLabel="Sending…"
          className={PRIMARY_WIDTH}
        >
          Email me a code
        </Button>
        <p className="text-footnote text-ink-2">
          By continuing you agree to the{" "}
          <Link href="/legal/terms" className={INLINE_LINK}>
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className={INLINE_LINK}>
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-title-1 text-ink">Check your email.</h1>
        <p id={codeHintId} className="text-body text-ink-2">
          Enter the 6-digit code we sent to <MaskedAddress email={email} />
        </p>
      </div>
      {notice}
      <TextField
        ref={fieldRef}
        label="Code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={changeCode}
        error={fieldError}
        aria-describedby={codeHintId}
      />
      <Button
        type="submit"
        loading={pending === "verify"}
        loadingLabel="Signing in…"
        className={PRIMARY_WIDTH}
      >
        Sign in
      </Button>
      <div className="flex flex-col items-start gap-1">
        {canResend ? (
          <Button
            variant="tertiary"
            className="px-0"
            loading={pending === "send"}
            loadingLabel="Sending…"
            onClick={() => void resend()}
          >
            Send a new code
          </Button>
        ) : null}
        <Button
          variant="tertiary"
          className="px-0"
          disabled={pending !== null}
          onClick={useDifferentEmail}
        >
          Use a different email
        </Button>
      </div>
    </form>
  );
}
