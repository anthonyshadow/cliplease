"use client";

import { Ellipsis, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { SHELL_MAIN } from "@/components/layout/gutter";
import { MoreSheet } from "@/components/layout/more-sheet";
import { NavBar } from "@/components/layout/nav-bar";
import { TabBar } from "@/components/layout/tab-bar";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { CopyLinkField } from "@/components/ui/copy-link-field";
import { DataTable } from "@/components/ui/data-table";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FactList } from "@/components/ui/fact-list";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectField } from "@/components/ui/select-field";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CountdownChip,
  StatusPill,
  type StatusPillDot,
  type StatusPillTone,
} from "@/components/ui/status-pill";
import { Stepper } from "@/components/ui/stepper";
import { Switch } from "@/components/ui/switch";
import { TextArea, TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/app-name";
import { formatLicenseDate, formatMoney } from "@/lib/format";
import { CURRENCY_DISPLAY } from "@/lib/money/currency";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/lib/time";
import { cn } from "@/lib/utils";

// Every label in the 04 §9.9 table, with its dot.
const PILLS: readonly {
  tone: StatusPillTone;
  dot?: StatusPillDot;
  label: string;
}[] = [
  { tone: "neutral", dot: "solid", label: "Connected" },
  { tone: "neutral", dot: "solid", label: "Live" },
  { tone: "neutral", dot: "solid", label: "Verified" },
  { tone: "neutral", dot: "solid", label: "Auto-renew on" },
  { tone: "neutral", dot: "hollow", label: "Draft" },
  { tone: "neutral", dot: "hollow", label: "Not verified" },
  { tone: "neutral", dot: "hollow", label: "Upcoming" },
  { tone: "neutral", dot: "hollow", label: "Auto-renew off" },
  { tone: "neutral", dot: "hollow", label: "Doesn't renew" },
  { tone: "neutral", label: "Off" },
  { tone: "neutral", label: "Declined" },
  { tone: "neutral", label: "Expired" },
  { tone: "neutral", label: "Licensable" },
  { tone: "neutral", label: "Private" },
  { tone: "neutral", label: "Short" },
  { tone: "neutral", label: "Processing…" },
  { tone: "neutral", label: "Exclusive" },
  { tone: "neutral", label: "Ended" },
  { tone: "awaiting", label: "Needs reconnect" },
  { tone: "awaiting", label: "Sync problem" },
  { tone: "awaiting", label: "Waiting for you" },
  { tone: "awaiting", label: "Finish payout setup" },
  { tone: "awaiting", label: "Price change waiting" },
  { tone: "awaiting", label: "Payment needed" },
  { tone: "awaiting", label: "Reserved for you" },
  { tone: "awaiting", label: "Reserved" },
  { tone: "awaiting", label: "Exclusive request waiting" },
  { tone: "cleared", label: "Approved" },
  { tone: "cleared", label: "Valid" },
  { tone: "danger", label: "Payment failed" },
  { tone: "danger", label: "Revoked" },
  { tone: "danger", label: "Revoked · refunded" },
  { tone: "danger", label: `Disabled by ${APP_NAME}` },
];

const COUNTDOWN_OFFSETS = [
  { name: "3 d", ms: 3 * DAY_MS },
  { name: "5 h", ms: 5 * HOUR_MS },
  { name: "42 min", ms: 42 * MINUTE_MS },
  { name: "0", ms: 0 },
] as const;

const REGIONS = [
  "North America (US & Canada)",
  "Latin America & Caribbean",
  "Europe",
  "Middle East & Africa",
  "Asia-Pacific",
];

// A long list, so the sheet body scrolls.
const COUNTRIES = [
  "Canada",
  "United States",
  "Mexico",
  "Brazil",
  "United Kingdom",
  "France",
  "Germany",
  "Spain",
  "Nigeria",
  "India",
  "Japan",
  "Australia",
];

const TABLE_ROWS = [
  { code: "CL-7K3M-9QXA", licensee: "Daily Laughs Media", cents: 173250 },
  { code: "CL-2PQR-4XYZ", licensee: "Northside Studio", cents: 46200 },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-hairline pt-8">
      <h2 className="text-title-2 text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Each NavBar demo sits in its own frame, so its sticky header stays inside the frame. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-hairline">
      {children}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-callout font-semibold text-ink-2">{title}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function ButtonBlock({
  size,
  state,
}: {
  size: "lg" | "sm";
  state: "rest" | "disabled" | "loading";
}) {
  const disabled = state === "disabled";
  const loading = state === "loading";
  return (
    <Block title={`${size} · ${state}`}>
      <Button
        size={size}
        disabled={disabled}
        loading={loading}
        loadingLabel="Approving…"
      >
        Approve
      </Button>
      <Button
        size={size}
        variant="secondary"
        disabled={disabled}
        loading={loading}
        loadingLabel="Declining…"
      >
        Decline
      </Button>
      <Button size={size} variant="tertiary" disabled={disabled}>
        Cancel
      </Button>
      <Button
        size={size}
        variant="destructive"
        disabled={disabled}
        loading={loading}
        loadingLabel="Revoking…"
      >
        Revoke and refund
      </Button>
      {state === "rest" ? (
        <Button size={size} variant="link" asChild>
          <Link href="/legal/license/v1">License terms</Link>
        </Button>
      ) : null}
    </Block>
  );
}

/** 04 §9.22's one ConfirmSheet whose safe action is the primary; the confirm shows its loading label. */
function TurnOffDemo() {
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmSheet
      trigger={<Button variant="secondary">Turn off auto-renewal</Button>}
      onOpenChange={(open) => {
        if (!open) setBusy(false);
      }}
      title="Turn off auto-renewal?"
      description={`Your license stays valid until ${formatLicenseDate(new Date("2027-10-31T12:00:00Z"))}. After that, @maya.films can license this video to others right away. Because you're turning it off yourself, we won't hold the video for you after your license ends.`}
      confirmLabel="Turn off auto-renewal"
      confirmVariant="secondary"
      confirmLoading={busy}
      confirmLoadingLabel="Turning off…"
      onConfirm={(event) => {
        event.preventDefault();
        setBusy(true);
      }}
      cancelLabel="Keep it on"
      cancelVariant="primary"
    />
  );
}

/** Countdown chips need "now", which is read only after mount (no Date.now() during render). */
function CountdownDemos() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  if (now === null) return null;
  return (
    <>
      {COUNTDOWN_OFFSETS.map((offset) => (
        <CountdownChip
          key={offset.name}
          expiresAt={new Date(now + offset.ms).toISOString()}
        />
      ))}
      <CountdownChip
        expiresAt={new Date(now + 5 * HOUR_MS).toISOString()}
        srPrefix="Waiting for you"
      />
      <CountdownChip
        expiresAt={new Date(now + 42 * MINUTE_MS).toISOString()}
        tone="neutral"
      />
    </>
  );
}

export function Gallery({ view }: { view: "waiting" | "history" }) {
  const [step, setStep] = useState(0);
  const user = { name: "Maya Ruiz" };
  return (
    <main className={cn(SHELL_MAIN, "flex flex-col gap-10 pt-8 pb-8 lg:pb-12")}>
      <div className="flex flex-col gap-2">
        <h1 className="text-title-1 text-ink">
          UI primitives <span className="text-ink-2">and shell</span>
        </h1>
        <p className="text-callout text-ink-2">
          Dev-only review page. Add ?theme=light or ?theme=dark to force a
          theme.
        </p>
      </div>

      <Section title="Buttons">
        {(["lg", "sm"] as const).flatMap((size) =>
          (["rest", "disabled", "loading"] as const).map((state) => (
            <ButtonBlock key={`${size}-${state}`} size={size} state={state} />
          )),
        )}
        <Block title="icon · rest, disabled, loading">
          <Button size="icon" aria-label="More actions">
            <Ellipsis aria-hidden />
          </Button>
          <Button size="icon" aria-label="More actions" disabled>
            <Ellipsis aria-hidden />
          </Button>
          <Button size="icon" aria-label="More actions" loading>
            <Ellipsis aria-hidden />
          </Button>
        </Block>
      </Section>

      <Section title="Fields">
        <div className="grid gap-6 md:grid-cols-2">
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="sam@dailylaughs.com"
            helper="We'll send a 6-digit code."
          />
          <TextField
            label="Email"
            type="email"
            defaultValue="sam@"
            error="Enter an email address like sam@dailylaughs.com."
          />
          <TextField
            label="Base price"
            prefix={CURRENCY_DISPLAY.cad.prefix}
            inputMode="decimal"
            defaultValue="150"
            helper={`${formatMoney(1000, "cad", { wholeDollars: true })} to ${formatMoney(1000000, "cad", { wholeDollars: true })}. New requests only.`}
          />
          <TextField label="Handle" defaultValue="maya.films" readOnly />
          <TextField
            label="Company"
            optional
            disabled
            defaultValue="Daily Laughs Media"
          />
          <SelectField label="Region" defaultValue={REGIONS[0]}>
            {REGIONS.map((region) => (
              <option key={region}>{region}</option>
            ))}
          </SelectField>
          <SelectField label="Reason" defaultValue="" error="Choose a reason.">
            <option value="" disabled>
              Choose…
            </option>
            <option value="rights_claim">Rights claim</option>
            <option value="prohibited_content">Prohibited content</option>
            <option value="other">Other</option>
          </SelectField>
          <TextArea label="Planned use" optional rows={3} />
          <div className="flex flex-col gap-2">
            <Checkbox label="I'm 18 or older" defaultChecked />
            <Checkbox
              label="I'm 18 or older"
              error={`You must be 18 or older to sell on ${APP_NAME}.`}
            />
            <Switch label="Approve requests automatically" defaultChecked />
            <Switch label="Show buyers this link" />
          </div>
        </div>
      </Section>

      <Section title="Status">
        <SegmentedControl
          label="Requests"
          className="max-w-sm"
          items={[
            {
              href: "/dev/ui?view=waiting",
              label: "Waiting 2",
              current: view === "waiting",
            },
            {
              href: "/dev/ui?view=history",
              label: "History",
              current: view === "history",
            },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {PILLS.map((pill) => (
            <StatusPill key={pill.label} tone={pill.tone} dot={pill.dot}>
              {pill.label}
            </StatusPill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <CountdownDemos />
        </div>
      </Section>

      <Section title="Feedback">
        <Notice
          title="Payouts"
          action={
            <Button variant="link" size="sm" asChild>
              <Link href="/dev/ui">Set up payouts</Link>
            </Button>
          }
        >
          You can publish now. You'll need payouts set up to approve a request.
        </Notice>
        <Banner tone="info">
          Set up payouts so you can approve requests (about 2 min)
        </Banner>
        <Banner tone="warning">
          Draft for testing. Not for real transactions.
        </Banner>
        <Banner tone="error">Something went wrong. Try again.</Banner>
        <EmptyState
          title={
            <>
              Library. <span className="text-ink-2">Nothing here yet.</span>
            </>
          }
          description="Your videos from Instagram, TikTok and YouTube show up here."
          actions={
            <>
              <Button>Connect an account</Button>
              <Button variant="tertiary">Or upload a video</Button>
            </>
          }
        />
        <FactList
          facts={[
            { label: "Licensed to", value: "Daily Laughs Media" },
            { label: "Scope", value: "Paid social ads · 1 year · Worldwide" },
            {
              label: "You get",
              value: `${formatMoney(157500, "cad")} (buyer pays ${formatMoney(173250, "cad")} incl. service fee)`,
            },
            {
              label: "Payment",
              value: "Card on hold. Charged only if you approve.",
            },
          ]}
        />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="aspect-video w-64" />
        </div>
        <Progress value={46} label="Upload progress" className="max-w-sm" />
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-3">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary">Open sheet</Button>
            </SheetTrigger>
            <SheetContent
              title="Which countries?"
              footer={<Button>Done</Button>}
            >
              <ul className="flex flex-col">
                {COUNTRIES.map((country) => (
                  <li
                    key={country}
                    className="flex min-h-11 items-center border-b border-hairline"
                  >
                    {country}
                  </li>
                ))}
              </ul>
            </SheetContent>
          </Sheet>
          <ConfirmSheet
            trigger={<Button variant="secondary">Revoke license</Button>}
            title="Revoke license?"
            description={`This refunds the buyer ${formatMoney(173250, "cad")} and takes back ${formatMoney(157500, "cad")} from @maya.films.`}
            confirmLabel="Revoke and refund"
            cancelLabel="Keep license"
          />
          <TurnOffDemo />
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary">Open menu</Button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem>Copy link</MenuItem>
              <MenuItem>Turn off</MenuItem>
            </MenuContent>
          </Menu>
          <Button variant="secondary" onClick={() => toast("Link copied")}>
            Show toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast("Video turned off", {
                action: {
                  label: "Undo",
                  altText: "Turn the video back on",
                  onClick: () => {},
                },
              })
            }
          >
            Show toast with action
          </Button>
        </div>
        <Disclosure label="Details">
          <FactList
            facts={[
              { label: "Contact", value: "Sam Lee" },
              { label: "Planned use", value: "Weekly highlights reel" },
            ]}
          />
        </Disclosure>
      </Section>

      <Section title="Composites">
        <CopyLinkField
          label="Video link"
          url="https://cliplease.com/@maya.films/first-snow-on-the-lake"
          className="max-w-md"
        />
        <div className="flex flex-col gap-6">
          <Stepper steps={["File", "Rights", "Review"]} current={step % 3} />
          <Stepper
            steps={["File", "Where posted", "Rights", "Review"]}
            current={step % 4}
          />
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => setStep((s) => s + 1)}
          >
            Next step
          </Button>
        </div>
        <DataTable
          caption="Licenses"
          rows={TABLE_ROWS}
          rowKey={(row) => row.code}
          columns={[
            { header: "Code", cell: (row) => row.code },
            { header: "Licensed to", cell: (row) => row.licensee },
            {
              header: "Total",
              cell: (row) => formatMoney(row.cents, "cad"),
              numeric: true,
            },
          ]}
        />
        <div className="flex items-center gap-3">
          <Avatar name="Maya Ruiz" />
          <Avatar name="Sam Lee" className="size-7" />
        </div>
      </Section>

      <Section title="Shell">
        <div className="flex flex-col gap-4">
          <Frame>
            <NavBar variant="public" />
          </Frame>
          <Frame>
            <NavBar
              variant="admin"
              below={
                <SegmentedControl
                  label="Admin"
                  className="pb-4"
                  items={[
                    { href: "/dev/ui", label: "Creators", current: true },
                    { href: "/dev/ui?tab=videos", label: "Videos" },
                    { href: "/dev/ui?tab=licenses", label: "Licenses" },
                  ]}
                />
              }
            />
          </Frame>
          <Frame>
            <NavBar
              variant="creator"
              current="inbox"
              inboxCount={2}
              user={user}
              signOut={<MenuItem>Sign out</MenuItem>}
            />
          </Frame>
          <MoreSheet
            trigger={<Button variant="secondary">Open MoreSheet</Button>}
            signOut={
              <button type="button" className="flex h-full w-full items-center">
                Sign out
              </button>
            }
          />
          <p className="flex items-center gap-2 text-callout text-ink-2">
            <TriangleAlert aria-hidden size={16} strokeWidth={2} />
            The TabBar below is the real fixed bar (hidden at lg and up).
          </p>
        </div>
      </Section>

      <TabBar current="inbox" inboxCount={2} />
    </main>
  );
}
