# ECS disk capacity and release retention

The 2026-10-31 outage exhausted a 40 GiB system disk. The main consumers were
Docker image layers and retained stopped deployments, not private OSS images.
All applications on this host share the disk. Their data and unrelated containers
are outside this cleanup policy.

## Runtime image

`Dockerfile.preview` now uses separate build and runtime stages. The runtime
copies the app once with the correct ownership. Next's compilation cache and
build-time `.data` files are excluded, and pnpm's download store stays in the
build stage. The app's dependency graph is retained because the separate Feishu
worker executes TypeScript with `tsx` and imports the Payload source modules.
Both web and worker commands, fonts, native SQLite libraries and prebuilt H5
assets remain available. This is not a standalone web-only image.

## Supported workflow

Run on the ECS host, from a source directory containing only the reviewed code
and the verified prebuilt `apps/a-j-oker/public/chat` assets:

```sh
bash /opt/cfp-hello-agent/operations/bin/build-preview.sh SOURCE_DIR preview-YYYYMMDD-NAME
python3 /opt/cfp-hello-agent/operations/bin/release.py preview-YYYYMMDD-NAME
```

Builds require at least 8 GiB available and never stop live services. The Docker
engine's unused build cache is pruned to a best-effort 1 GB budget after a build
(including failure), and during daily maintenance. This is shared, reproducible
build cache: a future build of another service may need to download/rebuild
layers. No data volumes or service images are part of cache pruning. Cache still
referenced by images or active builds cannot be reclaimed.

All three operations (build, replacement, retention) use
`/var/lock/cfp-hello-agent-deploy.lock`. A busy lock causes an immediate stop.
Never run a second publisher around this lock.

`release.py` is for compatible, infrastructure-only replacements of the existing
web and alert worker pair. Before stopping anything it verifies the current
manifest, readiness, candidate build label and at least 2 GiB free. It first starts the candidate offline against a disposable database snapshot and
checks readiness, native modules, worker imports, H5 and unchanged schema; then stops
the pair, validates and archives their bound database directory, and keeps the old containers.
The independent privacy deletion ledger is excluded from new database archives.
Only after candidate readiness, SQLite integrity, unchanged schema and existing
alert verification, and an advancing worker heartbeat, does it atomically record
the new current and rollback pair. Previous rollback containers/images then enter
the explicit retirement list. A failed candidate restores the original pair.
Recovery retains its journal until the exact original pair is running, HTTP
readiness passes, database integrity/schema and alert verification are preserved,
and the restored worker advances its heartbeat beyond a fresh recovery snapshot.
A heartbeat written by the failed candidate cannot prove recovery. A failed
recovery check leaves the journal in place for investigation; it never restores
an old database over live writes.
Schema migrations need a separate reviewed migration/restore procedure; do not
use this workflow as a generic migration runner.

## Retention and installation

Private state: `/opt/cfp-hello-agent/operations/retention.json`. It records immutable
image/container IDs, current + rollback, and explicitly retired releases. No
"newest tag wins" or global `docker system prune` logic is used. Unknown containers,
unknown candidates, foreign tags and extra references protect images. Runtime
drift, missing rollback, failed readiness or an interrupted deployment fail closed.
The initial state can be adopted once from a known working pair and its known
stopped predecessor:

```sh
python3 retention.py adopt --rollback-suffix=-before-RELEASE
python3 retention.py cleanup                 # read-only plan
python3 retention.py cleanup --apply
```

Install `retention.py`, `release.py`, `verify_runtime.py`, `build-preview.sh` under the private operations
`bin/` directory, and the supplied service/timer under `/etc/systemd/system/`.
Enable `cfp-hello-agent-retention.timer`. It runs daily at 03:15 Beijing time with
up to five minutes jitter; `Persistent=true` catches missed runs after downtime.
Every successful deployment also runs retention immediately. Inspect failures
using `systemctl status cfp-hello-agent-retention.service` and its journal.

Retired container configuration receipts are private (0600) because Docker
configuration includes credentials. Cleanup uses `docker container rm` without
force or volume deletion, and non-forced removal of the recorded image tags.
Business data, OSS, databases, ledgers, backups and source release directories are
never deleted. The only force-removal path is failed newly-created candidate
containers during rollback, still without `--volumes`.

## Deployment database archive expiration

Before any candidate smoke check or service stop, `release.py` reads the existing
`/opt/cfp-hello-agent/privacy-ops/full/config.json`, verifies its container and
live data/ledger mounts and the seven-day backup setting, then acquires that
privacy job's `stateDir/maintenance.lock` for the deployment. It idempotently
adds `/opt/cfp-hello-agent/operations/deployments` to `legacyBackupDirs`, preserving
all existing roots. Missing/mismatched policy or a busy maintenance lock aborts
the deployment. The directory exists before registration, so privacy maintenance
will not fail on an absent root. Installers must confirm the existing
`cfp-hello-privacy-full.timer` is enabled and healthy; image retention does not
replace or enable privacy operations.

The existing hourly privacy job expires SQLite-containing archives there,
including earlier deployments, under the approved seven-day policy. Recent
archives, non-database receipts, live databases and the independent deletion
ledger are outside this expiration. No new business-data deletion logic is
added to `retention.py`. Existing installations must enroll this directory before
the next privacy run; use `release.backup_policy` with the current app/worker
inspection records to perform registration without deploying or deleting data.
Failed or interrupted deployment archives follow the same privacy deadline;
resolve recovery promptly rather than extending personal-data retention.
Never restore an archive's old deletion ledger, including legacy archives that
contained one; database recovery must replay the current independent ledger.

## Interrupted deployment and rollback

`operations/deployment-journal.json` blocks both deployment and retention after
an interruption. It includes the original state, configuration backup location,
known candidate IDs and original/renamed container IDs. Do not delete it to bypass
the guard. Reconcile those immutable IDs, remove only that transaction's candidate
containers (without volumes), restore the original names and start the saved pair.
Verify `/api/ready`, database integrity and alert heartbeat before restoring the
saved retention manifest and clearing the journal. Data archives under
`operations/deployments/` are recovery evidence, never automatically restored over
live user writes.

For a deliberate rollback, use the protected stopped pair recorded in the
manifest, stop the current pair, rename/start the protected predecessor, verify
readiness and heartbeat, then update both records together. Do not start two
workers against the same database. Retention must remain paused/locked during
manual rollback.

## Verification

```sh
python3 -m unittest discover -s apps/a-j-oker/deploy/tests -v
bash -n apps/a-j-oker/deploy/build-preview.sh
```

Tests cover explicit retirement, current/rollback protection, unknown candidates,
concurrent references, restarted containers, partial cleanup, journals, health
failures, rollback on creation failure and promotion after verification. A real
runtime-image smoke check and actual deployment receipt are also required before
claiming the installed image and timer work.

## 2026-10-31 installation evidence

The first cleanup removed eight stopped Hello Agent containers and four old
images, preserving the then-current `restcards-v2` and rollback `learningcards`.
The multi-stage image rebuilt from the existing deployed application source is
1,322,511,498 bytes (previously about 2.35 GB). Offline smoke used a consistent
SQLite snapshot with the original mounted read-only and networking disabled;
source + public-asset hashes matched the running release. H5, native SQLite,
Sharp, non-root execution, alert-worker imports and unchanged schema passed.

`preview-20261031-slim` is installed; its only retained predecessor is
`preview-20261031-restcards-v2`. The previous `learningcards` pair was automatically
retired after successful readiness, SQLite integrity and worker-heartbeat checks.
The retention service completed with exit status 0 and its daily timer is enabled.
At installation the filesystem showed about 64% used / 14 GiB available, compared
with 91% / 3.7 GiB immediately before this task's cleanup. These are point-in-time
readings, not a capacity guarantee. Other applications' containers were preserved.

## Interrupted offline smoke tests

Install the updated `scripts/privacy-operations.py` in the full deployment's
configured privacy source directory together with `deploy/verify_runtime.py` in
`operations/bin` before enabling the new registration. This is a coordinated
script upgrade; registration alone does not upgrade the existing privacy runner.
`backup_policy` enrolls both `operations/deployments` and `operations/smoke` in
privacy backup roots and records `smokeCleanupScript` pointing to the installed
verifier. Standalone smoke verification uses the same registration and locks.

Every smoke container, including the read-only SQLite snapshot helper, gets a
durable ownership journal before Docker creation. Normal exit, the next smoke
run, and the existing hourly privacy job recover abandoned resources. The hourly
job calls `verify_runtime.py --cleanup` before expiration or deletion-guard
retirement, so recovery does not depend on another deployment. It acquires the
deployment lock without waiting; an active deployment causes maintenance to fail
closed and retry on the next run. It does not inspect or mutate the release
retention manifest, which may be blocked independently by runtime drift.

Recovery validates journaled names, immutable image IDs, exact mounts and network
isolation, removes only matching disposable containers without deleting volumes,
rechecks references, then deletes copied mounts including WAL/SHM and ledger
copies. Unknown references, symlinked sessions or Docker failures retain the
journal and fail the privacy job before deletion guards are retired. An old
unreferenced session without a journal can have its disposable mounts removed;
legacy containers without ownership evidence require manual inspection. Receipts
remain, but no database snapshot is intentionally retained after recovery.

## Reconnecting the renamed application (2026-11-12)

The rename branch predated the retention merge and omitted its entry points.
This branch restores the official build, release, retention, timer, and smoke
recovery scripts under `apps/a-j-oker`, together with their CI tests. Production
container names, environment variables, operations directories and locks retain
their existing `cfp-hello-agent` names. Candidate working directories are read
from the pinned image metadata; only the old and renamed application paths are
accepted. App and worker commands, mounts, environment and host configuration
remain those of the existing deployment.

An existing manifest must not be deleted or replaced using `adopt` to conceal
runtime drift. For a reviewed recovery, prepare a private JSON plan containing
`expectedManifestSha256` and a complete proposed `state` (schema, current,
rollback, retired). Each version records the audited full immutable image ID,
release tag, and app/worker container IDs and names. Include every version from
the previous manifest; do not infer retirement from dates or tag ordering.

```sh
python3 /opt/cfp-hello-agent/operations/bin/reconcile.py PLAN.json
python3 /opt/cfp-hello-agent/operations/bin/reconcile.py PLAN.json --apply
python3 /opt/cfp-hello-agent/operations/bin/retention.py cleanup
python3 /opt/cfp-hello-agent/operations/bin/retention.py cleanup --apply
```

Reconciliation shares the deployment lock and refuses interrupted deployments,
manifest changes, moved tags, unexpected names or mounts, running retired
containers and unknown references to retired images. Applying it first verifies
the chosen rollback against an isolated snapshot under the existing privacy
policy, then rechecks the inputs and live readiness before saving a private
receipt and manifest. It does not rename, stop or delete deployment containers.
Actual retirement still uses the official retention command. Subsequent
successful releases invoke retention automatically from `release.py`.

Prepare source archives from explicitly selected tracked runtime source and
configuration files; never archive an entire working directory with private
reports or credentials. Supply independently verified prebuilt H5 assets. The
Dockerfile-specific ignore rules additionally exclude documents, test fixtures,
tests, private evidence and Python caches, including scripts that depend on
excluded fixtures. Production worker, privacy-maintenance and type-generation
scripts remain available. The Docker context check exercises synthetic private
paths and required runtime files; it never copies personal source material.

### Verification on 2026-11-12

The restored workflow passed 36 deployment tests, shell syntax checks, Docker
context filtering and the complete privacy-operations regression. The audited
manifest was reconciled after an isolated rollback check; official retention
then removed four retired releases (eight containers), without deleting volumes.

`build-preview.sh` rebuilt `preview-20261112-semantic-managed` from the reviewed
source and hash-verified current static assets. The runtime image is
1,321,773,901 bytes. Type checking and production compilation passed; an isolated
image-content check confirmed private-report/fixture paths and compilation
cache were absent while runtime scripts and H5 remained available. The command
transport reached its wait limit, but the original locked build continued; its
image export and automatic cache cleanup were verified before publication. Do
not replay a timed-out transport request without inspecting its original task.

`release.py` verified the candidate offline, preserved schema and alert state,
confirmed worker heartbeat advancement, and promoted the app/worker pair. It
then automatically retired `preview-20261031-retention436-v2` (one image and two
containers). The protected rollback is `preview-20261111-semantic-privacy`.
Both the retention service and privacy maintenance completed with exit status
zero afterward; both timers are enabled. Public readiness returned the new
release, the retirement queue and deployment journal were empty, and no copied
smoke mounts or ownership journals remained. Final available disk space was
about 8.5 GiB, versus 3.4 GiB before recovery; these are point-in-time readings.

### Verification on 2026-11-13

The four review findings were resolved and independently reviewed at
`f2e36fd11d78e7213e18981aecb701434070a8b6` by separate Standards and Spec
reviewers, with no actionable findings. The final checks passed 463 unit tests,
45 deployment tests, type checking, lint, interaction regression and full
integration. Current real-model results are recorded in
[the semantic regression note](semantic-routing-20261111.md).

The managed build produced `preview-20261113-semantic-reviewed` from runtime
commit `e275ffd2`; the subsequent reviewed commit changed only documentation and
the Docker-excluded corpus check. Static assets matched the previous release
before and after copying. The immutable image is
`sha256:55418fbd834ce5aa7b37766456852ddb38ba96f80d6b917c39cd0e4e9b6da8bb`
(1,321,784,594 bytes). Build and automatic cache cleanup exited successfully.
The image's core source hashes matched the reviewed source; private-report,
fixture, test, build-cache and temporary-database paths were absent.

After both reviews, the publisher was hash-verified and installed under the
deployment and privacy-maintenance locks. The official `release.py` passed the
isolated candidate checks, unchanged-schema/alert verification and worker
heartbeat checks, then promoted the app/worker pair. Its automatic retention
removed `preview-20261111-semantic-privacy` (one image and two containers), with
zero volumes removed. The protected rollback is now
`preview-20261112-semantic-managed`.

Post-release retention and privacy-maintenance services both finished with
status zero; both timers were enabled and active. Local and public readiness
returned the new release. The retired image was absent, retirement queue empty,
deployment journal absent, exact current/rollback containers valid, and smoke
mount count zero. Available disk space was 9,192,497,152 bytes (about 8.6 GiB).
These are server checks, not phone acceptance. Private operational receipts and
model replies are not committed.
