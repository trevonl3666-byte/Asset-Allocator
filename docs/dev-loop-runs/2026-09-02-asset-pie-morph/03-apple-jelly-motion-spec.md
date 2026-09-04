# Apple 式克制果冻联动规格

## 范围

在现有资产卡片视图之外增加“资产配置饼状图”视图，并保留卡片与饼图之间的双向转换。当前页面的颜色、字体、按钮、导航、汇率、排序、替换资产、汇总和持久化逻辑均不改变。

Apple 规范只影响以下交互原则：

- 直接操控：按下扇区后立即出现轻微压缩反馈。
- 按压反馈：按下和释放属于同一次操作，不等待动画结束才响应。
- 克制弹性：只允许一次过冲，随后稳定；不循环漂浮、不连续摇摆。
- 减少动态：`prefers-reduced-motion: reduce` 下取消弹跳、缩放和邻近吸附。

不采用 Apple 的颜色、字体、圆角、卡片、导航或页面布局。

## 当前源码事实

- 技术栈：原生 HTML、CSS、JavaScript，单页 PWA。
- 入口：`index.html`，包含页面样式、模板、业务状态和渲染逻辑。
- 图表库：没有 ECharts、Recharts、D3、Chart.js 或其他图表库。
- 构建系统：没有 `package.json`、打包器或框架运行时。
- 数据源：`state.rows`，默认顺序为 VOO、QQQ、SGOL、159361、03032、512890、SCHD。
- 金额：现有 `targetOf(row)` 返回目标人民币金额。
- 当前选中状态：没有资产饼图选中状态；现有 `detailsExpanded` 和 `diffFlipped` 是卡片内部状态，不能复用为饼图选择。
- 移动容器：`<=760px` 时 `.wrap` 左右各 10px，资产区可用宽度约为 `100vw - 20px`。
- 现有 reduced-motion：排序和卡片翻转已有局部降级规则，新模块沿用同一媒体查询。

## 技术方案

使用依赖为零的原生 SVG。每个资产对应一个可聚焦 `<g data-asset-id>`，内部包含：

1. 资产背景图案和暗化层；
2. 精确比例扇区路径；
3. 标签；
4. 透明点击路径；
5. 焦点/选中轮廓。

整组应用同一 `transform`，确保路径、标签和点击区域永远同步。扇区角度不参与选择动画，选择只改变平移和缩放。

新增独立文件 `asset-pie.js`，采用浏览器全局 + CommonJS 兼容导出。几何、吸附和 Motion 目标值可在 Node 内测试；`index.html` 只负责提供现有数据和装载 UI。

## 状态模型

饼图 UI 状态不写入投资数据，也不保存到 `localStorage`：

```text
assetPieUiState = {
  viewMode: "cards" | "pie",
  selectedAssetId: string | null,
  isMorphing: boolean,
  reducedMotion: boolean,
  animations: Map<assetId, Animation>,
  layout: { width, height, centerX, centerY, outerRadius }
}
```

- `selectedAssetId` 是唯一的选择来源。
- 默认和切换到饼图时为 `null`。
- 再次点击当前扇区、点击 SVG 空白处或按 Escape 时设为 `null`。
- 从 QQQ 切换到 VOO 时直接把目标值改为 VOO，不经过 `null`。
- `detailsExpanded`、`diffFlipped` 与 `selectedAssetId` 互不影响。

## 扇区角度与数据

- 仅渲染 `pct > 0` 的资产。
- 当前默认合计为 100%，每个扇区角度为 `pct / 100 * 2π`。
- 页面允许用户把总比例改成非 100%。此时用 `pct / positiveTotal * 2π` 填满整圆，但标签继续显示用户输入的原始比例；现有合计区域继续提示总比例异常。
- 合计为 0 时显示现有风格的空状态，不生成无效路径。
- 扇区顺序来自 `state.rows`，几何方向使 QQQ 位于 VOO 与 SGOL 之间。
- 默认视觉间隔按半径换算为约 4–5px，不通过修改比例制造间隔。

## 响应式尺寸

使用 `ResizeObserver` 监听饼图容器：

```text
chartSize = min(containerWidth - 24, desktop ? 620 : 560)
outerRadius = chartSize / 2 - 24
centerX = chartSize / 2
centerY = chartSize / 2
```

预留的 24px 用于 20px 最大径向位移、焦点轮廓和抗锯齿余量。移动端实际图表宽度跟随 `.wrap`，不产生横向滚动。尺寸变化时只重算路径与目标位置，不修改资产数据。

## 标签策略

严格比例下，3%–4% 扇区无法在 390px 屏幕中可靠容纳四行可读文字。为同时满足精确角度和四项信息完整展示：

- 弧长充足的扇区：代码、比例、金额、名称全部放在扇区内部。
- 小扇区：代码和比例放在扇区内部；金额和名称放入与该扇区绑定的紧凑外侧标签，使用短连接线，不形成独立图例。
- 内外标签都位于相同资产 `<g>` 内，选择、吸附和复位时同步移动。
- 点击后的泡泡详情卡继续显示完整资产字段，包括单股金额和股数。

## 选中位移

对选中扇区 `s`：

```text
u_s = (cos(midpointAngle_s), sin(midpointAngle_s))
selectedTranslate = 18 * u_s
selectedScale = 1.035
```

- 径向位移默认 18px，绝不超过 20px。
- 释放后的单次过冲最大为 20px / 1.058。
- 选中 `<g>` 临时移动到 SVG 绘制顺序末尾，保证视觉层级最高；数据顺序不变。
- `transform-origin` 使用扇区交互中心，文字和命中区域随 `<g>` 一起变换。

## 邻近吸附算法

每个扇区使用统一交互中心，而不使用资产名称：

```text
centroid_i = center + 0.62 * outerRadius * radialUnit(midpointAngle_i)
direction_i = normalize(selectedTargetCentroid - centroid_i)
```

位移上限先按环形邻接层级确定，再由中点角距离连续衰减：

| 环形距离 | 上限 | 预期范围 |
|---:|---:|---:|
| 1（直接相邻） | 10px | 6–10px |
| 2 | 4px | 0–4px，通常 2–4px |
| ≥3 | 1px | 0–1px |

```text
angularWeight = smoothstep(π, 0, circularDistance(mid_i, mid_selected))
if ringDistance == 1:
  distance = 6 + 4 * angularWeight
else:
  distance = ringCap * angularWeight²
translate_i = distance * direction_i
```

直接相邻项始终有至少 6px 联动；第二层和更远项会因角距离变大而快速减弱。因此选中 QQQ 时，VOO 与 SGOL 明显联动，而跨越 VOO 大扇区后的 SCHD 可降到约 1px。

为避免重叠，几何模块会对原始目标距离执行二分收缩：对变换后的扇区边界多点采样，若最小间距低于 4px，则减小非选中扇区位移，直到满足间距或降到 0。

## Motion 参数

项目不引入弹簧库。使用 Web Animations API 实现一次过冲，并在每次新选择前从当前计算矩阵接管动画。

| 状态 | 位移 | 缩放 | 时间 | 关键行为 |
|---|---:|---:|---:|---|
| 按下 | 保持当前 | 0.985 | 80–100ms | 立即反馈 |
| 选中扇区 | 18px，过冲不超过20px | 1.035，过冲1.058 | 420ms | 只过冲一次 |
| 直接相邻 | 6–10px | 1 | 390ms | 位移过冲最多 8% |
| 第二层 | 0–4px | 1 | 370ms | 角距离衰减 |
| 更远 | 0–1px | 1 | 320ms | 接近静止 |
| 取消选中 | 回到0，反向过冲最多1.5px | 回到1，最低0.995 | 420ms | 只反向一次 |
| 快速切换 | 从当前矩阵到新目标 | 从当前值到新目标 | 340–420ms | 取消旧 Animation，不清零 |

WAAPI 关键帧以当前 transform 为第 0 帧；42% 到达一次正向过冲，76% 轻微回落，100% 稳定。取消时 72% 允许一次轻微反向过冲。没有无限动画。

## 快速切换与动画接管

1. 读取当前 `<g>` 的 `getComputedStyle(...).transform`。
2. 将该矩阵写回内联样式。
3. 取消旧 `Animation`。
4. 以当前矩阵为新动画起点，直接过渡到新选择目标。

不先恢复默认状态，不排队，不叠加多个动画完成回调。每个资产在 `animations` 中最多只有一个活动动画。

## 取消选择

- 再次点击当前扇区；
- 点击 SVG 空白区域；
- 按 Escape；
- 切回卡片视图。

所有扇区从当前矩阵回到 `translate(0,0) scale(1)`。选中详情泡泡同步关闭。取消动画期间仍可直接选择另一个资产，新选择会接管当前位置。

## reduced-motion

`prefers-reduced-motion: reduce` 时：

- 不执行按压缩放、过冲、邻近吸附和卡片/饼图空间移动；
- 扇区保持原位，仅使用现有蓝色轮廓、轻微暗化和详情卡显隐表达选择；
- 选择和取消立即完成；
- 键盘和触摸行为保持一致。

## 可访问性

- 每个资产 `<g>`：`role="button"`、`tabindex="0"`、`aria-pressed`。
- `aria-label` 包含资产代码、百分比、人民币目标金额和资产名称。
- Enter/Space 选择或取消；Escape 取消。
- `:focus-visible` 使用现有 `#4b86c5` 焦点色，与选择轮廓分层显示。
- 透明命中路径跟随同一 `<g>`，触摸目标不因扇区移动而错位。
- 选中不能只依赖颜色：同时存在位置、轮廓和 `aria-pressed`。

## 验收场景

1. 默认图为完整规则圆，角度严格对应比例，无循环运动。
2. 选中 QQQ：QQQ 向外 18px，最大缩放 1.058，最终 1.035。
3. VOO/SGOL 吸附 6–10px；SCHD 约 0–1px。
4. 任何吸附后扇区间视觉间距不少于 4px。
5. 再点 QQQ、点空白或 Escape 后一次回弹复位。
6. 快速 QQQ→VOO 不经过默认态，不闪烁，不堆积动画。
7. 标签、外侧标签、焦点与命中区始终跟随扇区。
8. 390px 手机触摸、桌面鼠标和键盘均可完成操作。
9. reduced-motion 下无弹跳、缩放和大位移。
10. 页面其他区域、现有按钮和业务计算保持不变。

