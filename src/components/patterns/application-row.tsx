import type { ReactNode } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { CompanyMark, StatusMark } from "@/components/ui/marks";
import { SegmentedProgress } from "@/components/ui/segmented-progress";

// The four kinds of row on the applications list (design/applications.html). Each row is an <li> with a link to the
// application; actions (cancel, retry) sit outside the link so they stay separate buttons.

/** Waiting for the user: raised card with what they asked and a lime button. */
export function NeedsRow({
  href,
  company,
  role,
  when,
  ask,
  cta,
  actions,
}: {
  href: string;
  company: string;
  role: string;
  when: string;
  ask: string;
  cta: string;
  actions?: ReactNode;
}) {
  return (
    <li data-row="needs" className="box-border flex flex-col gap-3 rounded-panel border-2 border-edge bg-surface p-3.5 shadow-hard">
      <Link href={href} className="flex flex-col gap-3 text-foreground no-underline">
        <div className="flex items-center gap-3">
          <CompanyMark name={company} size={44} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold">{role}</span>
            <span className="text-[13px] text-muted-foreground">
              {company} · paused {when}
            </span>
          </div>
        </div>
        <p className="m-0 text-[15px] leading-[1.4]">{ask}</p>
      </Link>
      <Link href={href} className={buttonVariants({ variant: "primary", size: "row", className: "w-full shadow-none" })}>
        {cta}
      </Link>
      {actions ? <div className="-mt-1 flex justify-center">{actions}</div> : null}
    </li>
  );
}

/** The agent is working on it: four segments and the stage in words. */
export function ProgressRow({
  href,
  company,
  role,
  stage,
  label,
  actions,
}: {
  href: string;
  company: string;
  role: string;
  stage: number;
  label: string;
  actions?: ReactNode;
}) {
  return (
    <li data-row="progress" className="box-border flex flex-col gap-2 rounded-[18px] border-[1.5px] border-line bg-surface p-3.5">
      <Link href={href} className="flex flex-col gap-3 text-foreground no-underline">
        <div className="flex items-center gap-3">
          <CompanyMark name={company} size={40} tone="subtle" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold">{role}</span>
            <span className="text-[13px] text-muted-foreground">{company}</span>
          </div>
        </div>
        <SegmentedProgress count={4} done={stage + 1} />
      </Link>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span className="text-[13px] font-medium">{label}</span>
        {actions ? <span className="-my-2 flex-none">{actions}</span> : null}
      </div>
    </li>
  );
}

/** Sent: a quiet row with an ink check. */
export function SentRow({ href, company, role, when }: { href: string; company: string; role: string; when: string }) {
  return (
    <li data-row="sent">
      <Link
        href={href}
        className="box-border flex min-h-16 items-center gap-3 rounded-[18px] border-[1.5px] border-line bg-surface py-2.5 pr-3 pl-3.5 text-foreground no-underline"
      >
        <CompanyMark name={company} size={40} tone="subtle" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-semibold">{role}</span>
          <span className="text-[13px] text-muted-foreground">
            {company} · {when}
          </span>
        </div>
        <StatusMark kind="ok" />
        <span className="sr-only">Sent</span>
      </Link>
    </li>
  );
}

/** Didn't go through: dashed, with the reason and what to do (Retry, or nothing). */
export function FailedRow({
  href,
  company,
  role,
  reason,
  action,
}: {
  href: string;
  company: string;
  role: string;
  reason: string;
  action?: ReactNode;
}) {
  return (
    <li
      data-row="failed"
      className="box-border flex min-h-16 items-center gap-3 rounded-[18px] border-[1.5px] border-dashed border-dash py-3 pr-3 pl-3.5"
    >
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 text-foreground no-underline">
        <CompanyMark name={company} size={40} tone="outline" />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[15px] font-semibold">
            {role} · {company}
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Icon name="info" size={14} strokeWidth={2.25} className="flex-none" />
            {reason}
          </span>
        </div>
      </Link>
      <span className="flex-none">{action ?? <span className="text-[13px] font-semibold text-muted-foreground">Nothing to do</span>}</span>
    </li>
  );
}
