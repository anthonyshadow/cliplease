import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * A form wired to a Server Action that keeps what was typed after a refusal. React 19 resets a form whose `action`
 * runs, so the submit is dispatched by hand; `action` stays on the form for a post without JavaScript, and `noValidate`
 * lets the server's field errors answer instead of the browser's bubbles. Spread `formProps` on the `<form>`.
 * `resultKey` goes up with each result the action returns: key the refusal's alert on it, so a repeated refusal is
 * announced again.
 */
export function useFormAction<State>(
  action: (state: Awaited<State>, payload: FormData) => State | Promise<State>,
  initialState: Awaited<State>,
  beforeSubmit?: () => void,
) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [resultKey, setResultKey] = useState(0);
  // Each result is a new state; the initial one isn't a result.
  const initial = useRef(state);
  useEffect(() => {
    if (state !== initial.current) setResultKey((key) => key + 1);
  }, [state]);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    beforeSubmit?.();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }
  return {
    state,
    pending,
    resultKey,
    formProps: { noValidate: true, action: formAction, onSubmit },
  };
}
