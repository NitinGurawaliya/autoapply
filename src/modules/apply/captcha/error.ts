import type { CaptchaBoard } from "./types";

const NAMES: Record<CaptchaBoard, string> = { keka: "Keka", zohorecruit: "Zoho Recruit" };

export class CaptchaRequiredError extends Error {
  constructor(board: CaptchaBoard = "keka", message = `${NAMES[board]} CAPTCHA verification required`) {
    super(message);
    this.name = "CaptchaRequiredError";
  }
}

export class CaptchaInvalidError extends Error {
  constructor(board: CaptchaBoard = "keka", message = `${NAMES[board]} CAPTCHA validation failed`) {
    super(message);
    this.name = "CaptchaInvalidError";
  }
}
