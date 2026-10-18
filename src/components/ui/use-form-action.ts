import { type FormEvent, startTransition, useActionState } from "react";

/**
 * A form wired to a Server Action that keeps what was typed after a refusal. React 19 resets a form whose `action`
 * runs, so the submit is dispatched by hand; `action` stays on the form for a post without JavaScript, and `noValidate`
 * lets the server's field errors answer instead of the browser's bubbles. Spread `formProps` on the `<form>`.
 */
export function useFormAction<State>(
  action: (state: Awaited<State>, payload: FormData) => State | Promise<State>,
  initialState: Awaited<State>,
  beforeSubmit?: () => void,
) {
  const [state, formAction, pending] = useActionState(action, initialState);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    beforeSubmit?.();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }
  return {
    state,
    pending,
    formProps: { noValidate: true, action: formAction, onSubmit },
  };
}
