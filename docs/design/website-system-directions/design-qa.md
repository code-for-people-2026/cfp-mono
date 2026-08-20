# Design QA

## Source visual truth

- Selected final page direction: [`selected-overview.jpg`](./selected-overview.jpg).
- Selected final replacement banner: [`assets/banner-neighbor-ai-human-double-track.png`](./assets/banner-neighbor-ai-human-double-track.png) (1567 × 1004 px).
- Visual contract: glacier-silver public surfaces, navy-black Chinese typography, restrained civic red, silver borders, subtle depth and a dark prototype-stage counterpoint.
- Banner contract: the red neighbor-to-AI bundle remains visually rich; AI-to-human is reduced to two clean unconfirmed tracks; confirmation teal appears only after the human checkpoint.

## Implementation evidence

- Desktop top: [`selected-overview.jpg`](./selected-overview.jpg)
- Full page: [`selected-full-page.jpg`](./selected-full-page.jpg)
- Foundations: [`selected-foundations.jpg`](./selected-foundations.jpg)
- Components: [`selected-components.jpg`](./selected-components.jpg)
- Pixel and responsive rules: [`selected-pixels.jpg`](./selected-pixels.jpg)
- Mobile 320: [`selected-mobile-320.jpg`](./selected-mobile-320.jpg)

## What was compared

The implementation is one continuous review page rather than a separate documentation portal:

1. **A · Official product introduction** reproduces the selected main-site composition and replaces its hero illustration with the selected double-track banner.
2. **B · Prototype experience carrier** reproduces the selected ideal/GitHub Pages shell while preserving the phone-shaped App view as the unchanged product-prototype content.
3. **C · Foundations**, **D · Components and surfaces** and **E · Pixel and responsive rules** continue below A/B in the same visual language.

The source and implementation were compared at the whole-page level and in focused regions for typography, spacing, color, surfaces, banner crop, status language, primary actions and the prototype carrier boundary.

## Viewports and structural checks

- Desktop review viewport: 1440 × 1024 CSS px.
- Mobile review viewport: 320 × 800 CSS px.
- At 320 px, `innerWidth = 320` and `documentElement.scrollWidth = 320`; there is no page-level horizontal overflow.
- At 320 px, all images load (`brokenImages = 0`) and the page retains one clear `h1`.
- The wide phone stage is clipped inside its own carrier rather than increasing document width.

## Focused comparison findings

- **Composition:** A and B now use the selected visual's label, header, content split, rounded glacier surface, fine border and restrained shadow hierarchy. C/D/E continue as part of that same page.
- **Color:** civic red is formalized as `#D20D18`; glacier white, silver, navy and confirmation teal are semantic roles rather than decorative one-offs.
- **Typography:** the selected contrast between a heavy Chinese display headline and quiet utility copy is preserved and converted into named text styles.
- **Banner:** the crop excludes the generated image's embedded navigation residue, shows all three neighbor/AI/human nodes, and keeps the two-track AI-to-human simplification selected by the user.
- **Prototype boundary:** B makes the surrounding GitHub Pages carrier part of the new system while treating the phone App view as unchanged prototype content.
- **Truthfulness:** public copy consistently says that this is an interactive prototype, does not ingest real business data and does not prove that a service is live.
- **Density:** component examples use comfortable and compact states without leaving the large unused right-side gap found in the earlier pass.

## Comparison history and fixes

1. **P1 misunderstanding corrected:** the first attempt behaved like a standalone design-system documentation portal and displayed the chosen images as references. It was replaced with a continuous A/B/C/D/E prototype page based directly on the selected visual.
2. **P2 banner crop corrected:** the first crop retained generated navigation residue and did not frame the human node clearly. The final crop removes the residual UI and includes the complete responsibility chain.
3. **P2 prototype-stage crop corrected:** B was reframed around the existing phone App view so the surrounding shell can change without implying that the App UI is being redesigned.
4. **P3 whitespace corrected:** the density specification now spans the full content width and uses three columns, eliminating the visibly empty right-hand area.

## Interaction checks

- The hero primary action scrolls to B, the prototype experience carrier.
- The feedback action displays a temporary confirmation toast.
- The density control changes the sample values from 20 px to 12 px.
- Navigation anchors move to the relevant C/D/E specification sections.
- Browser console warnings and errors: none observed.

## Automated verification

- `npm run build`: passed.
- `npm run test:sites`: 4 passed, 0 failed.
- The build emits the client bundle, Sites worker and hosting manifest expected by the prototype template.

## Remaining P3 production notes

- The small `仝` seal is a provisional textual marker, not a logo redesign. Production should replace it with the approved brand asset.
- The phone App is embedded as a crop only for this review artifact. Production must continue to run the existing live HTML and interactions unchanged; it must not rasterize the App.
- Production should export a clean illustration-only banner asset without embedded navigation or readable UI text. The prototype currently enforces that boundary through cropping.

No actionable P0, P1 or P2 differences remain for this design-review artifact.

final result: passed
