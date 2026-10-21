// The browser's side of P10a's upload routes: JSON POSTs and progress-reporting PUTs. Browser only: import it from client
// code. Errors carry a code, never a URL, a key or an upload id.
import { UPLOAD_ROUTE_CODES, type UploadErrorCode } from "./codes";
import { PUT_STALL_MS } from "./limits";

export type UploadResult = { ok: true } | { ok: false; code: UploadErrorCode };
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: UploadErrorCode };
type PutResult =
  | { ok: true; status: number }
  | { ok: false; code: "network" | "canceled" };

/** P10a's error bodies: `{ code }`, or `{ error: { code: "unauthorized" } }` for a missing session. */
async function errorCode(response: Response): Promise<UploadErrorCode> {
  if (response.status === 401) return "unauthorized";
  try {
    const body = (await response.json()) as {
      code?: unknown;
      error?: { code?: unknown };
    };
    const code = body.code ?? body.error?.code;
    return UPLOAD_ROUTE_CODES.find((known) => known === code) ?? "internal";
  } catch {
    return "internal";
  }
}

/** POST /api/uploads/<route> as application/json; a dropped connection is `network`, an aborted one `canceled`. */
export async function postUploadRoute<T>(
  route: "start" | "parts" | "complete",
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  const lost = (): ApiResult<T> => ({
    ok: false,
    code: signal?.aborted ? "canceled" : "network",
  });
  let response: Response;
  try {
    response = await fetch(`/api/uploads/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return lost();
  }
  if (!response.ok) return { ok: false, code: await errorCode(response) };
  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return lost();
  }
}

/** POST complete, unless `signal` was aborted first: complete itself is never aborted, it runs to its answer. */
export async function completeUpload(
  body: unknown,
  signal?: AbortSignal,
): Promise<UploadResult> {
  if (signal?.aborted) return { ok: false, code: "canceled" };
  const completed = await postUploadRoute<{ ok: true }>("complete", body);
  return completed.ok ? { ok: true } : completed;
}

/**
 * One PUT with XMLHttpRequest, for its upload progress (`onProgress` gets the bytes sent so far). Only `headers` are
 * set: a part PUT passes none, so a type-less `file.slice()` goes with no Content-Type (07 D80 gotchas). `ok` means
 * the server answered, with any status; the caller judges the status. A PUT with no progress for PUT_STALL_MS (and no
 * answer that long once the body is sent) is aborted as `network`: a half-open connection never errors by itself.
 */
export function putWithProgress(
  url: string,
  body: Blob,
  {
    headers = {},
    onProgress,
    signal,
  }: {
    headers?: Record<string, string>;
    onProgress?: (loaded: number) => void;
    signal?: AbortSignal;
  },
): Promise<PutResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, code: "canceled" });
      return;
    }
    const xhr = new XMLHttpRequest();
    let stalled = false;
    // One timer, not one per progress event (several a second): fired before PUT_STALL_MS of quiet, it re-arms for the
    // rest. performance.now() is monotonic, as timers are: a clock change neither ends nor stretches the wait.
    let lastProgress = performance.now();
    const progressed = () => {
      lastProgress = performance.now();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = (ms: number) => {
      timer = setTimeout(() => {
        const left = lastProgress + PUT_STALL_MS - performance.now();
        if (left > 0) {
          watch(Math.ceil(left));
        } else {
          stalled = true;
          xhr.abort();
        }
      }, ms);
    };
    const abort = () => xhr.abort();
    const finish = (result: PutResult) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    // Listeners on xhr.upload go on before send(), or some browsers never report progress.
    xhr.upload.onprogress = (event) => {
      progressed();
      onProgress?.(event.loaded);
    };
    xhr.upload.onload = progressed;
    xhr.onload = () => finish({ ok: true, status: xhr.status });
    xhr.onerror = () => finish({ ok: false, code: "network" });
    xhr.onabort = () =>
      finish({ ok: false, code: stalled ? "network" : "canceled" });
    signal?.addEventListener("abort", abort, { once: true });
    watch(PUT_STALL_MS);
    xhr.send(body);
  });
}
