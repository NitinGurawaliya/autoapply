export type CaptchaType =
  | "none"
  | "image-text"
  | "unknown";

/** The boards whose image CAPTCHA the worker reads (Keka since T96, Zoho Recruit since 21 Nov). */
export type CaptchaBoard = "keka" | "zohorecruit";

export interface CaptchaInspection {
  board: CaptchaBoard;
  required: boolean;
  type: CaptchaType;
  imageVisible: boolean;
  inputVisible: boolean;
  refreshAvailable: boolean;
  invalidMessageVisible: boolean;
  emptyMessageVisible: boolean;
}
