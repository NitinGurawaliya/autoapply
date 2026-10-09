-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_type_createdAt_idx" ON "ApplicationEvent"("applicationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Job_source_country_postedAt_idx" ON "Job"("source", "country", "postedAt");
