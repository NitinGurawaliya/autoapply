import { SITES } from "@/modules/sources/sites";

/**
 * Sources whose jobs are never shown publicly or counted for a public page (Phase W, docs/employers/TDD.md 4.7):
 * signed-in ones (Naukri, read through a user's own account) and the mock board. No database: pure code may import it.
 */
export const PRIVATE_SOURCES: readonly string[] = [...SITES, "mock"];
