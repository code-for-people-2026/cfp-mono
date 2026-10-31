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
and the verified prebuilt `apps/hello-agent/public/chat` assets:

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
python3 -m unittest discover -s apps/hello-agent/deploy/tests -v
bash -n apps/hello-agent/deploy/build-preview.sh
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
