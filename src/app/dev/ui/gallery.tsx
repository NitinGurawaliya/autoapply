"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { AccentPill, Chip, CountChip, RemovableChip, SkillTag, SoftChip, Tag } from "@/components/ui/chip";
import { FieldError, FieldLabel, InputBox, NativeSelect } from "@/components/ui/field";
import { CheckRow } from "@/components/ui/check-row";
import { OtpInput } from "@/components/ui/otp-input";
import { Surface } from "@/components/ui/surface";
import { CompanyMark, MatchBadge, StatusMark, StatusPill, stampClass } from "@/components/ui/marks";
import { SourceBadge } from "@/components/ui/source-badge";
import { ProgressBar, SegmentedProgress } from "@/components/ui/segmented-progress";
import { Eyebrow, Skeleton } from "@/components/ui/eyebrow";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ShellProvider } from "@/components/patterns/shell-context";
import { BackTopBar, FeedTopBar, TitleTopBar, UsagePill } from "@/components/patterns/top-bar";
import { TabBar } from "@/components/patterns/tab-bar";
import { PageIntro, StepHeader, StickyFooter } from "@/components/patterns/layout";
import { ChipGroup } from "@/components/patterns/chip-group";
import { Callout, EmptyState, InfoNote, Row, SectionCard, TrustPanel } from "@/components/patterns/content";
import { DeckDoneArt, DeckEmptyArt, ResumeSketch, SignInArt } from "@/components/patterns/drawings";
import { JobCard } from "@/components/patterns/job-card";
import { AgentToast } from "@/components/patterns/agent-toast";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Eyebrow as="h2">{title}</Eyebrow>
      {children}
    </section>
  );
}

function Primitives() {
  const [notice, setNotice] = useState("30 days");
  const [code, setCode] = useState("48");
  const [remember, setRemember] = useState(true);
  return (
    <div className="flex flex-col gap-8">
      <Section title="Type">
        <p className="m-0 type-display-2xl">Swipe right.</p>
        <p className="m-0 type-display-xl">Backend Engineer, Payments</p>
        <p className="m-0 type-display-lg">Applications</p>
        <p className="m-0 type-display-md">You&apos;re all caught up</p>
        <p className="m-0 type-display-sm">Filters</p>
        <p className="m-0 type-title">Can you work from our Pune office 3 days a week?</p>
        <p className="m-0 type-lead">Your Go, Postgres and Kafka work lines up.</p>
        <p className="m-0 type-callout">Backend Engineer, Payments</p>
        <p className="m-0 type-caption text-muted-foreground">Lumen Pay · paused 4m ago</p>
      </Section>

      <Section title="Buttons">
        <Button variant="primary" size="xl">Show 48 jobs</Button>
        <Button variant="primary" size="xl" disabled>Read my resume</Button>
        <Button variant="line" size="lg">Widen my filters</Button>
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="strong" size="lg">Paste code</Button>
          <Button variant="plain" size="lg">Open email</Button>
        </div>
        <Button variant="primary" size="md" className="rounded-field">Retry</Button>
        <Button variant="plain" size="md" className="rounded-field">Leave it</Button>
        <Button variant="primary" size="row" className="shadow-none">Answer</Button>
        <div className="flex gap-4">
          <Button variant="underline" size="text">Reset</Button>
          <Button variant="quiet" size="text">Later</Button>
        </div>
      </Section>

      <Section title="Icon buttons">
        <div className="flex items-center gap-3">
          <IconButton variant="subtle" aria-label="Your profile and sign out">AK</IconButton>
          <IconButton variant="line" aria-label="Filters"><Icon name="filters" size={20} /></IconButton>
          <IconButton variant="ghost" aria-label="Back"><Icon name="back" size={22} strokeWidth={2.25} /></IconButton>
          <IconButton variant="skip" size="skip" aria-label="Skip"><Icon name="close" size={26} strokeWidth={2.25} /></IconButton>
          <IconButton variant="apply" size="apply" aria-label="Apply"><Icon name="check" size={30} strokeWidth={2.5} /></IconButton>
        </div>
      </Section>

      <Section title="Chips">
        <div className="flex flex-wrap gap-2">
          {["Immediate", "15 days", "30 days", "60 days"].map((label) => (
            <Chip key={label} selected={notice === label} onClick={() => setNotice(label)}>{label}</Chip>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <Chip shape="tab" selected count={26}>All</Chip>
          <Chip shape="tab" count={2}>Needs you</Chip>
          <Chip shape="tab" count={3}>In progress</Chip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Chip shape="block" selected>Yes</Chip>
          <Chip shape="block">No</Chip>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Chip shape="answer" selected>Yes</Chip>
          <Chip shape="answer">No</Chip>
        </div>
        <div className="flex flex-wrap gap-2">
          <RemovableChip aria-label="Remove filter US">US</RemovableChip>
          <Tag>Bengaluru · Hybrid</Tag>
          <Tag>Asks 2–4 yrs</Tag>
          <SoftChip>19 sent today</SoftChip>
          <SkillTag>Postgres</SkillTag>
          <AccentPill>Needs you · 1 of 2</AccentPill>
          <CountChip label="Resume" count={5} />
          <CountChip label="AI draft" count={1} dashed />
        </div>
      </Section>

      <Section title="Fields">
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="g-ctc">Current CTC</FieldLabel>
          <InputBox id="g-ctc" inputMode="decimal" defaultValue="12.5" prefix="₹" suffix="lakh a year" />
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel tone="small" htmlFor="g-ph">Phone</FieldLabel>
          <InputBox id="g-ph" tone="soft" inputMode="numeric" placeholder="10-digit mobile" prefix="+91" />
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel tone="muted" htmlFor="g-visa">Current visa status</FieldLabel>
          <NativeSelect id="g-visa"><option>No work visa yet</option><option>H-1B</option></NativeSelect>
        </div>
        <FieldError>Their form rejected this one</FieldError>
        <CheckRow title="Remember for similar questions" hint="So you're never asked this twice." checked={remember} onChange={() => setRemember(!remember)} />
      </Section>

      <Section title="Code input">
        <OtpInput id="g-code" label="8-character code" length={8} value={code} onChange={setCode} />
      </Section>

      <Section title="Surfaces">
        <Surface variant="raised" className="p-4">Raised · ink edge and hard shadow</Surface>
        <Surface variant="quiet" radius="row" className="p-4">Quiet · hairline</Surface>
        <Surface variant="dashed" radius="row" className="p-4">Dashed · didn&apos;t go through</Surface>
        <Surface variant="outline" className="p-4">Dashed ink · missing field</Surface>
        <Surface variant="subtle" className="p-4">Subtle · trust panel</Surface>
      </Section>

      <Section title="Marks">
        <div className="flex items-center gap-3">
          <CompanyMark name="Lumen Pay" size={56} />
          <CompanyMark name="Lumen Pay" size={48} />
          <CompanyMark name="Kestrel Labs" size={44} />
          <CompanyMark name="Tidewave" size={40} tone="subtle" />
          <CompanyMark name="Arcwise" size={40} tone="outline" />
          <CompanyMark name="Lumen Pay" size={36} tone="accent" />
        </div>
        <div className="flex items-center gap-4">
          <MatchBadge score={86} />
          <MatchBadge score={86} size="md" />
          <StatusMark kind="ok" />
          <StatusMark kind="stop" />
        </div>
        <div className="relative h-36 overflow-hidden rounded-panel border-[1.5px] border-line bg-surface">
          <span className={stampClass("apply")}>APPLY</span>
          <span className={stampClass("skip")}>SKIP</span>
        </div>
        <StatusPill kind="ok">Sent today, 10:42</StatusPill>
        <StatusPill kind="stop">Didn&apos;t go through</StatusPill>
      </Section>

      <Section title="Source badges">
        <div className="flex flex-wrap gap-2">
          {["resume", "user", "matched", "derived", "default", "ai_draft"].map((source) => (
            <SourceBadge key={source} source={source} />
          ))}
        </div>
      </Section>

      <Section title="Progress">
        <SegmentedProgress count={3} done={1} thickness={6} />
        <SegmentedProgress count={4} done={2} />
        <div className="rounded-[20px] bg-inverse p-3.5">
          <SegmentedProgress count={4} done={2} tone="toast" thickness={4} />
        </div>
        <ProgressBar value={60} />
        <Skeleton className="h-20" />
      </Section>

      <Section title="Sheet">
        <Sheet>
          <SheetTrigger render={<Button variant="line" size="lg" />}>Open a sheet</SheetTrigger>
          <SheetContent aria-label="Example sheet">
            <SheetTitle className="mt-2.5 type-display-sm">Filters</SheetTitle>
            <p className="type-callout text-muted-foreground">Tap outside or press Escape to close.</p>
          </SheetContent>
        </Sheet>
      </Section>
    </div>
  );
}

const JOB = {
  company: "Lumen Pay",
  role: "Backend Engineer, Payments",
  posted: "Posted 3h ago",
  why: "Your Go, Postgres and Kafka work lines up, and your 3 years fits their 2–4.",
  where: "Bengaluru · Hybrid",
  asks: "Asks 2+ yrs",
  score: 86,
};

function Patterns() {
  const [places, setPlaces] = useState(["India", "Remote"]);
  return (
    <ShellProvider value={{ name: "Aarav Kumar", email: "aarav.kumar@email.com", signOut: <Button variant="plain" size="row" className="w-full">Sign out</Button> }}>
      <div className="flex flex-col gap-8">
        <Section title="Top bars">
          <div className="-mx-5 flex flex-col gap-5">
            <FeedTopBar
              usage={<UsagePill used={18} cap={100} />}
              filters={<IconButton variant="line" aria-label="Filters"><Icon name="filters" size={20} /></IconButton>}
            />
            <TitleTopBar title="Applications" sub="19 sent today · 81 left · Your agent is working on 3" />
            <BackTopBar href="#" label="Application" backLabel="Back to applications" />
            <StepHeader step={2} onBack={() => undefined} />
          </div>
        </Section>
        <Section title="Tab bar">
          <div className="-mx-5"><TabBar placement="static" /></div>
        </Section>
        <Section title="Job card">
          <div className="relative mt-[18px] grid">
            <article className="relative">
              <JobCard job={JOB} />
            </article>
          </div>
        </Section>
        <Section title="After-swipe toast">
          <AgentToast company="Lumen Pay" stage={1} href="#" visible />
        </Section>
        <Section title="Page intro and notes">
          <PageIntro title="Start with your resume" sub="We read it once, so you never retype your details again." />
          <PageIntro eyebrow="Questions 1 of 2" title="A few answers every form asks" />
          <InfoNote>Private to you. Used only for jobs you swipe right on.</InfoNote>
          <InfoNote size="sm">The agent never answers questions like this without you.</InfoNote>
          <Callout>We never guess these. They only go to jobs you swipe right on, and if a form asks something new, we&apos;ll pause and ask you.</Callout>
          <ChipGroup
            legend="Where · pick any"
            options={["India", "Remote", "Abroad"].map((label) => ({ label, selected: places.includes(label), onSelect: () => setPlaces(places.includes(label) ? places.filter((x) => x !== label) : [...places, label]) }))}
          />
        </Section>
        <Section title="Section card">
          <SectionCard title="Basics" action={<span className="text-xs text-muted-foreground">From your resume</span>}>
            <Row label="Full name" value="Aarav Kumar" action={<IconButton aria-label="Edit full name" className="text-muted-foreground"><Icon name="edit" size={18} /></IconButton>} />
            <Row label="Jun 2022 to now · Bengaluru" value="Backend Engineer · Finch Labs" order="value-first" />
          </SectionCard>
          <TrustPanel text="Every answer came from your resume, from you, or a standard default." counts={[{ source: "resume", count: 5 }, { source: "user", count: 5 }, { source: "ai_draft", count: 1 }]} />
        </Section>
        <Section title="Empty states">
          <EmptyState art={<DeckDoneArt />} title="You're all caught up" text="You've seen every match for now." actions={<Button variant="primary" size="xl">See my applications</Button>} />
          <EmptyState art={<DeckEmptyArt />} title="No jobs match these filters" text="Try removing one." headingLevel="h2" />
        </Section>
        <Section title="Drawings">
          <SignInArt />
          <ResumeSketch band={2} />
        </Section>
        <Section title="Sticky footer">
          <div className="-mx-6"><StickyFooter><Button variant="primary" size="xl" className="w-full">Looks right</Button></StickyFooter></div>
        </Section>
      </div>
    </ShellProvider>
  );
}

export function Gallery() {
  return (
    <div className="flex flex-wrap items-start">
      <div data-gallery="light" className="box-border w-[390px] bg-background px-5 py-10 text-foreground">
        <Primitives />
        <div className="mt-12"><Patterns /></div>
      </div>
      <div data-gallery="dark" className="dark box-border w-[390px] bg-background px-5 py-10 text-foreground">
        <Primitives />
        <div className="mt-12"><Patterns /></div>
      </div>
    </div>
  );
}
