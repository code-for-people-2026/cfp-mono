## ECS image builds and deployments

Before changing the live Hello Agent deployment, read `docs/server-disk.md`.
Use `deploy/build-preview.sh` and `deploy/release.py` for builds and compatible
app/worker replacements. They share a lock with automatic retention and preserve
exactly the current release and one verified rollback release. Do not derive a
new image from a previous application image or bypass the retention manifest
with ad-hoc container renames. An unexpected runtime or deployment journal must
be resolved before any cleanup. Never prune data volumes or delete application
storage to make room for a build.
