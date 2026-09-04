# Asset Cards to Pie Morph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reversible, background-preserving asset-card to dimensional pie-chart view with inline segment labels and a bubble detail state.

**Architecture:** Keep the existing allocator and state model intact. Add a small dependency-free UMD helper for deterministic sector geometry, background selection, label placement, and target-amount labels; render the interactive SVG and morph overlays from the existing inline application script. Use Web Animations for the transition and a reduced-motion path for accessibility.

**Tech Stack:** HTML, CSS, SVG, browser JavaScript, Node.js built-in test runner, service worker.

**Spec:** `docs/dev-loop-runs/2026-09-02-asset-pie-morph/00-requirements.md`

## Global Constraints

- Modify the complete `v18.7 no-pie` project only.
- Preserve allocation calculations and existing controls.
- Keep all labels inside their segment and reuse existing card background images.
- Add no framework or network dependency.
- Do not commit because the directory has no Git metadata.

---

### Task 1: Deterministic pie model

**Files:**
- Create: `tests/pie-view.test.cjs`
- Create: `pie-view-logic.js`

**Interfaces:**
- Consumes: rows shaped as `{id, name, productKey, desc, ccy, pct}` plus a target-amount callback.
- Produces: `window.AssetPieLogic` and CommonJS exports `assetKind`, `buildSegments`, `annularSectorPath`, `segmentTransform`, and `labelFontSize`.

- [ ] **Step 1: Write failing Node tests**

  Tests use literal expectations to verify filtering, 360-degree normalization, source order, exact background category, three label lines, selected offset, valid annular paths, small-sector font reduction, and empty input.

- [ ] **Step 2: Verify RED**

  Run: `node --test tests/pie-view.test.cjs`

  Expected: failure because `../pie-view-logic.js` does not exist.

- [ ] **Step 3: Implement the minimal UMD helper**

  `buildSegments(rows, targetFor)` filters non-positive percentages, normalizes positive percentages to 360 degrees, derives `startAngle`, `endAngle`, `midAngle`, `kind`, `background`, `targetAmount`, and the three literal label lines.

- [ ] **Step 4: Verify GREEN**

  Run: `node --test tests/pie-view.test.cjs`

  Expected: all tests pass with zero warnings.

### Task 2: Render and interact with the pie view

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `window.AssetPieLogic`, existing `state.rows`, `targetOf`, `money`, `receiptAssetImages`, and rendered `#tbody` card rows.
- Produces: `#assetViewToggleBtn`, `#assetViewToggleBtnDesktop`, `#pieAssetPanel`, `renderPieView()`, `selectPieAsset(id)`, and `switchAssetView()`.

- [ ] **Step 1: Add an integration test that loads the page through a local HTTP server**

  The browser acceptance script will assert the toggle exists, click into pie mode, verify SVG segments, inline text, patterned fills, selected detail behavior, and return to cards.

- [ ] **Step 2: Verify RED**

  Run the browser check against the untouched page and confirm it fails because the toggle and pie panel are absent.

- [ ] **Step 3: Add markup and styles**

  Add the two accessible toggle buttons, pie panel, dimensional SVG treatment, pattern overlays, inline segment-label styling, optional detail bubble connector/card, morph ghosts, responsive rules, and reduced-motion rules.

- [ ] **Step 4: Add rendering and interactions**

  Render one SVG pattern per segment using the source-card background path; render the label at the annular centroid; keep no segment selected on entry; toggle selection on pointer or keyboard; animate cards inward and segments outward, then reverse the sequence on return.

- [ ] **Step 5: Verify GREEN**

  Run the browser check at a 390 x 844 viewport and a desktop viewport. Confirm the page has no console errors, no horizontal overflow, correct card/pie state changes, and a readable selected detail card.

### Task 3: PWA cache and regression acceptance

**Files:**
- Modify: `service-worker.js`
- Create: `docs/dev-loop-runs/2026-09-02-asset-pie-morph/03-implementation-log.md`
- Create: `docs/dev-loop-runs/2026-09-02-asset-pie-morph/04-acceptance-report.md`
- Create: `docs/dev-loop-runs/2026-09-02-asset-pie-morph/05-pr-summary.html`

**Interfaces:**
- Consumes: final application files and test evidence.
- Produces: a new cache key, complete shell asset list, implementation record, acceptance verdict, and self-contained review summary.

- [ ] **Step 1: Write the failing cache test**

  Extend the Node test to load `service-worker.js` and assert it contains a new cache key plus `pie-view-logic.js` and all four chart background files.

- [ ] **Step 2: Verify RED**

  Run: `node --test tests/pie-view.test.cjs`

  Expected: cache test fails while geometry tests remain green.

- [ ] **Step 3: Update the service worker**

  Bump the cache key and add the logic file and existing asset backgrounds to `APP_SHELL`.

- [ ] **Step 4: Run fresh verification**

  Run the complete Node suite, HTML/JavaScript syntax checks, local-server HTTP checks, mobile/desktop browser interaction checks, and asset existence checks.

- [ ] **Step 5: Record acceptance evidence**

  Write the implementation log, acceptance report, and self-contained HTML summary with exact commands, outcomes, screenshots, residual risks, and backup locations.

## Self-Review

- Spec coverage: tasks cover view toggle, background identity, inline labels, selected detail, reverse morph, empty state, accessibility, cache, and regression checks.
- Placeholder scan: no deferred code or undefined step remains.
- Type consistency: Task 2 consumes the exact `AssetPieLogic` functions produced by Task 1; Task 3 validates the same filenames used by the page and service worker.

