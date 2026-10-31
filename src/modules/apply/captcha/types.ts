export type CaptchaType =
  | "none"
  | "image-text"
  | "unknown";

export interface CaptchaInspection {
  required: boolean;
  type: CaptchaType;
  imageVisible: boolean;
  inputVisible: boolean;
  refreshAvailable: boolean;
  invalidMessageVisible: boolean;
  emptyMessageVisible: boolean;
}