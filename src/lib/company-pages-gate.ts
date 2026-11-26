/**
 * The company pages (`/companies...`, Phase W) are public. They are on in development and off in production until the
 * switch-on (docs/employers/TDD.md §8, W8): COMPANY_PAGES=1 switches them on, COMPANY_PAGES=0 off, anywhere.
 */
export function companyPagesEnabled() {
  if (process.env.COMPANY_PAGES === "1") return true;
  if (process.env.COMPANY_PAGES === "0") return false;
  return process.env.NODE_ENV !== "production";
}
