import { CONNECT_PAGE_LINE } from "./connect-messages";

/** The id of the Connections title, which takes the focus back when a disconnected card leaves the page. */
export const CONNECTIONS_TITLE_ID = "connections-title";

/** S13's two-tone title and page line (05 §6.2 callouts 2–3), shared by the page and its loading state. */
export function ConnectionsHeader() {
  return (
    <div className="flex flex-col gap-2">
      <h1
        id={CONNECTIONS_TITLE_ID}
        tabIndex={-1}
        className="text-title-1 text-ink outline-none"
      >
        Connections. <span className="text-ink-2">Link where you post.</span>
      </h1>
      <p className="text-callout text-ink-2">{CONNECT_PAGE_LINE}</p>
    </div>
  );
}
