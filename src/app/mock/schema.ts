import { z } from "zod";

export const mockPayloadSchema = z.object({
  first_name: z.string().min(1).max(200),
  last_name: z.string().min(1).max(200),
  email: z.string().min(1).max(254),
  phone: z.string().min(1).max(40),
  how_heard: z.string().min(1).max(200),
  notice_period: z.string().min(1).max(200),
  work_authorization: z.string().min(1).max(200),
  free_text: z.string().min(1).max(4000),
  gender: z.string().min(1).max(200),
  race: z.string().min(1).max(200),
  veteran_status: z.string().min(1).max(200),
  disability: z.string().min(1).max(200),
  resumeFileName: z.string().min(1).max(300),
});

export type MockPayload = z.infer<typeof mockPayloadSchema>;
