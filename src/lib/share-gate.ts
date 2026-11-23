/**
 * Share links (`/j/...`, Phase U) are public pages. They are on in development and off in production until the phone
 * check passes (docs/share/TDD.md §8): SHARE_LINKS=1 switches them on, SHARE_LINKS=0 off, anywhere.
 */
export function shareLinksEnabled() {
  if (process.env.SHARE_LINKS === "1") return true;
  if (process.env.SHARE_LINKS === "0") return false;
  return process.env.NODE_ENV !== "production";
}
