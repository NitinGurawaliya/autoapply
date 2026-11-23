-- K8 (docs/naukri/TDD.md 13.12, "Connect on a phone"): where the worker holding a user's streamed sign-in serves it,
-- set while that window is open and cleared when it ends. Useless on its own: the phone also needs a token only the
-- web app signs (modules/sources/stream-token.ts).
ALTER TABLE "SiteConnection" ADD COLUMN "streamUrl" TEXT;
