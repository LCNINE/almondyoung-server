# Night maintenance implementation plan

> **For agentic workers:** Execute inline using executing-plans; use a fresh reviewer before deployment.

**Goal:** Run the approved review cleanup and product-info completion on AWS without personal login expiry or thread conflicts.
**Architecture:** Dated EventBridge Scheduler → standalone ECS task → read-only RDS + existing admin APIs. Private S3 manifests, state, and reports; task-role AWS credentials.
**Tech Stack:** TypeScript, Node 22, AWS SDK v3, pg, SST/Pulumi, focused serial Jest tests.
**Spec:** docs/superpowers/specs/2026-10-16-night-maintenance-design.md

## Global constraints

Never write to DB; review provider/rating/CSV scope fixed; no daytime writes; serial API calls; no embedded credentials; authenticated API re-login once after 401; uncertain writes reconciled; preserve product semantics. Dated schedules disabled until cloud dry run passes.

## Review focus

Window/DST/delayed launches; concurrent/duplicate invocations; expired authentication and ambiguous DELETE/publish; target drift and preservation of existing product values; terminal and launch failures with durable reports.

## Tasks

- [x] 1. Write policy/auth/state tests, observe failure, then implement window checks, input validation, serial pacing, bounded re-login and S3 state adapters in scripts/night-maintenance/src. Tests assert closed windows cannot mutate and 401 can only trigger one re-login.
- [x] 2. Write review runner tests using injected DB/API/store interfaces; implement strict manifest comparison, five-row canary, pre-delete intent and post-delete verification, fail-closed load checks and completion report. Prove dry-run issues no DELETE and scope drift stops before the first DELETE.
- [x] 3. Write product runner tests for preservation, changed active heads, uncertain publishes and resumability; implement serial draft/update/publish flow and immutable proposals. Add optional validated bulk_import origin to the administrator publish controller and test forwarding/validation.
- [x] 4. Implement runtime composition, standalone locked dependency package and Docker image. Typecheck, focused Jest, and local container checks must pass. Create local export utility that builds checksummed manifests from the existing approved CSV/journal without credentials.
- [x] 5. Add disabled one-time ECS schedules, task role, private S3 bucket, runtime secret references, CloudWatch task/launch failure alarms, and operational runbook in deployments/lcnine/night-maintenance/night-maintenance.ts. Test synthesized schedule policy where practical; inspect target-only plan.
- [ ] 6. Fresh whole-change review; address substantive findings, run focused checks serially; commit scoped changes. With operator authentication restored, deploy only Core and maintenance resources, populate the approved dedicated credential secret without local persistence, upload immutable manifests, run both cloud dry runs and verify reports.
- [ ] 7. Enable the next dated windows only after successful cloud dry runs. Verify AWS get-schedule, target IAM/network, and final artifacts; report what is scheduled and the residual completion/notification limits honestly.

## Ledger

- 2026-10-16: Previous local reservations failed: review AWS session expired; product CLI thread resume conflicted with the running desktop writer. AWS jobs remove both dependencies.
- 2026-10-16: User already approved the concrete server-job description in chat. Continue implementation inline; no repeated architecture approval requested. No production mutation is permitted by local tests/dry runs.

- 2026-10-16 local verification: 29 runner tests and 49 focused Core tests pass serially; runner typecheck and isolated maintenance infrastructure typecheck pass; ARM64 Docker build, non-root/CA check and local non-ECS fail-closed probe pass. The wider pre-existing services infrastructure has unrelated strict typing errors; target-only SST diff is still required after authentication.
- Frozen local inputs: `/Users/FD/Library/Application Support/AlmondyoungNightMaintenance/2026-10-16/inputs`; reviews 3,662, pending product proposals 5,119 / 6,191 fields, six unfinished legacy operations held. Checksums committed in disabled settings; data itself is not committed.
- Independent review: fixed draft re-verification on resume, unresolved DELETE retry, interrupted pilot gating (including repeated restart), and new channel-adapter failures in load gates. Targeted recheck found no remaining blocker.
- Deployment is pending renewed operator AWS login. No maintenance AWS resources have been deployed, no schedules enabled, and no production mutation was made by this implementation session. Cloud dry runs, secrets population, manifest upload, target diff and activation remain outstanding. The next source date is 2026-10-17; change it if that window is missed.

- Cloud deployment: separate `almondyoung-maintenance` SST app avoids rebuilding/updating existing services. Existing cluster/VPC/DB IDs are read-only references; Scheduler starts disabled. Fixed AWS SNS policy validation with unique statement IDs. Secrets populated in memory through SDK, both immutable manifests uploaded privately.
- First review dry run stopped before any DELETE: current eligible 3,659 vs approved 3,662, zero extra IDs, three missing. Added bounded read-only reconciliation of at most five preexisting soft-deleted approved rows across the whole operation; changed/missing undeleted rows still stop. New tests observed failure before implementation; 32 runner tests now pass. Final cloud revalidation remains in progress.
- Core 250 rolled out after a target-only deploy. SST reported unrelated missing OpenNext resource.enc files; it did not redeploy those websites. Verify ECS rollout, image/API schema and only then enable products. Do not run a full services deployment as a workaround.

- Final cloud review task revision 4 passed with exit0: 3 previously deleted approved targets independently confirmed, 3,659 remain eligible, zero unexpected IDs. Core API Swagger now exposes the optional bulk origin/expected head DTO on revision250; service rollout is draining the old task. Final product dry run on the same maintenance task revision is running.
