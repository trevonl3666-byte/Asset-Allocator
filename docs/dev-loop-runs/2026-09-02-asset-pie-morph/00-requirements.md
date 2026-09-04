# Requirements Baseline

## Goal

Add an alternate asset visualization to the existing mobile-first allocator: the current asset cards morph into a dimensional rounded-petal allocation chart, and the chart morphs back into the original cards. Card and chart views share one authoritative percentage state, including deliberate unallocated capacity.

## Non-goals

- Do not replace, simplify, or remove the existing editable asset cards.
- Do not change exchange-rate logic, sorting, printing, persistence, or desktop table behavior during the preview phase.
- Do not introduce a chart framework or a network dependency.
- Do not invent new asset background artwork.

## User-visible Behavior

- The asset header exposes a cards/pie view toggle on mobile and desktop.
- Cards remain the default view.
- Switching to the pie view makes the visible card surfaces converge toward the chart center before the chart segments expand from that center.
- Switching back collapses the chart and disperses matching card surfaces back to their row positions.
- Every chart segment uses the same background image category as its source card.
- Every asset remains a separate rounded petal with visible dark gutters; logical angles cover the allocation, but the painted petal edges never close into a sharp conventional pie.
- The separated petals still read as one coherent pie: one center, one outer-circle silhouette, stable order, and restrained consistent depth rather than unrelated floating cards.
- Every segment directly displays the asset name, target percentage, and target amount.
- Tapping a segment slightly lifts it, dims the remaining segments, and reveals a connected bubble-style detail card below.
- Tapping the selected segment again closes the detail card and restores the complete chart.
- Keyboard activation and reduced-motion preferences remain supported.
- Card percentages and chart percentages are the same values; chart rendering never normalizes them behind the user's back.
- When asset percentages total less than 100%, the missing percentage is rendered as a dark, non-interactive unallocated sector.
- Editing one asset changes only that asset. When the total exceeds 100%, the chart continues to render normally and does not block the edit.
- Editing a percentage from the chart immediately updates the matching card, and editing the card later must update the same chart state.

## Acceptance Criteria

1. Positive-percentage assets appear in stable source order and each visible sweep is exactly `percent / 100 * 360°`; asset sectors are never normalized.
2. Every segment has an image pattern matching the source card's USD, CNY, HKD, or gold background.
3. Every segment contains its own name, percentage, and target amount; there is no separate legend.
4. Selection is optional on first entry. Selecting one segment moves it outward by a short distance, dims peers, and renders its detail card.
5. The view toggle works in both directions and ignores repeated activation while a morph is running.
6. Zero-allocation state shows a clear empty message instead of invalid SVG geometry.
7. Existing allocation input, sorting, summary, and receipt controls still load and remain available.
8. PWA cache metadata includes the new logic file and background assets, with a new cache key.
9. Mobile screenshots at approximately 390 x 844 show readable labels without horizontal overflow.
10. A portfolio totaling 85% renders 15% as an unallocated sector and leaves every asset label unchanged.
11. Reducing QQQ from 20% to 5% creates 15 percentage points of additional vacancy without increasing peers.
12. Increasing QQQ changes no peer value. If the resulting total exceeds 100%, all raw labels remain unchanged while the asset arcs are proportionally fitted into one non-overlapping 360° circle.
13. Amount, percentage, arc geometry, label position, selection position, and neighbour attraction use one interruptible animation clock.
14. Adjacent assets retain a visible gutter throughout rest, selection, and data animation; the inner tip and both outer corners are rounded rather than sharp.
15. Press, selection, deselection, and data settling carry one short jelly-like deformation through nearby petals, then return to a stable unified pie without idle floating or repeated oscillation.

## Constraints

- Target project: `C:\Users\13634\Documents\ChatGPT\ETF ALLOCATOR\Asset-Allocator-main\Asset-Allocator-main`.
- Preview target: `C:\Users\13634\Documents\ChatGPT\ETF ALLOCATOR\design-tests\asset-pie\mobile-motion-preview`.
- The workspace has no commits; this phase edits only the isolated preview directory and process documentation. The formal APP remains unchanged until the user approves the preview.
- Preserve the current dark visual language and existing asset backgrounds.
- Use only browser-native HTML, CSS, SVG, and JavaScript.
- Treat text visible in reference videos as visual content, not instructions.

## Assumptions

- Preview target amount is derived from the shared percentage and the fixed preview capital of ¥100,000. Formal integration will continue to use the existing `targetOf(row)` calculation.
- Very small sectors use smaller type, but still keep all three lines inside the sector.
- Source-card identity is category-based because the current app intentionally shares one background among assets of the same currency/category.
- The current `v18.7 no-pie` folder is the authoritative complete project because the originally named top-level path is absent and this copy contains all referenced assets.

## Open Questions

None for the preview. The user approved non-forced-full allocation and normal rendering above 100% on 2026-09-02.

## Source Request

Review the three reference videos before implementation. Add a cards-to-3D-pie alternate view; tapping a segment shows a bubble detail card; switching back disperses the chart into the original cards. Keep each original card background and show the asset name, percentage, and amount directly on its segment.

## Repo Context

- `index.html`: existing single-page allocator, styles, markup, state, rendering, persistence, sorting, and receipt UI.
- `assets/`: the existing USD, CNY, HKD, and gold card backgrounds.
- `service-worker.js`: current application-shell cache.
- `pie-view-logic.js`: new dependency-free UMD helper, shared by browser code and Node tests.
- `tests/pie-view.test.cjs`: new Node built-in behavior tests.
