import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HowHeardCombobox } from "./how-heard";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const eeoFields = [
  { id: "gender", label: "Gender" },
  { id: "race", label: "Race" },
  { id: "veteran_status", label: "Veteran status" },
  { id: "disability", label: "Disability" },
] as const;

export default async function MockGreenhousePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Apply</h1>
        <p className="mt-1 text-sm text-muted-foreground">Mock Greenhouse form</p>
      </div>
      {error ? (
        <p className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error === "resume" ? "Choose a resume file." : "Fill every field."}
        </p>
      ) : null}
      <form
        action="/api/mock/submit"
        method="post"
        encType="multipart/form-data"
        className="flex flex-col gap-4"
      >
        <Field id="first_name" label="First name" />
        <Field id="last_name" label="Last name" />
        <Field id="email" label="Email" type="email" />
        <Field id="phone" label="Phone" type="tel" />
        <div className="flex flex-col gap-2">
          <Label htmlFor="resume">Resume</Label>
          <Input id="resume" name="resume" type="file" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="how_heard">How did you hear about us?</Label>
          <HowHeardCombobox />
        </div>
        <Field id="notice_period" label="Notice period" />
        <div className="flex flex-col gap-2">
          <Label htmlFor="work_authorization">Work authorization</Label>
          <select
            id="work_authorization"
            name="work_authorization"
            required
            defaultValue=""
            className={selectClass}
          >
            <option value="" disabled>
              Select
            </option>
            <option value="Authorized">Authorized</option>
            <option value="Need sponsorship">Need sponsorship</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="free_text">Why this role?</Label>
          <Textarea id="free_text" name="free_text" required rows={4} />
        </div>
        <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium">Voluntary self-identification</legend>
          {eeoFields.map((field) => (
            <div key={field.id} className="flex flex-col gap-2">
              <Label htmlFor={field.id}>{field.label}</Label>
              <select
                id={field.id}
                name={field.id}
                required
                defaultValue="Decline to answer"
                className={selectClass}
              >
                <option>Decline to answer</option>
                <option>Yes</option>
                <option>No</option>
              </select>
            </div>
          ))}
        </fieldset>
        <Button type="submit" className="w-full">
          Submit application
        </Button>
      </form>
    </main>
  );
}

function Field({
  id,
  label,
  type = "text",
}: {
  id: string;
  label: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} type={type} required />
    </div>
  );
}
