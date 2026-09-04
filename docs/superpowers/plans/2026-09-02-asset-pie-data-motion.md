# Asset Pie Data Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为圆润花瓣资产饼图增加与 VIDEO4 同类的纵向数字滚动和连续弧长重分配，并用一个可中断共享时钟同步金额、比例、几何、标签、选中与邻区吸附。

**Architecture:** 新建无依赖 UMD 纯模型 `asset-pie-model.js` 负责稳定资产比例、空仓差额、金额快照、单调插值、精确角度和显示百分比；`asset-pie.js` 负责持久 SVG 节点、四层变换、数字槽和唯一 rAF 控制器。卡片和饼图共用同一份比例状态；小于 100% 的差额作为不可选中的空仓扇区，超过 100% 时只在几何层按相对权重压入 360°，不改写任何显示值。

**Tech Stack:** 原生 HTML/CSS/JavaScript、SVG、requestAnimationFrame、Web Animations API（仅非数据反馈）、ResizeObserver、Node.js 内置测试、PWA Service Worker。

**Spec:** `docs/dev-loop-runs/2026-09-02-asset-pie-morph/05-video4-data-motion-analysis.md`

## Global Constraints

- VIDEO4 只提供数字与弧长变化 Motion，不复制其配色、字体、布局、圆环或数据。
- 最终静止形态统一匹配 `B-exploded-petal-resting.png`：圆润花瓣、圆角内端、宽暗沟槽、浮层深度；不得使用尖锐中心扇区。
- 逻辑 start/end angle 连续累计，但 painted path 在两侧按像素间距内缩；板块始终分离，不闭合成普通饼图。
- 分离花瓣仍共享一个圆心和外轮廓，静止时读成统一饼图；按压、选择、复位和数据收敛只触发一次邻区传导与回弹，不做持续漂浮或重复振荡。
- 不引入框架、图表库、动画库或构建工具。
- `assetId` 只使用 `state.rows[].id`，不得使用数组下标作为身份。
- 一个数据更新只有一个 rAF 和一个共享 `progress`；金额、比例、路径、标签、选择和吸附同帧开始、同帧结束。
- 金额、比例、弧长只做单调插值，不允许数值过冲；非数据反馈上限为 scale 1.015 / 0.99 和 1–3 px。
- 合计不超过 100% 时资产弧长为 `percent / 100 * 2π`，不足部分由稳定虚拟 ID `__unallocated__` 占位；超过 100% 时几何按 `percent / totalPercent` 闭合。
- 编辑一个资产只修改该资产；总和大于 100% 时继续正常显示，其他资产值不被自动调整。
- 默认 620 ms、`cubic-bezier(0.22, 1, 0.36, 1)`；reduced-motion 使用 120 ms 交叉淡化，无滚动、弹跳或延迟吸附。
- 正式 APP 代码必须等用户确认手机预览后再接入。

---

### Task 1: 单一比例状态、空仓与精确帧模型

**Files:**
- Create: `asset-pie-model.js`
- Create: `tests/asset-pie-motion.test.cjs`

**Interfaces:**
- Consumes: `rows: Array<{id:string}>`, `fromPercentages`, `targetPercentages`, `portfolioAmount`, `progress`。
- Produces: `snapshotPercentages`, `applyPercentageEdit`, `interpolatePercentages`, `computeAllocationFrame`, `cubicBezierProgress`。

- [ ] **Step 1: 写共享金额/比例失败测试**

```js
test('an underallocated frame preserves asset percentages and fills the remainder with vacancy', () => {
  const frame = model.computeAllocationFrame({ voo: 55, qqq: 20, gold: 10 }, ['voo','qqq','gold'], 100000);
  assert.equal(frame.byId.qqq.percent, 20);
  assert.equal(frame.byId.qqq.amount, 20000);
  assert.equal(frame.unallocatedPercent, 15);
  assert.equal(frame.segments.at(-1).id, '__unallocated__');
  assert.ok(Math.abs(frame.segments.at(-1).endAngle - frame.startAngle - Math.PI * 2) < 1e-12);
});
```

- [ ] **Step 2: 运行 RED**

Run: `node --test tests/asset-pie-motion.test.cjs`

Expected: FAIL，`asset-pie-model.js` 不存在。

- [ ] **Step 3: 实现比例单调插值**

```js
function interpolatePercentages(from, target, eased) {
  const ids = new Set([...Object.keys(from), ...Object.keys(target)]);
  return Object.fromEntries([...ids].map(id => {
    const a = Number(from[id]) || 0;
    const b = Number(target[id]) || 0;
    return [id, a + (b - a) * eased];
  }));
}
```

- [ ] **Step 4: 实现空仓、比例编辑和累计角闭合**

总和不超过 100% 时每块资产角度严格使用自身真实比例，缺额追加 `__unallocated__` 并精确闭合到 `startAngle + 2π`。总和超过 100% 时，原始显示比例保持不变，仅几何按 `percent / totalPercent` 压入完整圆。`applyPercentageEdit()` 只更新目标 `assetId`，不联动改写其他资产。

- [ ] **Step 5: 验证 GREEN**

Run: `node --test tests/asset-pie-motion.test.cjs`

Expected: 0 failures；增加/减少比例在所有采样进度上均不越过目标；不足 100% 时资产加空仓合计 360°，超过 100% 时资产几何按相对权重无重叠闭合。

### Task 2: 可中断的唯一共享时钟

**Files:**
- Modify: `asset-pie.js`
- Test: `tests/asset-pie-motion.test.cjs`

**Interfaces:**
- Consumes: `computeAllocationFrame(percentages, order, portfolioAmount)`。
- Produces: `createAllocationAnimator({duration,easing,onFrame,onCommit})`, `updateTarget(targetPercentById)`, `sample(now)`, `cancel()`。

- [ ] **Step 1: 写同起同止和接管失败测试**

```js
test('a rapid update starts from the sampled visual percentages', () => {
  const animator = model.createTestAnimator({ now: 0, from: { qqq: 10 }, to: { qqq: 20 } });
  const current = animator.sample(310).percentages.qqq;
  animator.retarget({ qqq: 5 }, 310);
  assert.equal(animator.sample(310).percentages.qqq, current);
  assert.equal(animator.activeLoopCount(), 1);
});
```

- [ ] **Step 2: 实现 generation 与单 rAF**

旧循环在 generation 失效后不得写回；新目标以调用瞬间的 `visualPercentages` 为起点，同一帧内多次更新只保留最新目标。

- [ ] **Step 3: 同步帧契约**

每次 `onFrame` 只接收一个对象：`{progress,eased,percentages,amounts,unallocatedPercent,segments,byId}`。数字、path、centroid、标签、选择和吸附不得自行取时间。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/asset-pie-motion.test.cjs`

Expected: 快速 10%→20%→5% 无跳回、无第二个 rAF、最终为最新目标。

### Task 3: 圆润花瓣几何、标签与选择叠加

**Files:**
- Modify: `asset-pie-model.js`
- Modify: `asset-pie.js`
- Test: `tests/asset-pie-motion.test.cjs`

**Interfaces:**
- Consumes: 每帧 `startAngle/endAngle/midpointAngle`。
- Produces: `roundedPetalPath`, `labelLayout`, `selectionTargetsForFrame`。

- [ ] **Step 1: 写非尖锐 path 失败测试**

```js
test('rounded petal never closes directly through the exact center', () => {
  const path = model.roundedPetalPath({ startAngle: 0, endAngle: Math.PI / 5 }, layout);
  assert.ok(path.includes('Q') || path.includes('C'));
  assert.notMatch(path, new RegExp(`M ${layout.cx} ${layout.cy} L`));
});
```

- [ ] **Step 2: 实现实时 path 与 centroid**

圆润内端使用非零 tip setback 和二次/三次曲线；角度仍来自完整比例，不通过裁角改变数据。所有资产节点在更新中保留，不淡出重建。

- [ ] **Step 3: 实现标签优先级**

实时 sweep 不足时依次隐藏：资产全称 → 金额 → 仅保留代码和比例；透明度由同一 progress/当前 sweep 决定，不改变布局。

- [ ] **Step 4: 叠加选中与吸附**

`geometry` path 先更新；`selection-position` 再按新 midpoint/centroid 计算 18 px 选中位移和距离衰减吸附；`selectedAssetId` 不随数据更新清空。

- [ ] **Step 5: 运行测试**

Run: `node --test tests/asset-pie-motion.test.cjs`

Expected: QQQ 选中更新后仍选中，VOO/SGOL 吸附方向随新 centroid 变化，路径每帧闭合且无尖端。

### Task 4: 纵向数字槽与统一格式化

**Files:**
- Modify: `asset-pie.js`
- Modify: `index.html`（仅饼图数字 CSS）
- Test: `tests/asset-pie-motion.test.cjs`

**Interfaces:**
- Consumes: 每帧已插值 amount/ratio、整个更新的 delta 方向。
- Produces: `createDigitRoller`, `renderFormattedValue`, `finishExactValue`。

- [ ] **Step 1: 写稳定字符失败测试**

```js
test('currency, separators and unchanged slots remain static', () => {
  const plan = model.planDigitSlots('¥10,000.00', '¥12,000.00', 1);
  assert.deepEqual(plan.filter(x => x.static).map(x => x.char), ['¥', '1', ',', '0', '0', '0', '.', '0', '0']);
  assert.equal(plan.find(x => x.from === '0' && x.to === '2').direction, 'up');
});
```

- [ ] **Step 2: 实现固定宽度数字槽**

每个可变数字位最多保留当前/下一字形两个节点；`¥`、`%`、小数点和千分位是静态节点。CSS 使用 `font-variant-numeric: tabular-nums` 和固定 `ch` 宽度。

- [ ] **Step 3: 接入共享帧**

金额和比例的文本值只来自当前 frame；下降方向为 `down`，上升方向为 `up`。动画末帧强制写精确目标格式，避免浮点残留。

- [ ] **Step 4: 运行测试**

Run: `node --test tests/asset-pie-motion.test.cjs`

Expected: 10→20 向上、20→5 向下；标点不移动；金额和比例与 frame 完全一致。

### Task 5: 新增、删除、reduced-motion 与最终播报

**Files:**
- Modify: `asset-pie-model.js`
- Modify: `asset-pie.js`
- Modify: `index.html`
- Test: `tests/asset-pie-motion.test.cjs`

**Interfaces:**
- Consumes: 稳定 `assetId` 集合差异、`prefers-reduced-motion`。
- Produces: `reconcileAssetSet`, `finalizeRemovedAssets`, `announceFinalUpdate`。

- [ ] **Step 1: 写新增/删除失败测试**

新增资产在 `fromAmounts` 为 0；删除资产在 `targetAmounts` 为 0，并且只在 progress=1 后离开 order/DOM。

- [ ] **Step 2: 实现稳定顺序**

已有资产沿用 `state.rows` 顺序；除用户拖动排序外不按比例重新排序。新增项插入业务指定位置，删除项在结束后移除。

- [ ] **Step 3: reduced-motion 降级**

120 ms 简单交叉淡化；无数字滚动、scale、吸附延迟或大位移，但最终金额、比例、角度、选择和键盘功能完整。

- [ ] **Step 4: 最终 aria-live**

动画过程中数字节点使用 `aria-hidden`; 结束后只播报一次，例如“QQQ 已更新为 12%，金额 ¥12,000.00”。

- [ ] **Step 5: 运行测试**

Run: `node --test tests/asset-pie-motion.test.cjs`

Expected: add/remove 生命周期、stable order、reduced-motion 和一次最终播报全部通过。

### Task 6: 先更新独立手机预览并验收

**Files:**
- Modify: `C:\Users\13634\Documents\ChatGPT\ETF ALLOCATOR\design-tests\asset-pie\mobile-motion-preview\index.html`
- Modify: `C:\Users\13634\Documents\ChatGPT\ETF ALLOCATOR\design-tests\asset-pie\mobile-motion-preview\asset-pie-preview.js`
- Modify: `C:\Users\13634\Documents\ChatGPT\ETF ALLOCATOR\design-tests\asset-pie\mobile-motion-preview\asset-pie-preview.test.cjs`
- Modify: `C:\Users\13634\Documents\ChatGPT\ETF ALLOCATOR\design-tests\asset-pie\mobile-motion-preview\preview-report.md`

**Interfaces:**
- Consumes: Tasks 1–5 的纯模型和动效契约。
- Produces: 390×844 可触摸预览与验收截图/录屏。

- [ ] **Step 1: 增加仅预览用的测试触发器**

提供 QQQ 10→20、20→5、快速连续更新、新增、删除五个可重复场景；这些触发器不进入正式 APP UI。

- [ ] **Step 2: 运行 390×844 同步验收**

用帧级记录验证金额数字、比例、path、label 和吸附第一/最后变化帧差不超过 1 帧。

- [ ] **Step 3: 运行数据准确性验收**

每个 rAF 采样断言角度合计 2π，金融数值处于 from/target 闭区间，最后金额/比例/path 完全一致。

- [ ] **Step 4: 运行交互叠加验收**

QQQ 选中后执行更新，确认选中不丢、18 px 方向随 midpoint 更新、VOO/SGOL 按新 centroid 联动；快速更新无闪跳。

- [ ] **Step 5: 用户审批门**

把手机预览交给用户检查；未收到明确通过前不得开始正式 APP 接线。

### Task 7: 正式 APP 接线、缓存与回归

**Files:**
- Create: `asset-pie-model.js`
- Create/Modify: `asset-pie.js`
- Modify: `index.html`
- Modify: `service-worker.js`
- Create/Modify: `tests/asset-pie-motion.test.cjs`
- Create: `docs/dev-loop-runs/2026-09-02-asset-pie-morph/06-data-motion-acceptance.md`

**Interfaces:**
- Consumes: `state.rows`, `targetOf(row)`, `state.rows[].id`。
- Produces: `assetPieController.updateAllocationData(rows, amountFor, reason)`。

- [ ] **Step 1: 在饼图独立容器初始化控制器**

`tbody` 重建不得销毁 SVG；控制器只初始化一次，后续按 `assetId` 增量更新节点。

- [ ] **Step 2: 在状态变更后显式推送数据**

比例、主本金、股数反推比例、资产替换、排序、重置和加载后调用同一 `updateAllocationData`，不使用 MutationObserver 猜测业务变化。

- [ ] **Step 3: 更新 PWA 缓存**

缓存名移除 `no-pie`；APP_SHELL 加入 `asset-pie-model.js`、`asset-pie.js` 和四类本地资产纹理。

- [ ] **Step 4: 运行完整自动测试**

Run: `node --test tests/asset-pie-motion.test.cjs`

Expected: 0 failures。

- [ ] **Step 5: 运行正式页面回归**

验证比例输入焦点、排序、替换资产、股数反推、卡片翻面、详情、汇率、打印小票、localStorage、PWA 刷新和 reduced-motion 未退化。

- [ ] **Step 6: 写验收报告**

记录 390×844、360×800、430×932、桌面视口的命令、帧级同步证据、截图、失败项和残余风险。

## Self-Review

- Spec coverage: 数字类型/方向、共享时钟、单一金额源、精确 360°、弧长、标签、选中吸附叠加、快速接管、新增删除、稳定排序、reduced-motion、播报和预览审批均有对应任务。
- Placeholder scan: 无 TBD/TODO/“稍后实现”；每个实现步骤含明确接口、行为和验证命令。
- Type consistency: `snapshotPercentages → applyPercentageEdit → interpolatePercentages → computeAllocationFrame → onFrame → assetPieController` 的字段名在所有任务一致。
- Product rule confirmed: 卡片与饼图共用真实比例；不足 100% 显示空仓；超过 100% 仍正常显示，仅几何按相对权重闭合到 360°；编辑单项不会改写其他资产。
