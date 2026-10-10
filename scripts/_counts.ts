import { db } from "../src/lib/db";
Promise.all([db.job.count(), db.company.count(), db.application.count(), db.answer.count(), db.profile.count(), db.jobJudgement.count()]).then((c) => console.log("COUNTS jobs,companies,applications,answers,profiles,judgements", c.join(","))).finally(() => db.$disconnect());
