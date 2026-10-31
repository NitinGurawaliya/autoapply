export class CaptchaRequiredError extends Error {
  constructor(message = "Keka CAPTCHA verification required") {
    super(message);
    this.name = "CaptchaRequiredError";
  }
}

export class CaptchaInvalidError extends Error {
  constructor(message = "Keka CAPTCHA validation failed") {
    super(message);
    this.name = "CaptchaInvalidError";
  }
}