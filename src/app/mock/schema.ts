import { z } from "zod";

export const mockPayloadSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().min(1),
  phone: z.string().min(1),
  how_heard: z.string().min(1),
  notice_period: z.string().min(1),
  work_authorization: z.string().min(1),
  free_text: z.string().min(1),
  gender: z.string().min(1),
  race: z.string().min(1),
  veteran_status: z.string().min(1),
  disability: z.string().min(1),
  resumeFileName: z.string().min(1),
});

export type MockPayload = z.infer<typeof mockPayloadSchema>;
