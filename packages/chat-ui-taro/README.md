# @cfp/chat-ui-taro

Reusable React 18 / Taro 4.2 conversation UI. The package renders single and
multiple choice fields, forms, cards, code blocks and tables, and preserves
legacy page and image artifacts. It owns compact
previews, form draft/submit state, bottom-sheet behavior, composer, voice input
and recoverable-submit decisions. It has no product API routes, numeric turn
IDs, credentials, uploads, navigation, consent rules or business constants.

## Entry points

- `@cfp/chat-ui-taro` exports the Taro composer and voice-input components.
- `@cfp/chat-ui-taro/artifacts` exports artifact state, previews, sheets,
  renderer adapters and the catalog renderers.
- `@cfp/chat-ui-taro/a2ui-native` exports the official `@a2ui/web_core` Taro
  host. It does not import CopilotKit's DOM renderer.
- `@cfp/chat-ui-taro/a2ui-h5` exports the CopilotKit
  `A2UIProvider`/`A2UIRenderer` host. H5 adapters must import this path
  explicitly; do not rely on `.h5.tsx` selection through a package export.
- `@cfp/chat-ui-taro/speech` and
  `@cfp/chat-ui-taro/recoverable-submit` are headless subpaths. They do not
  import Taro components or a browser runtime.
- `@cfp/chat-ui-taro/styles.css` supplies usable composer, voice, selection,
  code, table, preview and sheet styles.

An artifact consumer supplies an `ArtifactRendererAdapter`: its catalog ID,
wire-message validator and `compile(identity, blocks)` function. The identity
may be any opaque string or number. Product-specific surface IDs and resource
URLs belong in that adapter. `ArtifactUiConfig` separately injects the private
resource resolver, preview/open-page actions, icon renderer, provenance-aware
text component, provenance-aware copy action, notification action and portal.

Import the stylesheet once before host overrides. It includes safe defaults and
the following theme tokens: `--chat-ui-text`, `--chat-ui-muted`,
`--chat-ui-accent`, `--chat-ui-accent-soft`, `--chat-ui-border`,
`--chat-ui-panel` and `--chat-ui-danger`. A standalone consumer does not need
application CSS for choice selected states, code whitespace/horizontal scroll,
typed tables or sheet layout. Hosts may override tokens and surrounding product
layout without duplicating renderer rules.

The official A2UI core remains the only protocol/data-model state engine.
`validate` is a boundary guard, while the native and H5 hosts feed accepted
messages to the official processors.

Taro 4.2's Vite build must resolve platform components from the host application
when compiling workspace sources. For WEAPP, the host supplies a post-enforced
Vite config plugin that maps `@tarojs/components` directly to its absolute
`@tarojs/plugin-platform-weapp/dist/components-react` path. Aliasing that
replacement string again does not work because Rollup aliases do not chain.
See the [AJ host configuration](../../apps/a-j-oker-miniapp/config/index.ts).
H5 keeps its normal platform resolution; compiler plugins remain host dependencies.
