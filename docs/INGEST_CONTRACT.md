# Ingest contract

Everything that finds jobs (today the Greenhouse, Lever and Ashby fetchers) hands the rest of the system the same thing: rows in `Job`. Nothing downstream knows which board a job came from except through `Job.source`.

## What a fetcher returns (`FetchedJob`)

`externalId` (stable id on the board), `title`, `location`, `description`, `applyUrl` (a public page on the board), `postedAt` (UTC), `raw`. Nothing else.

## What ingest guarantees

- One `Job` row per `(source, externalId)`; re-ingesting updates it and never duplicates it.
- Tags (`country`, `remoteType`, `experienceMin`) are computed once, in `tagPosting`.
- A job the company stops listing gets `closedAt`; it is reopened if it comes back.
- `closedAt` is set only after a fetch that worked and returned at least one job. An empty or failed response closes nothing.
- Companies are matched across boards by `companyKey(name)` and roles by `roleKey(companyKey, title)`, so the same role on two boards is one card in the feed and one role for the duplicate guard.

## What the rest of the system may rely on

- The feed never shows a closed job; a swipe on a closed job is refused with rule `job_closed`.
- The runner never reads `Job.raw`.

## Signed-in sources (Naukri, Phase K)

Read per user, not per company (ARCHITECTURE 6.20): a user's run hands `storeSiteListings` its listings, which go through the same write as a company's (`storeJobs`). Two differences: `markClosed` is never called (a search is not the company's board), so a job closes after 14 days unlisted by any search; and `Job.applyVia` names the board whose adapter applies when the listing sends the user to it. Their companies are stored inactive.

## Adding a board

Write `fetchers/<board>.ts` returning `FetchedJob[]`, add one entry in `modules/jobs/boards.ts` (fetcher, which jobs are stored, form hosts, slug rule, optional discovery settings; ingest, discovery and `apply/urls.ts` read it), add an adapter, and only then add it to `APPLY_BOARDS` after one real submit succeeded.
