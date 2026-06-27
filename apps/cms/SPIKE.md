# apps/cms Spike — go/no-go

> Tech Spec §7 open item: validate the two C′ foundation assumptions **before**
> building the full spine schema. This file records the verdict.

## Architecture (as built)

Two Payload processes share one Postgres instance (dev = docker `cfp`, prod = one
RDS), each on its own schema:

- `apps/website` — 官网, schema `"website"`. Untouched.
- `apps/cms` — **shared host** for kith-inn and future small apps, schema `"cms"`.
  It is a thin Next + Payload shell (admin / api / graphql / health) and ships **no
  business collections of its own** — it aggregates them from per-app packages.

Each app's collections / types / logic live in **their own package**, not jumbled in
cms:

- `packages/kith-inn-payload` (`@cfp/kith-inn-payload`) — kith-inn's Payload
  collections + the tenant-isolation access/hooks. Depends on `payload` +
  `@cfp/kith-inn-shared`. Imported only by `apps/cms`.
- `packages/kith-inn-shared` (`@cfp/kith-inn-shared`) — zero-dependency domain
  kernel: enums + entity types + (later) API contracts. Imported by FE, BE, and cms
  (transitively via kith-inn-payload), so neither FE nor BE drags in Payload.

## (a) Two Payload apps, same Postgres, separate schemas — ✅ GO

`apps/website` already proves the pattern (`schemaName="website"` literal baked into
migration SQL). `apps/cms` reproduces it with `schemaName="cms"`.

Proven by `tests/spike-coexistence.test.ts`, which boots the cms Payload against a
real Postgres (`DATABASE_URL`) and asserts via `information_schema` that the `cms`
schema owns `sellers`/`operators`/`offerings`/`payload_migrations`, leaks nothing
into `public`, and does not collide with `website`'s tables. sqlite cannot prove
schema isolation (it ignores `schemaName`), so the test is `skipIf`-guarded and
carries no enforceable coverage.

**Operational note:** in CI both `website` and `cms` run with `PAYLOAD_DB_PUSH=true`.
Each records migrations in its OWN schema-scoped `payload_migrations`
(`cms.payload_migrations` vs `website.payload_migrations`) — no shared-table
collision.

## (b) `@payloadcms/plugin-multi-tenant` vs our `operators`+`wechatOpenid` auth — ❌ NO-GO

Investigated `@payloadcms/plugin-multi-tenant@3.85.1` (matches payload core; no
version gap). Its model, read from its type contract (`dist/types.d.ts`):

- Tenant collection (`tenantsSlug`, default `'tenants'`) — configurable to
  `'sellers'`. ✅ not a hard conflict.
- Per-collection tenant field (default name `'tenant'`) — overridable or opt-out via
  `customTenantField`. So the field-name clash with our `seller` is avoidable.
- **The real conflict — the auth/access model:** the plugin filters access by a
  **`tenants` array on the user** (`tenantsArrayField`, defaults `arrayFieldName:
  'tenants'`). A user belongs to *many* tenants. Our spec (PRD §7.1 / Tech Spec
  §3.1) is the opposite: an `operator` has a **single `seller`** relationship, and
  our own `tenantScoped()` factory scopes by `operator.seller`.

Coexistence is only achievable by disabling the plugin's core access logic
(`useTenantAccess: false` on every collection + `customTenantField`), leaving it to
contribute nothing but admin-panel tenant-selector UI — which is not an M0
deliverable (M0 ships an H5 login). Shipping a plugin whose access logic we've
switched off is misleading weight and competes with the spec-mandated
`tenantScoped()` factory.

**Verdict: drop the plugin.** Tech Spec §3.1/§3.4 mandate our own `tenantScoped()`
access factory + write-side `seller` stamp + cross-tenant relationship guard +
collection-traversal assertion as the hard isolation mechanism — independent of any
plugin. That machinery lives in `@cfp/kith-inn-payload` and lands across PR1/PR2.
Revisit the plugin only if a Payload-admin tenant selector becomes a real need (M4).

### Secondary finding: Payload `auth: true` assumes email/password

`operators` uses `auth: true`, which auto-adds email/password columns. Our real
identifier is `wechatOpenid`; the email column is unused and populated with a
synthetic value at creation (PR3 seed / PR4 wx-login). The wx-login endpoint (PR4)
issues the operator session and never relies on the email for identity.
