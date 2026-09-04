# Asset Pie Apple Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有原生 JavaScript 资产配置页面中增加可逆卡片/饼图视图，并实现 Apple 式克制果冻选中、邻近吸附、回弹复位与无障碍降级。

**Architecture:** 新建无依赖 UMD 模块 `asset-pie.js`，负责扇区几何、响应式布局、交互目标计算、SVG 渲染和 WAAPI 动画接管。`index.html` 只提供现有 `state.rows`、`targetOf` 和视图容器；资产业务状态不迁移、不重构。

**Tech Stack:** 原生 HTML/CSS/JavaScript、SVG、Web Animations API、ResizeObserver、Node.js 内置测试、PWA Service Worker。

**Spec:** `docs/dev-loop-runs/2026-09-02-asset-pie-morph/03-apple-jelly-motion-spec.md`

## Global Constraints

- 不修改现有页面颜色、字体、导航、按钮和卡片组件。
- 不引入 ECharts、D3、动画库、框架或构建工具。
- 默认视图仍为资产卡片。
- 资产比例、金额和顺序只读取现有 `state.rows` 与 `targetOf(row)`。
- `selectedAssetId` 是临时 UI 状态，不写入 `localStorage`。
- 动画无无限循环，并完整支持 `prefers-reduced-motion: reduce`。

---

### Task 1: 可测试的扇区几何与吸附模型

**Files:**
- Create: `asset-pie.js`
- Create: `tests/asset-pie.test.cjs`

**Interfaces:**
- Consumes: `{id, name, desc, pct, productKey, ccy}` 与 `targetFor(row)`。
- Produces: `buildSegments`, `sectorPath`, `interactionCentroid`, `computeInteractionTargets`, `capAttractionToGap`, `labelMode`。

- [ ] **Step 1: 写比例与路径失败测试**

```js
assert.deepEqual(buildSegments(rows, targetFor).map(x => x.id), rows.map(x => x.id));
assert.ok(Math.abs(sumSweep - Math.PI * 2) < 1e-9);
assert.equal(qqq.rawPercent, 10);
assert.equal(qqq.targetAmount, 10000);
```

- [ ] **Step 2: 运行 RED**

Run: `node --test tests/asset-pie.test.cjs`

Expected: FAIL，因为 `asset-pie.js` 尚不存在。

- [ ] **Step 3: 实现 UMD 外壳和几何函数**

```js
buildSegments(rows, targetFor, options)
sectorPath(segment, layout)
interactionCentroid(segment, layout)
```

角度用正比例归一化，默认视觉间隔换算为 4–5px；零比例不生成路径。

- [ ] **Step 4: 写 QQQ 吸附失败测试**

```js
const targets = computeInteractionTargets(segments, "qqq", layout);
assert.equal(targets.qqq.distance, 18);
assert.ok(targets.voo.distance >= 6 && targets.voo.distance <= 10);
assert.ok(targets.gold.distance >= 6 && targets.gold.distance <= 10);
assert.ok(targets.schd.distance <= 1);
```

- [ ] **Step 5: 实现距离衰减与 4px 间距收缩**

实现环形距离上限、角距离 `smoothstep` 衰减和边界采样二分收缩；不按资产代码分支。

- [ ] **Step 6: 运行 GREEN**

Run: `node --test tests/asset-pie.test.cjs`

Expected: 所有几何、比例、方向和间距测试通过。

### Task 2: SVG 视图与现有状态接线

**Files:**
- Modify: `index.html`（CSS 区、资产头部、主脚本初始化）
- Modify: `asset-pie.js`
- Test: `tests/asset-pie.test.cjs`

**Interfaces:**
- Consumes: `state.rows`, `targetOf(row)`, `receiptAssetKind(row)`, `money(value)`。
- Produces: `createAssetPieController(options)`, `render(rows)`, `setSelectedAsset(id)`, `clearSelection()`。

- [ ] **Step 1: 添加视图结构测试约束**

测试读取 `index.html`，断言存在 `assetViewToggleBtn`、`assetPiePanel`、`assetPieSvgHost`，且原 `openAssetSortBtn` 和 `tbody` 仍存在。

- [ ] **Step 2: 在资产标题区新增视图按钮槽位**

复用现有 `.assetViewActions`，只新增饼图/卡片切换按钮；排序按钮结构和样式不改。桌面表头增加对应按钮，但不改变列结构。

- [ ] **Step 3: 增加饼图容器和现有风格 CSS**

添加 `.assetPiePanel`、`.assetPieSvgHost`、`.assetPieSegment`、`.assetPieDetail`、焦点和 reduced-motion 规则。颜色和边框只引用现有 CSS 变量与资产背景图。

- [ ] **Step 4: 实现 SVG 渲染**

每个资产创建一个 `<g role="button" tabindex="0">`，内部包含图案路径、暗化层、标签、透明命中路径和焦点轮廓。四类背景继续使用现有 USD/CNY/HKD/gold 图片。

- [ ] **Step 5: 接入响应式尺寸**

`ResizeObserver` 更新 `layout` 后重新计算路径；390px、360px 和桌面宽度均不得横向溢出。

- [ ] **Step 6: 运行测试**

Run: `node --test tests/asset-pie.test.cjs`

Expected: 结构、几何和空状态测试全部通过。

### Task 3: Apple 式按压、果冻选择与快速切换

**Files:**
- Modify: `asset-pie.js`
- Test: `tests/asset-pie.test.cjs`

**Interfaces:**
- Consumes: `computeInteractionTargets(...)`。
- Produces: `animateToSelection(id)`, `animateToDefault()`, `takeOverAnimation(group, target, mode)`。

- [ ] **Step 1: 写 Motion 目标测试**

```js
assert.equal(selectFrames.at(-1).scale, 1.035);
assert.ok(Math.max(...selectFrames.map(x => x.scale)) <= 1.06);
assert.equal(selectFrames.filter(isPositiveOvershoot).length, 1);
assert.deepEqual(reducedTargets, stationaryTargets);
```

- [ ] **Step 2: 实现按下反馈**

`pointerdown` 只把当前扇区缩到 0.985；`pointerup` 或键盘激活才改变 `selectedAssetId`。处理 `pointercancel`，避免扇区卡在按下态。

- [ ] **Step 3: 实现 WAAPI 单次过冲**

选择关键帧只包含一次正向过冲；取消只包含一次小于 1.5px 的反向过冲。每个 `<g>` 同时移动路径、标签和点击区。

- [ ] **Step 4: 实现动画接管**

读取当前计算矩阵、写回内联 transform、取消旧 Animation，再从当前矩阵动画到新目标；`animations` 中每个资产最多一个动画。

- [ ] **Step 5: 实现选择取消与快速切换**

同扇区再次点击、SVG 空白和 Escape 清空选择；选择另一扇区直接重定向，不经过默认态。

- [ ] **Step 6: 运行测试**

Run: `node --test tests/asset-pie.test.cjs`

Expected: 过冲上限、单次过冲、取消目标、快速重定向和 reduced-motion 数据测试通过。

### Task 4: 泡泡详情与卡片/饼图双向转换

**Files:**
- Modify: `index.html`
- Modify: `asset-pie.js`
- Test: `tests/asset-pie.test.cjs`

**Interfaces:**
- Consumes: 现有行字段 `name`, `desc`, `pct`, `unitPrice`, `shares`, `ccy` 和 `targetOf(row)`。
- Produces: `renderSelectedDetail(row)`, `switchAssetView(mode)`。

- [ ] **Step 1: 实现未选中空详情状态**

未选择时不渲染详情卡，仅保留“点击资产扇区查看详情”的辅助提示。

- [ ] **Step 2: 实现选中泡泡详情**

显示代码、名称、比例、目标金额、单股金额、股数和币种；连接线从选中扇区指向详情卡。详情只读，不复制现有输入控件。

- [ ] **Step 3: 实现卡片到饼图 FLIP 转换**

按 `row.id` 捕获卡片与扇区目标位置；卡片表面向中心汇聚，扇区错峰形成。转换期间锁定切换按钮，完成后隐藏卡片表格。

- [ ] **Step 4: 实现饼图到卡片逆转换**

先关闭选择详情，再从当前扇区位置散开到对应卡片位置；不得重排或重建业务数据。

- [ ] **Step 5: reduced-motion 降级**

减少动态模式只进行即时显隐和焦点迁移，不进行 FLIP、吸附、缩放或过冲。

- [ ] **Step 6: 运行测试**

Run: `node --test tests/asset-pie.test.cjs`

Expected: 视图模式、详情字段、零比例和缓存清单测试通过。

### Task 5: PWA 缓存与完整验收

**Files:**
- Modify: `service-worker.js`
- Create: `docs/dev-loop-runs/2026-09-02-asset-pie-morph/04-apple-motion-acceptance.md`

**Interfaces:**
- Consumes: 最终 `asset-pie.js`、现有四类资产背景和 UI。
- Produces: 新缓存版本、浏览器验收记录和截图。

- [ ] **Step 1: 更新缓存测试**

断言新缓存键不含 `no-pie`，APP_SHELL 包含 `asset-pie.js` 和 USD/CNY/HKD/gold 背景。

- [ ] **Step 2: 更新 Service Worker**

修改 `CACHE_NAME` 并加入新增脚本与现有图片；保持当前导航 network-first 和静态 stale-while-revalidate 策略。

- [ ] **Step 3: 运行完整 Node 测试**

Run: `node --test tests/asset-pie.test.cjs`

Expected: 0 failures。

- [ ] **Step 4: 运行 390×844 触摸验收**

验证 QQQ 弹出、VOO/SGOL 吸附、SCHD 基本静止、再点取消、空白取消和快速 QQQ→VOO；记录 transform 与截图。

- [ ] **Step 5: 运行键盘与 reduced-motion 验收**

验证 Tab、Enter、Space、Escape、焦点轮廓、`aria-pressed`；模拟 reduced-motion 后确认无位移、缩放和过冲。

- [ ] **Step 6: 运行回归验收**

验证本金、汇率、资产比例编辑、排序、资产替换、卡片翻面、详情展开、打印小票和 PWA 刷新没有变化。

- [ ] **Step 7: 写验收报告**

在 `04-apple-motion-acceptance.md` 记录精确命令、浏览器尺寸、通过项、失败项、截图路径和残余风险。

## Self-Review

- Spec coverage: 技术栈、无依赖 SVG、严格比例、唯一选择状态、邻近吸附、单次过冲、取消、快速切换、触摸、键盘、reduced-motion、双向转换和页面回归均有任务覆盖。
- Placeholder scan: 计划中的每个步骤都有明确文件、接口、动作和验证方式，不含待补内容。
- Type consistency: `buildSegments` → `computeInteractionTargets` → `createAssetPieController` → `switchAssetView` 的输入输出在各任务中一致。
