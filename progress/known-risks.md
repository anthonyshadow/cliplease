# Known risks

Written during P19f (2026-11-06) at the owner's request (Q-177), for whoever revisits the checkout hold and the reserved state. Each entry says what can happen, how likely and how bad it is, what stops it today, what to do when revisiting, and what brings it back.

Terms: the *hold* is `license_request.checkout_hold_until` (10 minutes, extendable). The *session* is `checkout_expires_at` (60 minutes from the start, the cumulative cap). An *unpaid row* is `checkout_pending`. A row is pending only while both are in the future; `awaiting_approval` reserves for its whole approval window.

## 1. A stranger can hold a video for free
- **What can happen:** the license form needs no card and no login. An exclusive unpaid row reserves the video for everyone for 10 minutes, up to 60 with the page open and Extend pressed, and the same person can start again. Coming back to a page left while its hold ran re-holds without a press (the design's reload and Back rule); a page already lapsed stays lapsed until Extend is pressed. So a reload in the last minute also gets a fresh 10 minutes with no press, still inside the 60-minute cap (seen on the dev app, 2026-11-06).
- **How likely, how bad:** unlikely while the product is small; bad for the creator affected, whose video reads reserved with an empty Inbox, and it costs the attacker nothing.
- **What stops it today:** the 10-minute clock if they walk away, and closing the page frees it at once. Nothing stops a patient person. CORE has no checkout throttle.
- **When revisiting:** limit unpaid holds per IP, per email and per video; consider a verified email before an exclusive hold. D11's thresholds wouldn't stop one attempt an hour, so a per-video repeat limit is the one that matters.
- **Brings it back:** P31a (optional, it asks for thresholds), or the first report of a video stuck "reserved" with nothing in the Inbox.

## 2. Close detection is best effort
- **What can happen:** a browser doesn't always send the release (a phone killing a tab, a crash, no network), so the video stays held until the clock runs out. At P25 the reverse is possible: a full-page bank redirect fires `pagehide` and releases mid-payment. Leaving a page that shows lapsed while its Extend call is still running sends no release either (AD-74 h): if that Extend reached the server, the hold runs until its 10-minute clock ends it.
- **How likely, how bad:** the first is common and mild, 10 minutes at most. The second depends on how 3-D Secure behaves in Embedded Checkout, which no doc describes; if it happens, the buyer can be overtaken while paying (see risk 4).
- **What was tried (dev app, 2026-11-06):** navigating away released at once in the Claude desktop app's browser, Chromium and WebKit. A tab closed in Chromium with unload handlers running released (Playwright's `page.close({ runBeforeUnload: true })`), and so did a WebKit window closed by script (`window.close()`). Two closes sent nothing and left the hold running: closing a tab in the Claude desktop app's browser, and Playwright's WebKit `page.close({ runBeforeUnload: true })`. Both look like the tool skipping the page's unload path, but that wasn't proven. Nobody has tried real Chrome, real Safari or a phone by hand: do that first when revisiting. e2e leaves the page by navigating, not by closing a tab.
- **What stops it today:** the 10-minute clock is the backstop. `pagehide` and `popstate` only, not `visibilitychange`, so switching to a banking app doesn't release. A release only shortens one row and changes no status. T2 re-checks every payment.
- **When revisiting:** treat `pagehide` as a hint. P25's spike logs it during card `4000000000003220`. Consider a short grace on the server for the real page.
- **Brings it back:** P25.

## 3. Until P25 the clock exists only on the fake checkout
- **What can happen:** hosted Stripe Checkout can't show our clock or Extend, so real buyers would need the move to Embedded Checkout (Q-176), which nothing has proven against our manual capture yet.
- **How likely, how bad:** certain until P25; the rework is sizeable, and it touches the driver, the page, CSP and `requests.ts:335`'s resume.
- **What the research found (docs read 2026-11-06, showing `2026-10-28.endive`; nothing relevant beyond our `2026-09-30.endive`):**
  - Confirmed: `ui_mode: 'embedded_page'` (renamed from `embedded` in `2026-03-25.dahlia`; the old value fails; `form` is a different mode). `success_url` and `cancel_url` aren't allowed. `return_url` is required only with redirect-based methods. `redirect_on_completion`: `always` (default, redirects the whole page), `if_required`, `never`. The session gives `client_secret`; `url` is hosted-only. Manual capture has no `ui_mode` restriction, though no full embedded sample exists. Expiry is 30 minutes to 24 hours; `update` has no `expires_at`, so Stripe's expiry can't be extended; `expire` has no mode restriction but errors when not expireable. `unmount()` can remount, `destroy()` is final. npm has `@stripe/stripe-js` 10.2.1 and `@stripe/react-stripe-js` 7.0.1. Wallets need Dashboard enablement, domain registration on the platform key, HTTPS in dev, Safari/iOS 17+, Chrome 61+.
  - Not confirmed: which CSP applies (use the union in the P25 notes); how the 3-D Secure challenge behaves in `embedded_page` (the docs imply a default success state for cards under `never`; no doc describes the challenge); what an already mounted form does at expiry; an in-flight payment on unmount, and we can't see iframe state, so we can't detect a running challenge; whether `allowed_payment_method_types: ['card']` shows wallets; `client_secret` on retrieve; ordering of `expire` against a late completion; wallets under `/r/*`'s `Referrer-Policy: no-referrer`. Cross-origin isolation is unsupported. `onComplete` is documented only for `if_required` and `never`, with no pre-redirect callback.
- **What stops it today:** PAYMENTS_DRIVER is fake until P25; `CheckoutHoldClock` is built to be reused.
- **When revisiting:** ask the owner about both packages, a publishable key per Stripe account and what happens when payment completes after our deadline. Spike first: card `4000000000003220`, `expire` during an open challenge, retrieve's `client_secret`, wallets. Keep the countdown and Extend on our own server deadline; at expiry the server calls `expire` with a grace period, because unmounting cancels nothing we can prove. The webhook stays authoritative; `onComplete` only shows "Finishing checkout". Add our own cancel link. Put CSP in [H2]; register domains on each currency's account.
- **Brings it back:** P25.

## 4. A buyer past their hold who pays anyway can see a card hold placed and released
- **What can happen:** the hold lapsed, someone else took the video, and the buyer's payment still completes (a late bank step, or a second tab still showing Pay). T2 abandons the request as `video_unavailable` and cancels the authorization.
- **How likely, how bad:** rare; no money moves, but the buyer's bank can show a pending charge for days, and it reads badly.
- **What stops it today:** Pay goes away at zero. T2 under the video lock. `/r` says "This video isn't available for licensing right now. Nothing was charged."
- **When revisiting:** at P25, expire the Stripe session when the server's deadline passes, with a grace period, and decide what happens to a payment that completes after it.
- **Brings it back:** P25, or support tickets about a pending charge with no license.

## 5. A standard buyer can be overtaken by an exclusive request once their hold lapses
- **What can happen:** a standard buyer's clock runs out while they fetch a card. An exclusive request arrives and the video is reserved. Their Extend answers "Someone else has reserved this video. Nothing was charged."
- **How likely, how bad:** needs an exclusive buyer inside that window; rare, and annoying rather than harmful.
- **What stops it today:** the warning at 1 minute, Extend even after zero, and standard rows hold exactly like exclusive ones.
- **When revisiting:** only if it shows up; a longer first hold for standard rows would be the simple lever.
- **Brings it back:** owner feedback, or a metric on `taken` refusals once events are visible (P21).

## 6. A reload releases and re-holds
- **What can happen:** `pagehide` releases at once, so during the second a reload takes someone else can take the video; the buyer then sees "Someone else has reserved this video." A second, smaller gap: if the re-hold reaches the server before the beacon, it answers `too_early`, the beacon then releases, and the clock shows a hold that isn't there until the page reads the row again 5 s later and shows the lapsed state with Extend. A release slower than that, or one landing after a granted Extend (a hold in its last minute), waits for the next re-sync. A real network at P25 makes this more likely. Pay is still guarded by T2.
- **How likely, how bad:** small window, mild outcome, nothing charged.
- **What stops it today:** the page re-holds under the video lock on mount, and T2.
- **When revisiting:** a short server-side grace on `page_closed` would close both; the owner chose immediate release over the earlier 15 s plan.
- **Brings it back:** P25's spike, or reports of buyers losing a video on reload.

## 7. Other people read more than the truth of a short hold
- **What can happen:** other visitors read "Check back in a few days" for what may be a 10-minute unpaid hold. The creator reads "Exclusive request waiting" with an empty Inbox while it is unpaid. The notice and the public "Reserved" also tell anyone that a request exists (accepted by 07 D110).
- **How likely, how bad:** common whenever someone abandons an exclusive checkout; confusing, not harmful. A visitor may not come back the same day.
- **What stops it today:** closing frees it, the hold lapses alone, and a reserved page re-reads itself (risk 16), so a visitor who keeps it open sees it open. No wording distinguishes paid from unpaid, because no fact does (Q-170 added none).
- **When revisiting:** a display-only "paid" fact would let the notice and the creator's line differ, for instance by excluding unpaid rows from "Exclusive request waiting". This needs copy from the owner.
- **Brings it back:** owner review of the reserved page, or creator confusion.

## 8. "Reserved" is loose on a standard row
- **What can happen:** "Reserved for you · 9:32" on a standard checkout suggests exclusivity. Others can still buy standard licenses; only exclusive is blocked for that time.
- **How likely, how bad:** every standard buyer sees it; a wording nit, though a buyer could read it as more than it is.
- **What stops it today:** nothing; the owner approved one wording for both kinds.
- **When revisiting:** a separate standard wording if buyers misread it.
- **Brings it back:** buyer feedback, or a copy pass before launch.

## 9. Until P19g, approving an exclusive request issues an ordinary license at the premium
- **What can happen:** the buyer pays ×3 and gets a license with `license.exclusive = false`, and the video isn't blocked afterwards. An auto-approve creator would hit this through T2's `after()` with no tap.
- **How likely, how bad:** certain if anyone approves in that window; serious, but the window is development only.
- **What stops it today:** nothing is deployed. P19f's checks never approve an exclusive request, and its e2e keep auto-approve off.
- **When revisiting:** P19g fixes it. Don't deploy between P19f and P19g.
- **Brings it back:** P19g.

## 10. A crash between commit and `createCheckout` leaves a row with no session
- **What can happen:** the process dies after T1 commits and before the driver is called. The row holds for up to 10 minutes and no one can pay it; for an exclusive row the video reads reserved.
- **How likely, how bad:** very rare; 10 minutes at worst, and the row stays `checkout_pending` until a sweep.
- **What stops it today:** the 10-minute clock. A thrown driver call ends the row at once (Q-171); a crash, or a database error while storing the session id, leaves it. The row isn't filtered out by its missing session, because that would reopen T1's race.
- **When revisiting:** `abandonStaleCheckouts`.
- **Brings it back:** P33a.

## 11. A rate-card save committing after T1's re-read still gets the old price
- **What can happen:** T1 re-reads prices under the video lock, but `saveRateCard` takes no video lock, so a save committing just after that read doesn't affect this request.
- **How likely, how bad:** benign: the buyer pays exactly the total they saw, and the creator's new price applies from the next request.
- **What stops it today:** nothing is needed. Per-video saves do take the video lock, so they are fully serialized.
- **When revisiting:** only if a price change must apply to in-flight requests; `rate_card FOR SHARE` in T1 would do it with no lock cycle.
- **Brings it back:** a money-path review.

## 12. Two tabs on one payment page
- **What can happen:** closing one tab frees the hold while the other still counts down. Reloading one re-holds; the other's clock is stale until it re-syncs on focus.
- **How likely, how bad:** uncommon; the visible clock can be wrong for that tab, and the video can be taken meanwhile. Nothing is charged wrongly, because T2 decides.
- **What stops it today:** a re-sync when the tab regains focus, Extend's answer carrying the true times, and T2.
- **When revisiting:** a `BroadcastChannel`, or count open pages on the server, if it matters at P25.
- **Brings it back:** P25.

## 13. Nothing lints the video-lock rule
- **What can happen:** a future path could create, authorize or approve a request without `lockVideoForLicensing`. Types can't see it, and `lint:invariants` has no rule for it.
- **How likely, how bad:** likely over time if unguarded; it would break exclusivity silently, the worst outcome for the feature.
- **What stops it today:** AGENTS §5, the grep in each prompt's Step 0, and the lock-proof and race tests of `tests/integration/availability.test.ts`.
- **When revisiting:** add a `video-lock` invariant rule once P19g's capture claim exists, allowing `declineReasonFor`.
- **Brings it back:** P19g.

## 14. Two requests from one buyer
- **What can happen:** nothing ties a buyer's requests together, and each load of the license page is a new submission. A buyer who starts again on the same video while an older Checkout is open has two live requests. Two standard rows can both be paid: two card holds and two Inbox rows. On an exclusive row, the older request's Extend answers "Someone else has reserved this video. Nothing was charged." about the buyer's own newer request.
- **How likely, how bad:** uncommon, since it needs both pages kept and used. Two card holds can read as a double charge, and a creator approving both charges the buyer twice for two licenses. The exclusive case is only misleading wording.
- **What stops it today:** for exclusive rows, T2: paying the older one abandons it, cancels its card hold and leaves the newer one untouched. Nothing for standard rows.
- **When revisiting:** dedupe by buyer email and video at T2.
- **Brings it back:** P25.

## 15. On a phone the reserved notice starts below the fold
- **What can happen:** below `lg` the notice sits under the ownership badge (Q-169), after a tall poster. At 375 × 812 it begins right at the bottom edge, and at 320 × 568 well below it. A visitor sees the video and no tiles, price or form until they scroll to the reason.
- **How likely, how bad:** every phone visitor to a reserved video; a moment's confusion, not harm. From `lg` the notice is first in the right column and in view on arrival.
- **What stops it today:** nothing; it is the placement the owner chose, and the order 04 §9.35 gives.
- **When revisiting:** move it above the poster below `lg`, or shrink the poster on a reserved page.
- **Brings it back:** owner review on a phone, or the copy pass before launch.

## 16. A reserved page polls
- **What can happen:** every visible reserved page re-reads the license page data every 3 s for 30 s, then every 30 s, the same pace as `/r` during auto-approve. A hidden tab skips its ticks. It is there because a buyer leaving by a typed URL lands before their release arrives (AD-82), and any visitor gains from it. A paid exclusive request polls the same way for its whole approval window, at least four statements a refresh, though only the creator's decision or the deadline can end it. Someone refused with `video_reserved` has focus on the notice; when the hold ends and the page opens, the notice goes, focus falls to the page and nothing announces the change.
- **How likely, how bad:** a new repeated read on a public, logged-out page, not load-tested. A popular reserved video held open by many people multiplies it. The focus case is small and costs a keyboard user one Tab.
- **What stops it today:** the 30 s pace after the first 30 s, the hidden-tab rule, and only `reserved` polls, not `exclusive_active` or `renewal_reserved`.
- **When revisiting:** stop polling after a few minutes, or poll a small availability endpoint instead of the whole page. A display fact for a paid hold (none exists, risk 7) would spare those pages the fast first 30 s. Announce the page opening and keep focus if keyboard users hit it.
- **Brings it back:** P31a's throttles and P32's load checks, or a spike in `getLicensePageData` once traffic is real.

## 17. Extend doesn't apply T2's mock gate
- **What can happen:** Extend refuses only on the video's `status`, while T2 also applies `isPubliclyAvailable`'s mock gate. A published video hidden by a Demo posting can be extended, and T2 then abandons the request as `video_unavailable` after the card is authorized.
- **How likely, how bad:** close to unreachable: T1's early check refuses a hidden video, and a Demo posting is only taken while `mock` is enabled, so it takes `ENABLED_SOCIAL_PROVIDERS` dropping `mock` during an open session of up to 60 minutes. The card hold is released and nothing is charged.
- **What stops it today:** T2's own check. T1's check under the lock is status-only as well (AD-57), so Extend matches that one.
- **When revisiting:** one publicity check in `src/server/licensing/availability.ts` for T1's locked read, T2 and Extend. It changes a refusal, so it was left out of the simplify pass.
- **Brings it back:** a deploy that changes `ENABLED_SOCIAL_PROVIDERS`, or P25.
