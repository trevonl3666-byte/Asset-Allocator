(() => {
  'use strict';

  const model = window.AssetPieMotion;
  const NS = 'http://www.w3.org/2000/svg';
  const APP_ROOT = './';
  const COMPACT_MORPH_POINTS = 18;
  const TEXTURES = {
    usd: `${APP_ROOT}assets/usd-background.png`,
    gold: `${APP_ROOT}assets/gold-background.jpeg`,
    cny: `${APP_ROOT}assets/cny-background.jpeg`,
    hkd: `${APP_ROOT}assets/hkd-background.png`,
  };
  const DEPTH_TINTS = Object.freeze({ usd: '#5b9dcc', gold: '#c98a31', cny: '#c95b62', hkd: '#7c8e69' });

  function bootAssetPieView() {
    const win = window;
    const doc = document;
    if (!doc || !doc.getElementById('tbody')) return;
    if (doc.getElementById('assetPieViewBtn')) return;

    injectStyles(doc);

    const sortBar = doc.querySelector('.mobileSortBar');
    const tableWrap = doc.querySelector('.tableWrap');
    const actionSlot = sortBar && sortBar.querySelector('.assetViewActions');
    if (!sortBar || !tableWrap || !actionSlot) return;

    const toggle = doc.createElement('button');
    toggle.id = 'assetPieViewBtn';
    toggle.type = 'button';
    toggle.className = 'mobileSortIconBtn assetPieViewBtn';
    toggle.setAttribute('aria-label', '切换为资产配置饼状图');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4.5a11.5 11.5 0 1 0 11.5 11.5H16Z"/><path d="M18.5 3.8v9.7h9.7A11.5 11.5 0 0 0 18.5 3.8Z"/></svg>';
    actionSlot.prepend(toggle);

    const stage = buildStage(doc);
    tableWrap.before(stage);

    const compactMotion = win.matchMedia('(max-width: 760px)').matches || (win.navigator.hardwareConcurrency || 8) <= 4;
    const state = {
      mode: 'cards',
      selectedId: null,
      focusedAssetId: null,
      assets: [],
      geometry: [],
      selection: new Map(),
      petalNodes: new Map(),
      selectionRaf: 0,
      selectionAnimating: false,
      selectionLast: 0,
      rotationRaf: 0,
      chartRotation: { value: 0, velocity: 0, target: 0, dragging: false },
      drag: null,
      suppressClickUntil: 0,
      flowStartedAt: 0,
      dataRaf: 0,
      dataTransition: null,
      dataTimer: 0,
      dataDirty: true,
      detailTimer: 0,
      morphing: false,
      ringOrder: [],
      lastContourAt: 0,
      compactMorphClips: new Map(),
      reduceMotion: win.matchMedia('(prefers-reduced-motion: reduce)').matches && !compactMotion,
      compactMotion,
    };
    installPieSwipe(doc, stage, state);
    installDetailSwipe(doc, stage, state);

    function readAssets() {
      return [...doc.querySelectorAll('#tbody tr[data-row-id]')].map((row) => {
        const name = row.querySelector('.assetName')?.textContent.trim() || row.dataset.rowId;
        const pct = parseNumber(row.querySelector('.pctInput')?.value);
        const moneyText = row.querySelector('.money')?.textContent || '¥0';
        const amount = parseNumber(moneyText);
        const shares = row.querySelector('.sharesInput')?.value?.trim() || '';
        const texture = row.classList.contains('goldAsset') ? 'gold'
          : row.classList.contains('hkdAsset') ? 'hkd'
            : row.classList.contains('cnyAsset') ? 'cny' : 'usd';
        return {
          id: row.dataset.rowId,
          name,
          pct,
          amount,
          moneyText: formatMoney(amount),
          desc: row.querySelector('.desc')?.textContent.trim() || '',
          shares,
          texture,
          row,
        };
      });
    }

    function orderForReference(assets) {
      if (!state.ringOrder.length) {
        const wanted = ['VOO', 'SCHD', '512890', '03032', '159361', 'SGOL', 'QQQ'];
        const byName = new Map(assets.map((asset) => [asset.name, asset]));
        state.ringOrder = wanted.filter((name) => byName.has(name)).map((name) => byName.get(name).id);
      }
      for (const asset of assets) if (!state.ringOrder.includes(asset.id)) state.ringOrder.push(asset.id);
      const byId = new Map(assets.map((asset) => [asset.id, asset]));
      return state.ringOrder.map((id) => byId.get(id)).filter(Boolean);
    }

    function scheduleDataRefresh() {
      state.dataDirty = true;
      if (state.mode !== 'pie') return;
      win.clearTimeout(state.dataTimer);
      state.dataTimer = win.setTimeout(() => {
        animateDataChange(doc, stage, state, orderForReference(readAssets()));
      }, 24);
    }

    function refresh(immediate = true) {
      state.assets = orderForReference(readAssets());
      renderPie(doc, stage, state, immediate);
      updateSummary(doc, stage);
      if (state.selectedId) renderDetail(doc, stage, state, state.selectedId);
      state.dataDirty = false;
    }

    toggle.addEventListener('click', () => {
      if (state.morphing) return;
      if (state.mode === 'cards') morphToPie(doc, win, stage, tableWrap, toggle, state, refresh);
      else morphToCards(doc, win, stage, tableWrap, toggle, state);
    });
    toggle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle.click();
    });

    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.mode === 'pie') selectAsset(doc, stage, state, null);
    });

    doc.addEventListener('input', (event) => {
      if (!event.target.matches('.pctInput,.actualInput,.unitPriceInput,.sharesInput')) return;
      scheduleDataRefresh();
    }, true);

    const observedAssetsNode = doc.getElementById('tbody') || tableWrap;
    try {
      const assetsObserver = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.type === 'childList')) scheduleDataRefresh();
      });
      assetsObserver.observe(observedAssetsNode, { childList: true, subtree: true });
    } catch (_) {
      let previousAssetIds = readAssets().map((asset) => asset.id).join('|');
      win.setInterval(() => {
        const currentAssetIds = readAssets().map((asset) => asset.id).join('|');
        if (currentAssetIds === previousAssetIds) return;
        previousAssetIds = currentAssetIds;
        scheduleDataRefresh();
      }, 120);
    }

    stage.addEventListener('click', (event) => {
      if (event.target.closest('.assetPieDetail,.assetPieInlineRatio,.pieSummary,.assetPetal')) return;
      if (performance.now() < state.suppressClickUntil) return;
      selectAsset(doc, stage, state, null);
    });

    stage.querySelector('.pieBackTop').addEventListener('click', () => win.scrollTo({ top: 0, behavior: state.reduceMotion ? 'auto' : 'smooth' }));
    stage.querySelector('.pieShowSummary').addEventListener('click', () => {
      const footer = stage.querySelector('.pieSummary');
      footer.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.018)' }, { transform: 'scale(1)' }],
        { duration: state.reduceMotion ? 120 : 360, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
    });

    // Prepare the hidden SVG after first paint so the first tap only starts
    // compositor work. Safari has no requestIdleCallback on several iOS
    // versions, so it needs the short timeout fallback as well.
    const prepareHiddenPie = () => {
      if (state.mode === 'cards' && state.dataDirty) refresh();
      if (state.mode === 'cards' && state.compactMotion) cacheCompactMorphClips(stage, state);
    };
    if (typeof win.requestIdleCallback === 'function') {
      win.requestIdleCallback(prepareHiddenPie, { timeout: 420 });
    } else win.setTimeout(prepareHiddenPie, 140);

  }

  function parseNumber(value) {
    const number = Number(String(value ?? '').replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(number) ? number : 0;
  }

  function formatMoney(value) {
    return `¥${Math.round(Number(value) || 0).toLocaleString('zh-CN')}`;
  }

  function injectStyles(doc) {
    const style = doc.createElement('style');
    style.id = 'assetPiePreviewStyles';
    style.textContent = `
      .assetPieViewBtn{margin-right:8px;color:#99adc2;transition:color .16s ease,opacity .16s ease,transform .16s ease}
      .assetPieViewBtn:active{transform:scale(.94)}
      .assetPieViewBtn[aria-pressed="true"]{color:#2d9cff}
      .assetPieViewBtn svg{display:block;width:20px;height:20px;fill:currentColor;stroke:currentColor;stroke-width:1.25;stroke-linejoin:round}
      body.assetPieMode #assetPieStage + .tableWrap{display:none!important}

      #assetPieStage{margin:0;border:1px solid #2a3949;border-radius:0 0 22px 22px;background:radial-gradient(circle at 52% 34%,rgba(23,40,54,.44),rgba(7,13,19,.96) 67%),#071018;overflow:hidden;box-shadow:0 18px 44px rgba(0,0,0,.3)}
      #assetPieStage[hidden]{display:block!important;position:fixed!important;left:-200vw!important;top:0!important;width:calc(100vw - 10px)!important;visibility:hidden!important;pointer-events:none!important;contain:strict!important}
      .assetPieViewport{position:relative;height:min(116vw,500px);min-height:438px;max-height:500px;padding:5px 0 0;touch-action:none;overscroll-behavior:contain;transition:height 440ms cubic-bezier(.22,1,.36,1),min-height 440ms cubic-bezier(.22,1,.36,1),max-height 440ms cubic-bezier(.22,1,.36,1)}
      #assetPieSvg{display:block;width:100%;height:100%;overflow:visible;transform-origin:50% 45.581%;transition:none;will-change:transform;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform-style:flat}
      #assetPieStage.hasSelection .assetPieViewport{height:min(116vw,500px);min-height:438px;max-height:500px}
      .assetPetal{cursor:pointer;outline:none;transform-box:view-box;transform-origin:center;will-change:transform}
      .assetPetal .petalDepthWall{opacity:0;pointer-events:none;stroke:var(--petal-accent,#6aaee3);stroke-width:1.15;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke;filter:brightness(.64) saturate(1.12) drop-shadow(0 8px 7px rgba(0,0,0,.7));will-change:transform,opacity}
      .assetPetal .petalDepthTint{fill:#5b9dcc;opacity:0;pointer-events:none;stroke:color-mix(in srgb,var(--petal-accent,#8ecaff) 58%,white);stroke-width:.95;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke;filter:brightness(1.08) saturate(1.12) drop-shadow(0 4px 5px rgba(0,0,0,.42));will-change:transform,opacity}
      .assetPetal .petalTexture{filter:url(#petalDepth)}
      .assetPetal .petalShade{fill:rgba(4,10,16,.46)}
      .assetPetal .petalEdge{fill:none;stroke:#42586d;stroke-width:1.3;vector-effect:non-scaling-stroke;opacity:.9}
      .assetPetal .petalHighlight{fill:none;stroke:rgba(203,224,245,.13);stroke-width:.75;vector-effect:non-scaling-stroke}
      .assetPetal .petalHit{fill:transparent;stroke:transparent;stroke-width:12;pointer-events:all}
      .assetPetal:focus-visible .petalEdge{stroke:#64b2ff;stroke-width:2.2}
      .assetPetal.isSelected .petalVisual{filter:brightness(1.12) saturate(1.06) drop-shadow(0 10px 11px rgba(0,0,0,.64)) drop-shadow(0 0 7px rgba(76,164,242,.58))}
      .assetPetal.isSelected .petalShade{fill:rgba(4,10,16,.31)}
      .assetPetal.isSelected .petalEdge{stroke:color-mix(in srgb,var(--petal-accent,#8ecaff) 68%,white);stroke-width:1.75;stroke-linejoin:round}
      .assetPetal.isSelected .petalHighlight{stroke:rgba(237,248,255,.9);stroke-width:1.2}
      .petalLabel{pointer-events:all;fill:#eef6ff;text-anchor:middle;paint-order:stroke;stroke:rgba(3,8,13,.34);stroke-width:1.4px;stroke-linejoin:round;font-variant-numeric:tabular-nums;user-select:none;-webkit-user-select:none}
      .assetPieViewport.isRotating .petalLabel{opacity:.18!important;pointer-events:none}
      .petalLabel text{pointer-events:none}
      .petalPctHit{fill:transparent;stroke:transparent;stroke-width:1;pointer-events:all;cursor:text}
      .petalPctHit:focus-visible{fill:rgba(36,145,255,.12);stroke:#79bdff;stroke-width:1.5;outline:none}
      .assetPieInlineRatio{position:absolute;z-index:12;display:flex;align-items:center;gap:5px;padding:6px;border:1px solid #45627d;border-radius:14px;background:rgba(9,18,27,.96);box-shadow:0 14px 32px rgba(0,0,0,.46),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(14px);transform:translate(-50%,-100%);transform-origin:50% 100%}
      .assetPieInlineRatio::after{content:"";position:absolute;left:50%;bottom:-5px;width:9px;height:9px;transform:translateX(-50%) rotate(45deg);border-right:1px solid #45627d;border-bottom:1px solid #45627d;background:#0a131d}
      .assetPieInlineRatio input{position:relative;z-index:1;width:68px;height:34px;padding:0 8px;border:1px solid #334c63;border-radius:9px;background:#060d14;color:#f4f9ff;font:750 15px/1 system-ui,sans-serif;text-align:center;font-variant-numeric:tabular-nums;outline:none}
      .assetPieInlineRatio input:focus{border-color:#3b9fff;box-shadow:0 0 0 2px rgba(40,151,255,.16)}
      .assetPieInlineRatio button{position:relative;z-index:1;width:32px;height:32px;padding:0;border:1px solid #334c63;border-radius:9px;background:#13202c;color:#dcecff;font:700 19px/1 system-ui,sans-serif;cursor:pointer}
      .assetPieInlineRatio button:active{transform:scale(.92)}
      .assetPieInlineRatio .ratioUnit{position:relative;z-index:1;margin-left:-2px;color:#9cb2c7;font:700 13px/1 system-ui,sans-serif}
      .pieEmptyState{fill:#7f93a7;text-anchor:middle;font-size:14px;font-weight:650;letter-spacing:.01em}
      .petalCode{font-weight:820;letter-spacing:.01em}
      .petalPct{font-weight:900}
      .petalAmount{font-weight:650;fill:#dce8f4}
      .petalDesc,.petalShares{font-weight:520;fill:#aebfd1}
      .pieInstruction{margin:-6px 0 19px;text-align:center;color:#64798d;font-size:13px;letter-spacing:.015em}
      .assetPieDetail{margin:0 12px 16px;transform-origin:50% 0;position:relative;touch-action:pan-y}
      @media (max-width:900px){
        body,body *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
        input,textarea,[contenteditable="true"],[contenteditable="true"] *{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}
      }
      .assetPieDetail[hidden]{display:none!important}
      .assetPieDetail::before{content:"";position:absolute;left:var(--detail-anchor,50%);top:-8px;width:16px;height:16px;transform:translateX(-50%) rotate(45deg);border-left:1px solid #31465b;border-top:1px solid #31465b;background:#0d1721;z-index:1}
      .assetPieDetail table{min-width:0!important;width:100%;border-collapse:separate;border-spacing:0;position:relative;z-index:2}
      .assetPieDetail table.detailLeaving{position:absolute!important;inset:0;z-index:3;pointer-events:none}
      .assetPieDetail tbody tr{margin:0!important;border-radius:16px!important;overflow:hidden;box-shadow:0 16px 34px rgba(0,0,0,.32)}
      .assetPieDetail .dragHandle{pointer-events:none}
      .assetPieDetail .assetDetailsToggleWrap{display:none!important}
      .pieSummary{display:flex;align-items:center;gap:9px;padding:14px 11px 15px;border-top:1px solid #2f4050;background:rgba(7,13,19,.76)}
      .pieTotal{min-width:0;margin-right:auto}
      .pieTotal span{display:block;color:#aabccf;font-size:12px;margin-bottom:4px}
      .pieTotal strong{display:block;color:#f3f8ff;font-size:20px;line-height:1.1;white-space:nowrap}
      .pieSummary button{height:44px;padding:0 14px;border:1px solid #2d4052;border-radius:13px;background:linear-gradient(180deg,#172432,#111b26);color:#edf5ff;font-weight:760;cursor:pointer}
      .assetMorphProxy{position:fixed;left:0;top:0;z-index:2147483001;overflow:hidden;pointer-events:none;border:1px solid #3b5268;box-shadow:0 16px 36px rgba(0,0,0,.34);contain:layout paint;background-color:#0a1119;background-position:center;background-size:cover;transform-origin:0 0;will-change:clip-path,opacity,transform,border-radius}
      .assetMorphProxyTable{position:relative;z-index:2;width:100%;height:100%;min-width:0!important;border-collapse:separate;border-spacing:0;table-layout:fixed;margin:0!important}
      .assetMorphProxyTable tbody,.assetMorphProxyTable tr{width:100%;height:100%}
      .assetMorphProxyTable input,.assetMorphProxyTable button,.assetMorphProxyTable select{pointer-events:none}
      .assetMorphIdentity{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px;color:#eff7ff;text-align:center;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px rgba(0,0,0,.72);opacity:0;pointer-events:none}
      .assetMorphIdentity strong{font-size:11px;font-weight:800;line-height:1.05;letter-spacing:.01em}
      .assetMorphIdentity span{font-size:16px;font-weight:850;line-height:1}
      .assetMorphIdentity small{font-size:9px;font-weight:650;line-height:1.1;color:#dbe8f3}
      .assetMorphProxy.isLightweight{contain:strict;backface-visibility:hidden;transform-style:flat;will-change:opacity,transform}
      .assetMorphProxy.isLightweight .assetMorphIdentity{opacity:1}
      @media(max-width:390px){
        .assetPieViewport{min-height:420px;height:113vw}
        .pieSummary button{padding:0 11px;font-size:13px}
      }
      @media(prefers-reduced-motion:reduce){
        .assetPetal,.assetPieViewBtn,.assetPieViewport,#assetPieSvg{transition:none!important}
      }
    `;
    doc.head.append(style);
  }

  function buildStage(doc) {
    const section = doc.createElement('section');
    section.id = 'assetPieStage';
    section.hidden = true;
    section.innerHTML = `
      <div class="assetPieViewport">
        <svg id="assetPieSvg" viewBox="0 0 360 430" role="group" aria-label="资产配置饼状图">
          <defs>
            ${Object.entries(TEXTURES).map(([key, href]) => `<pattern id="texture-${key}" patternUnits="userSpaceOnUse" width="360" height="430"><image href="${href}" x="0" y="0" width="360" height="430" preserveAspectRatio="xMidYMid slice"/></pattern>`).join('')}
            <filter id="petalDepth" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#000814" flood-opacity=".58"/></filter>
          </defs>
          <g class="pieRotator"><g class="petalLayer"></g></g>
        </svg>
      </div>
      <p class="pieInstruction">点击资产板块查看其他配置内容</p>
      <div class="assetPieDetail" hidden></div>
      <div class="pieSummary">
        <div class="pieTotal"><span>实际交易总额</span><strong>¥0.00</strong></div>
        <button type="button" class="pieShowSummary">看汇总</button>
        <button type="button" class="pieBackTop">回顶部</button>
      </div>`;
    return section;
  }

  function updateSummary(doc, stage) {
    const text = doc.getElementById('sumActual')?.textContent || '实际 ¥0.00';
    stage.querySelector('.pieTotal strong').textContent = text.replace(/^实际\s*/, '');
  }

  function svgElement(doc, name, attrs = {}) {
    const node = doc.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  function geometryFor(assets, transition = null) {
    const layout = transition
      ? model.transitionPetalLayout(
        assets.map((asset) => transition.fromById.get(asset.id)?.pct || 0),
        assets.map((asset) => transition.toById.get(asset.id)?.pct || 0),
        transition.clock ?? transition.raw,
      )
      : model.petalLayout(assets.map((asset) => asset.pct));
    return assets.map((asset, index) => ({ asset, ...layout[index] }));
  }

  function point(cx, cy, radius, angle) {
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  }

  function bubblePetalPath(cx, cy, innerRadius, outerRadius, start, end, channel = 1, sideBend = 0, capResponse = 0, innerMotion = { angle: 0, radius: 0 }, innerBoundary = 'bubble', joinRadius = 14.5) {
    const span = Math.max(0, end - start);
    if (span < 0.006) return '';
    const gap = Math.min(span * 0.44, (0.09 * channel));
    const a0 = start + gap / 2;
    const a1 = end - gap / 2;
    const available = Math.max(0.004, a1 - a0);
    const corner = Math.min(joinRadius * channel, (outerRadius - innerRadius) * (innerBoundary === 'organic' ? .30 : .22));
    const outerCornerAngle = Math.min(corner / outerRadius, available * .23);
    const innerAngleShift = Number(innerMotion?.angle) || 0;
    const innerRadiusShift = Number(innerMotion?.radius) || 0;
    const innerA0 = a0 + innerAngleShift;
    const innerA1 = a1 + innerAngleShift;
    const innerBase = Math.max(18, innerRadius + innerRadiusShift);
    const p1 = point(cx, cy, innerBase + corner, innerA0);
    const p2 = point(cx, cy, outerRadius - corner, a0);
    const p3 = point(cx, cy, outerRadius, a0 + outerCornerAngle);
    const p4 = point(cx, cy, outerRadius, a1 - outerCornerAngle);
    const p5 = point(cx, cy, outerRadius - corner, a1);
    const p6 = point(cx, cy, innerBase + corner, innerA1);
    const capAngle = (a0 + a1) / 2 + innerAngleShift;
    const capProfile = model.referenceBubbleNoseProfile(available, innerBase, capResponse);
    const capHalfWidth = capProfile.halfWidth;
    const capTangent = { x: -Math.sin(capAngle), y: Math.cos(capAngle) };
    const innerTip = point(cx, cy, capProfile.noseRadius, capAngle);
    const sideApproach = Math.max(5, corner * .62);
    const tipUpper = { x: innerTip.x + capTangent.x * capHalfWidth * .54, y: innerTip.y + capTangent.y * capHalfWidth * .54 };
    const tipLower = { x: innerTip.x - capTangent.x * capHalfWidth * .54, y: innerTip.y - capTangent.y * capHalfWidth * .54 };
    const sideRadius = innerBase + (outerRadius - innerBase) * .52;
    const startControl = point(cx, cy, sideRadius, a0 + sideBend + innerAngleShift * .55);
    const endControl = point(cx, cy, sideRadius, a1 - sideBend + innerAngleShift * .55);
    const f = (value) => Number(value.toFixed(3));
    const outerStart = a0 + outerCornerAngle;
    const outerEnd = a1 - outerCornerAngle;
    const outerSteps = Math.max(8, Math.ceil((outerEnd - outerStart) / .16));
    const outerPoints = Array.from({ length: outerSteps + 1 }, (_, index) => {
      const t = index / outerSteps;
      const angle = outerStart + (outerEnd - outerStart) * t;
      return point(cx, cy, outerRadius, angle);
    });
    const outerCommands = [];
    for (let index = 0; index < outerPoints.length - 1; index++) {
      const p0 = outerPoints[Math.max(0, index - 1)];
      const pA = outerPoints[index];
      const pB = outerPoints[index + 1];
      const pC = outerPoints[Math.min(outerPoints.length - 1, index + 2)];
      const c1 = { x: pA.x + (pB.x - p0.x) / 6, y: pA.y + (pB.y - p0.y) / 6 };
      const c2 = { x: pB.x - (pC.x - pA.x) / 6, y: pB.y - (pC.y - pA.y) / 6 };
      outerCommands.push(`C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(pB.x)},${f(pB.y)}`);
    }
    const organicHandle = innerBoundary === 'organic' ? .46 : .22;
    const smoothDeparture = { x: p6.x + (p6.x - endControl.x) * organicHandle, y: p6.y + (p6.y - endControl.y) * organicHandle };
    const smoothArrival = { x: p1.x + (p1.x - startControl.x) * organicHandle, y: p1.y + (p1.y - startControl.y) * organicHandle };
    const innerCommands = innerBoundary === 'organic'
      ? [`C${f(smoothDeparture.x)},${f(smoothDeparture.y)} ${f(smoothArrival.x)},${f(smoothArrival.y)} ${f(p1.x)},${f(p1.y)}`]
      : [
        `C${f(p6.x - Math.cos(innerA1) * sideApproach)},${f(p6.y - Math.sin(innerA1) * sideApproach)} ${f(tipUpper.x)},${f(tipUpper.y)} ${f(innerTip.x)},${f(innerTip.y)}`,
        `C${f(tipLower.x)},${f(tipLower.y)} ${f(p1.x - Math.cos(innerA0) * sideApproach)},${f(p1.y - Math.sin(innerA0) * sideApproach)} ${f(p1.x)},${f(p1.y)}`,
      ];
    return [
      `M${f(p1.x)},${f(p1.y)}`,
      `Q${f(startControl.x)},${f(startControl.y)} ${f(p2.x)},${f(p2.y)}`,
      `Q${f(point(cx, cy, outerRadius, a0).x)},${f(point(cx, cy, outerRadius, a0).y)} ${f(p3.x)},${f(p3.y)}`,
      ...outerCommands,
      `Q${f(point(cx, cy, outerRadius, a1).x)},${f(point(cx, cy, outerRadius, a1).y)} ${f(p5.x)},${f(p5.y)}`,
      `Q${f(endControl.x)},${f(endControl.y)} ${f(p6.x)},${f(p6.y)}`,
      ...innerCommands,
      'Z',
    ].join(' ');
  }

  function renderPie(doc, stage, state, forceContours = false) {
    const layer = stage.querySelector('.petalLayer');
    const geometry = geometryFor(state.assets, state.dataTransition);
    state.geometry = geometry;
    if (state.dataTransition && state.selectedId) {
      const selectedGeometry = geometry.find((item) => item.asset.id === state.selectedId);
      if (selectedGeometry) {
        state.chartRotation.value = model.rotationTargetFor(selectedGeometry.mid, state.chartRotation.value);
        state.chartRotation.target = state.chartRotation.value;
        state.chartRotation.velocity = 0;
      }
    }
    if (!state.assets.some((asset) => asset.pct > 0)) {
      layer.querySelectorAll('.assetPetal').forEach((group) => group.remove());
      state.petalNodes.clear();
      let empty = layer.querySelector('.pieEmptyState');
      if (!empty) {
        empty = svgElement(doc, 'text', { class: 'pieEmptyState', x: '180', y: '198' });
        empty.textContent = '尚未配置资产比例';
        layer.append(empty);
      }
      return;
    }
    layer.querySelector('.pieEmptyState')?.remove();
    const drawOrder = state.selectedId
      ? geometry.filter((item) => item.asset.id !== state.selectedId).concat(geometry.filter((item) => item.asset.id === state.selectedId))
      : geometry;
    const existing = [...layer.querySelectorAll('.assetPetal')].map((node) => ({ id: node.dataset.id, node }));
    const ordered = model.reconcileById(existing, drawOrder.map((item) => item.asset.id), (id) => ({ id, node: createPetalGroup(doc, stage, state, id) }));
    const activeIds = new Set(drawOrder.map((item) => item.asset.id));
    for (const item of drawOrder) {
      const group = ordered.find((entry) => entry.id === item.asset.id).node;
      updatePetalGroup(doc, group, item, state);
      cachePetalNodes(state, item.asset.id, group);
      layer.append(group);
      if (!state.selection.has(item.asset.id)) state.selection.set(item.asset.id, { value: 0, velocity: 0 });
    }
    for (const entry of existing) {
      if (!activeIds.has(entry.id)) {
        entry.node.remove();
        state.selection.delete(entry.id);
        state.petalNodes.delete(entry.id);
      }
    }
    applyBubbleField(stage, state, forceContours);
  }

  function cachePetalNodes(state, id, group) {
    const cached = state.petalNodes.get(id);
    if (cached?.group === group) {
      // updatePetalGroup replaces the live label when values change. Keep the
      // cached pointer current so its counter-rotation is applied after drag.
      cached.label = group.querySelector('.petalLabel');
      return;
    }
    state.petalNodes.set(id, {
      group,
      shapePaths: [
        group.querySelector('clipPath path'),
        group.querySelector('.petalDepthWall'),
        group.querySelector('.petalDepthTint'),
        group.querySelector('.petalTexture'),
        group.querySelector('.petalShade'),
        group.querySelector('.petalEdge'),
        group.querySelector('.petalHighlight'),
        group.querySelector('.petalHit'),
      ].filter(Boolean),
      depthWall: group.querySelector('.petalDepthWall'),
      depthTint: group.querySelector('.petalDepthTint'),
      label: group.querySelector('.petalLabel'),
      path: group.querySelector('.petalEdge')?.getAttribute('d') || '',
    });
  }

  function createPetalGroup(doc, stage, state, id) {
    const clipId = `petal-clip-${String(id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const group = svgElement(doc, 'g', { class: 'assetPetal', 'data-id': id, role: 'button', tabindex: '0' });
    const clipPath = svgElement(doc, 'clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
    clipPath.append(svgElement(doc, 'path'));
    const visual = svgElement(doc, 'g', { class: 'petalVisual' });
    visual.append(
      svgElement(doc, 'path', { class: 'petalTexture' }),
      svgElement(doc, 'path', { class: 'petalShade' }),
      svgElement(doc, 'path', { class: 'petalEdge' }),
      svgElement(doc, 'path', { class: 'petalHighlight' }),
    );
    group.append(
      clipPath,
      svgElement(doc, 'path', { class: 'petalDepthWall' }),
      svgElement(doc, 'path', { class: 'petalDepthTint' }),
      visual,
      svgElement(doc, 'path', { class: 'petalHit' }),
    );
    group.addEventListener('click', (event) => {
      event.stopPropagation();
      if (performance.now() < state.suppressClickUntil) return;
      const ratioControl = group.querySelector('.petalPctHit');
      const ratioRect = ratioControl?.getBoundingClientRect();
      const ratioPoint = ratioRect && event.clientX >= ratioRect.left && event.clientX <= ratioRect.right && event.clientY >= ratioRect.top && event.clientY <= ratioRect.bottom;
      if (event.target.closest('.petalPctHit') || ratioPoint) {
        const selectedId = group.dataset.id;
        if (state.selectedId !== selectedId) selectAsset(doc, stage, state, selectedId, { rotateToBottom: true, detailDelay: 80 });
        clearTimeout(state.inlineRatioTimer);
        state.inlineRatioTimer = setTimeout(() => openInlineRatioEditor(doc, stage, state, selectedId), state.reduceMotion ? 0 : 360);
        return;
      }
      const nextId = model.reduceSelection(state.selectedId, group.dataset.id);
      selectAsset(doc, stage, state, nextId, { rotateToBottom: Boolean(nextId) });
    });
    group.addEventListener('focus', () => { state.focusedAssetId = group.dataset.id; });
    group.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (event.target.closest('.petalPctHit')) {
        const selectedId = group.dataset.id;
        if (state.selectedId !== selectedId) selectAsset(doc, stage, state, selectedId, { rotateToBottom: true, detailDelay: 80 });
        clearTimeout(state.inlineRatioTimer);
        state.inlineRatioTimer = setTimeout(() => openInlineRatioEditor(doc, stage, state, selectedId), state.reduceMotion ? 0 : 360);
        return;
      }
      const nextId = model.reduceSelection(state.selectedId, group.dataset.id);
      selectAsset(doc, stage, state, nextId, { rotateToBottom: Boolean(nextId) });
    });
    return group;
  }

  function updatePetalGroup(doc, group, item, state) {
    const clipId = `petal-clip-${String(item.asset.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    group.classList.toggle('isSelected', item.asset.id === state.selectedId);
    group.setAttribute('aria-pressed', item.asset.id === state.selectedId ? 'true' : 'false');
    group.setAttribute('aria-label', `${item.asset.name}，${item.asset.pct}%，${formatMoney(item.asset.amount)}`);
    group.querySelector('.petalTexture').setAttribute('fill', `url(#texture-${item.asset.texture})`);
    group.querySelector('.petalDepthWall').setAttribute('fill', `url(#texture-${item.asset.texture})`);
    group.querySelector('.petalDepthTint').style.fill = DEPTH_TINTS[item.asset.texture] || DEPTH_TINTS.usd;
    group.style.setProperty('--petal-accent', DEPTH_TINTS[item.asset.texture] || DEPTH_TINTS.usd);
    const labelClip = svgElement(doc, 'g', { class: 'petalLabelClip', 'clip-path': `url(#${clipId})` });
    labelClip.append(buildLabel(doc, item, state));
    group.querySelector('.petalLabelClip')?.remove();
    group.insertBefore(labelClip, group.querySelector('.petalHit'));
    const ratioHit = labelClip.querySelector('.petalPctHit');
    const openRatio = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = item.asset.id;
      if (state.selectedId !== id) selectAsset(doc, stage, state, id, { rotateToBottom: true, detailDelay: 80 });
      clearTimeout(state.inlineRatioTimer);
      state.inlineRatioTimer = setTimeout(() => openInlineRatioEditor(doc, stage, state, id), state.reduceMotion ? 0 : 360);
    };
    ratioHit?.addEventListener('click', openRatio);
    ratioHit?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openRatio(event);
    });
  }

  function buildLabel(doc, item, state) {
    const degrees = item.span * 180 / Math.PI;
    const profile = model.referencePetalProfile(item.asset.name, item.span);
    const placement = model.referenceLabelPlacement(item.asset.name);
    const radius = profile.labelRadius;
    const anchor = point(180, 196, radius, item.mid);
    const useLockedPlacement = !item.sparse && Math.abs((Number(item.allocationTotal) || 0) - 100) < .01;
    const location = useLockedPlacement && placement ? placement : anchor;
    const transition = state.dataTransition;
    const fromCount = transition ? [...transition.fromById.values()].filter((asset) => asset.pct > 1e-6).length : 0;
    const toCount = transition ? [...transition.toById.values()].filter((asset) => asset.pct > 1e-6).length : 0;
    const layoutOpacity = transition && fromCount !== toCount ? model.transitionLabelOpacity(transition.clock ?? transition.raw) : 1;
    const group = svgElement(doc, 'g', {
      class: 'petalLabel',
      transform: `translate(${location.x} ${location.y})`,
      'data-label-x': String(location.x),
      'data-label-y': String(location.y),
      opacity: String((degrees <= 3 ? 0 : degrees < 8 ? (degrees - 3) / 5 : 1) * layoutOpacity),
    });
    const scale = useLockedPlacement && placement ? placement.scale : model.referenceLabelScale(item.asset.name, degrees);
    const compact = degrees <= 16;
    const medium = degrees > 16 && degrees <= 55;
    const codeY = compact ? -5 : medium ? -15 : -24;
    const pctY = compact ? 12 : medium ? 5 : -2;
    const amountY = medium ? 24 : 20;
    appendLabelText(doc, group, 'petalCode', item.asset.name, codeY, 17 * scale);
    const from = transition?.fromById.get(item.asset.id);
    const to = transition?.toById.get(item.asset.id);
    appendRollingText(doc, group, 'petalPct', `${trimNumber(item.asset.pct)}%`, from ? `${trimNumber(from.pct)}%` : null, to ? `${trimNumber(to.pct)}%` : null, pctY, 25 * scale, transition?.raw ?? 1, from && to && to.pct < from.pct ? -1 : 1);
    group.append(svgElement(doc, 'rect', {
      class: 'petalPctHit',
      'pointer-events': 'all',
      x: '-25',
      y: String(pctY - Math.max(13, 14 * scale)),
      width: '50',
      height: String(Math.max(25, 28 * scale)),
      rx: '12',
      role: 'button',
      tabindex: '0',
      'aria-label': `调整 ${item.asset.name} 的配置比例，当前 ${trimNumber(item.asset.pct)}%`,
    }));
    if (!compact) appendRollingText(doc, group, 'petalAmount', formatMoney(item.asset.amount), from ? formatMoney(from.amount) : null, to ? formatMoney(to.amount) : null, amountY, 15 * scale, transition?.raw ?? 1, from && to && to.amount < from.amount ? -1 : 1);
    if (degrees > 18) appendLabelText(doc, group, 'petalDesc', item.asset.desc, 38, 12.5 * scale);
    if (degrees > 34 && item.asset.shares) appendLabelText(doc, group, 'petalShares', `${item.asset.shares} 股`, 54, 11 * scale);
    return group;
  }

  function appendLabelText(doc, group, className, text, y, fontSize) {
    const node = svgElement(doc, 'text', { class: className, x: '0', y: String(y), 'font-size': String(Math.max(7.2, fontSize)) });
    node.textContent = text;
    group.append(node);
  }

  function appendRollingText(doc, group, className, currentText, fromText, toText, y, fontSize, progress, direction) {
    const size = Math.max(7.2, fontSize);
    if (!fromText || !toText || fromText === toText) {
      appendLabelText(doc, group, className, currentText, y, size);
      return;
    }
    const parts = [currentText, fromText, toText].map(splitNumericAffixes);
    const prefix = parts.find((part) => part.prefix)?.prefix || '';
    const suffix = parts.find((part) => part.suffix)?.suffix || '';
    const length = Math.max(...parts.map((part) => part.body.length));
    const current = parts[0].body.padStart(length, ' ');
    const from = parts[1].body.padStart(length, ' ');
    const to = parts[2].body.padStart(length, ' ');
    const width = size * .59;
    if (prefix) appendPositionedText(doc, group, className, prefix, y, size, -(length + 1) * width / 2);
    if (suffix) appendPositionedText(doc, group, className, suffix, y, size, (length + 1) * width / 2);
    for (let index = 0; index < length; index++) {
      if (current[index] === ' ') continue;
      const changedDigit = /\d/.test(current[index]) && from[index] !== to[index];
      const x = (index - (length - 1) / 2) * width;
      if (!changedDigit) {
        appendPositionedText(doc, group, className, current[index], y, size, x);
        continue;
      }
      const travel = size * .78;
      const incomingOffset = direction * (1 - progress) * travel;
      const outgoingOffset = -direction * progress * travel;
      if (from[index] && from[index] !== ' ') {
        appendPositionedText(doc, group, `${className} rollingOutgoing`, from[index], y + outgoingOffset, size, x, Math.max(0, 1 - progress * 1.34));
      }
      appendPositionedText(doc, group, `${className} rollingIncoming`, current[index], y + incomingOffset, size, x, Math.min(1, .18 + progress * 1.12));
    }
  }

  function splitNumericAffixes(text) {
    let body = String(text ?? '');
    let prefix = '';
    let suffix = '';
    if (body.startsWith('¥')) { prefix = '¥'; body = body.slice(1); }
    if (body.endsWith('%')) { suffix = '%'; body = body.slice(0, -1); }
    return { prefix, body, suffix };
  }

  function appendPositionedText(doc, group, className, text, y, fontSize, x, opacity = 1) {
    const node = svgElement(doc, 'text', {
      class: className,
      x: String(x),
      y: String(y),
      'font-size': String(fontSize),
      opacity: String(opacity),
    });
    node.textContent = text;
    group.append(node);
  }

  function trimNumber(value) {
    const number = Number(value) || 0;
    return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, '');
  }

  function circularDistance(a, b) {
    let delta = Math.abs(a - b) % (Math.PI * 2);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    return delta;
  }

  function signedCircularDelta(a, b) {
    let delta = (Number(a) || 0) - (Number(b) || 0);
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function applyBubbleField(stage, state, forceContours = false) {
    const cx = 180;
    const cy = 196;
    const now = performance.now();
    const rotationValue = state.chartRotation.value;
    const rotationActive = state.chartRotation.dragging
      || Math.abs(state.chartRotation.target - rotationValue) > .015
      || Math.abs(state.chartRotation.velocity) > .04;
    const motionActive = rotationActive || state.selectionAnimating;
    stage.querySelector('.assetPieViewport')?.classList.toggle('isRotating', state.compactMotion && motionActive);
    const refreshContours = forceContours
      || !state.compactMotion
      || (!(state.compactMotion && motionActive) && (!state.lastContourAt || now - state.lastContourAt >= 60));
    const svg = stage.querySelector('#assetPieSvg');
    const rotator = stage.querySelector('.pieRotator');
    if (state.compactMotion && !forceContours) {
      // Keep the textured chart as one cached compositor layer while a phone
      // gesture or spring is moving. Mutating an SVG <g> transform makes iOS
      // repaint every filtered texture; rotating the outer SVG stays on the
      // compositor and matches the desktop motion without dropping frames.
      if (svg) svg.style.transform = `translateZ(0) rotate(${rotationValue.toFixed(3)}deg)`;
      if (rotator?.hasAttribute('transform')) rotator.removeAttribute('transform');
    } else {
      // Commit once after compact motion settles so labels and geometry return
      // to their normal SVG coordinate system with no visible handoff jump.
      if (rotator) rotator.setAttribute('transform', `rotate(${rotationValue.toFixed(3)} ${cx} ${cy})`);
      if (svg) svg.style.transform = '';
    }
    const selectedGeometry = state.geometry.find((item) => item.asset.id === state.selectedId);
    const selectedStrength = selectedGeometry ? Math.max(0, state.selection.get(selectedGeometry.asset.id)?.value || 0) : 0;
    const selectedCenter = selectedGeometry ? point(cx, cy, 98, selectedGeometry.mid) : { x: cx, y: cy };
    for (const item of state.geometry) {
      const nodes = state.petalNodes.get(item.asset.id);
      if (!nodes) continue;
      const group = nodes.group;
      const own = Math.max(0, state.selection.get(item.asset.id)?.value || 0);
      const isSelected = Boolean(selectedGeometry && selectedGeometry.asset.id === item.asset.id);
      const centerDelta = selectedGeometry ? signedCircularDelta(item.mid, selectedGeometry.mid) : 0;
      const relative = selectedGeometry ? model.interactionEdgeDelta(centerDelta, item.span, selectedGeometry.span) : 0;
      const response = isSelected ? own : selectedStrength;
      const pose = state.reduceMotion
        ? { scaleRadial: 1, scaleTangent: 1, radial: 0, tangent: 0, attraction: 0, liftX: 0, liftY: isSelected ? -4 : 0 }
        : model.bubbleInteractionPose(relative, response, isSelected);
      const profile = model.referencePetalProfile(item.asset.name, item.span);
      const placement = model.referenceLabelPlacement(item.asset.name);
      const anchor = placement || point(cx, cy, profile.labelRadius, item.mid);
      const label = nodes.label;
      if (label && !(state.compactMotion && motionActive)) {
        const labelX = label.dataset.labelX;
        const labelY = label.dataset.labelY;
        label.setAttribute('transform', `translate(${labelX} ${labelY}) rotate(${(-rotationValue).toFixed(3)})`);
      }
      group.classList.toggle('isSelected', isSelected);
      // While the user or the settling spring rotates on a phone, keep the
      // seven petals as one GPU-composited surface. Per-petal path/transform
      // writes during this phase force Safari to repaint every texture layer.
      if (state.compactMotion && motionActive && !forceContours) continue;
      if (refreshContours || !nodes.path) {
        const innerMotion = model.innerSlidePose(relative, response, isSelected);
        const path = bubblePetalPath(cx, cy, profile.innerRadius, model.referenceOuterRadius(), item.start, item.end, model.repulsiveGapChannel(item.allocationTotal, response), profile.sideBend, isSelected ? own : 0, innerMotion, model.referenceInnerBoundary(item.asset.name), model.referenceInnerJoinRadius(item.asset.name, item.span));
        if (path !== nodes.path) {
          nodes.shapePaths.forEach((node) => {
            node.setAttribute('d', path);
            node.removeAttribute('transform');
          });
          nodes.path = path;
        }
      }
      const radialX = Math.cos(item.mid);
      const radialY = Math.sin(item.mid);
      const tangentX = -radialY;
      const tangentY = radialX;
      const selfCenter = point(cx, cy, 98, item.mid);
      const towardXRaw = selectedCenter.x - selfCenter.x;
      const towardYRaw = selectedCenter.y - selfCenter.y;
      const towardLength = Math.hypot(towardXRaw, towardYRaw) || 1;
      const towardX = isSelected ? 0 : towardXRaw / towardLength;
      const towardY = isSelected ? 0 : towardYRaw / towardLength;
      const base = profile.baseOffset;
      const tx = radialX * (base + pose.radial) + tangentX * pose.tangent + towardX * pose.attraction + pose.liftX;
      const ty = radialY * (base + pose.radial) + tangentY * pose.tangent + towardY * pose.attraction + pose.liftY;
      const pivot = { x: anchor.x, y: anchor.y };
      const localAngle = item.mid * 180 / Math.PI;
      const depth = model.selectedDepthPose(own, state.reduceMotion);
      const depthWall = nodes.depthWall;
      const depthTint = nodes.depthTint;
      // The face lifts straight upward in screen space.  Its backing remains
      // directly below it, so the exposed rim always reads as vertical depth
      // instead of a second petal sliding radially out of the pie.
      const wallX = 0;
      const wallY = depth.wallOffset;
      const lipX = 0;
      const lipY = depth.lipOffset;
      if (depthWall) {
        depthWall.setAttribute('transform', `translate(${wallX.toFixed(3)} ${wallY.toFixed(3)})`);
        depthWall.style.opacity = depth.wallOpacity.toFixed(3);
      }
      if (depthTint) {
        depthTint.setAttribute('transform', `translate(${lipX.toFixed(3)} ${lipY.toFixed(3)})`);
        depthTint.style.opacity = depth.lipOpacity.toFixed(3);
      }
      group.setAttribute('transform', `translate(${tx.toFixed(3)} ${ty.toFixed(3)}) translate(${pivot.x.toFixed(3)} ${pivot.y.toFixed(3)}) rotate(${localAngle.toFixed(3)}) scale(${pose.scaleRadial.toFixed(4)} ${pose.scaleTangent.toFixed(4)}) rotate(${(-localAngle).toFixed(3)}) translate(${(-pivot.x).toFixed(3)} ${(-pivot.y).toFixed(3)})`);
    }
    if (refreshContours) state.lastContourAt = now;
  }

  function installPieSwipe(doc, stage, state) {
    const viewport = stage.querySelector('.assetPieViewport');
    const svg = stage.querySelector('#assetPieSvg');
    viewport.addEventListener('pointerdown', (event) => {
      if (state.mode !== 'pie' || state.morphing || (event.button !== undefined && event.button !== 0)) return;
      const svgPoint = svg.createSVGPoint();
      svgPoint.x = 180;
      svgPoint.y = 196;
      const center = svgPoint.matrixTransform(svg.getScreenCTM());
      const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
      const startRadius = Math.hypot(event.clientX - center.x, event.clientY - center.y);
      state.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        center,
        lastAngle: startAngle,
        startRadius,
        accumulatedDegrees: 0,
        startSelectedId: state.selectedId,
        lastTime: performance.now(),
        startRotation: state.chartRotation.value,
        moved: false,
      };
      state.chartRotation.dragging = true;
    });
    viewport.addEventListener('pointermove', (event) => {
      const drag = state.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const now = performance.now();
      const dt = Math.max(8, now - drag.lastTime) / 1000;
      const radius = Math.hypot(event.clientX - drag.center.x, event.clientY - drag.center.y);
      const angle = Math.atan2(event.clientY - drag.center.y, event.clientX - drag.center.x);
      const angularDelta = normalizedAngleDelta(angle, drag.lastAngle) * 180 / Math.PI;
      const incrementalDegrees = drag.startRadius > 48 ? angularDelta : -(event.clientX - drag.lastX) * .34;
      drag.accumulatedDegrees += incrementalDegrees;
      const tangentialDistance = Math.abs(drag.accumulatedDegrees) * Math.PI / 180 * Math.max(48, drag.startRadius);
      const radialDistance = Math.abs(radius - drag.startRadius);
      if (!drag.moved && tangentialDistance > 8 && tangentialDistance > radialDistance * 1.05) drag.moved = true;
      if (model.shouldCaptureRotationPointer(drag.moved) && !viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
      drag.lastAngle = angle;
      drag.lastX = event.clientX;
      drag.lastTime = now;
      if (!drag.moved) return;
      event.preventDefault();
      state.chartRotation.value = drag.startRotation + drag.accumulatedDegrees;
      state.chartRotation.velocity = incrementalDegrees / dt;
      state.chartRotation.velocity = Math.max(-720, Math.min(720, state.chartRotation.velocity));
      scheduleCompactRotationFrame(stage, state);
      const bottomAsset = assetAtBottom(state);
      if (bottomAsset && bottomAsset.asset.id !== state.selectedId) {
        selectAsset(doc, stage, state, bottomAsset.asset.id, { preserveRotation: true, detailDelay: 70 });
      }
    }, { passive: false });
    const finish = (event, cancelled = false) => {
      const drag = state.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      state.drag = null;
      state.chartRotation.dragging = false;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (drag.moved) {
        state.suppressClickUntil = performance.now() + 420;
        let bottomAsset = assetAtBottom(state);
        const intentionalFlick = !cancelled && (Math.abs(drag.accumulatedDegrees) >= 8 || Math.abs(state.chartRotation.velocity) >= 130);
        if (intentionalFlick && bottomAsset?.asset.id === drag.startSelectedId) {
          selectAdjacentAsset(doc, stage, state, drag.accumulatedDegrees < 0 ? 1 : -1);
          return;
        }
        if (bottomAsset && bottomAsset.asset.id !== state.selectedId) selectAsset(doc, stage, state, bottomAsset.asset.id, { preserveRotation: true, detailDelay: 70 });
        bottomAsset = state.geometry.find((item) => item.asset.id === state.selectedId) || bottomAsset;
        state.chartRotation.target = bottomAsset
          ? model.rotationTargetFor(bottomAsset.mid, state.chartRotation.value)
          : model.nearestEquivalentAngle(0, state.chartRotation.value);
        startSelectionSpring(stage, state);
      } else startSelectionSpring(stage, state);
    };
    viewport.addEventListener('pointerup', (event) => finish(event));
    viewport.addEventListener('pointercancel', (event) => finish(event, true));
  }

  function scheduleCompactRotationFrame(stage, state) {
    if (!state.compactMotion) {
      applyBubbleField(stage, state);
      return;
    }
    if (state.rotationRaf) return;
    state.rotationRaf = requestAnimationFrame(() => {
      state.rotationRaf = 0;
      applyBubbleField(stage, state);
    });
  }

  function installDetailSwipe(doc, stage, state) {
    const detail = stage.querySelector('.assetPieDetail');
    let gesture = null;
    detail.addEventListener('pointerdown', (event) => {
      if (state.mode !== 'pie' || state.morphing || event.target.closest('input,select,button')) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, moved: false };
    });
    detail.addEventListener('pointermove', (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        gesture.moved = true;
        detail.setPointerCapture(event.pointerId);
      }
      if (!gesture.moved) return;
      event.preventDefault();
      gesture.lastX = event.clientX;
      detail.style.transform = `translateX(${Math.max(-28, Math.min(28, dx * .28)).toFixed(2)}px)`;
    }, { passive: false });
    const finish = (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const moved = gesture.moved;
      gesture = null;
      detail.style.transform = '';
      if (detail.hasPointerCapture(event.pointerId)) detail.releasePointerCapture(event.pointerId);
      if (!moved || Math.abs(dx) < 34) return;
      state.suppressClickUntil = performance.now() + 360;
      selectAdjacentAsset(doc, stage, state, dx < 0 ? 1 : -1);
    };
    detail.addEventListener('pointerup', finish);
    detail.addEventListener('pointercancel', finish);
  }

  function normalizedAngleDelta(current, previous) {
    let delta = current - previous;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function assetAtBottom(state) {
    const available = state.geometry.filter((item) => item.span > .006);
    if (!available.length) return null;
    const rotation = state.chartRotation.value * Math.PI / 180;
    return available.reduce((best, item) => (
      circularDistance(item.mid + rotation, Math.PI / 2) < circularDistance(best.mid + rotation, Math.PI / 2) ? item : best
    ), available[0]);
  }

  function selectAdjacentAsset(doc, stage, state, direction) {
    const available = state.geometry.filter((item) => item.span > .006);
    if (!available.length) return;
    let index = available.findIndex((item) => item.asset.id === state.selectedId);
    if (index < 0) {
      index = available.reduce((best, item, itemIndex) => {
        const visualMid = item.mid + state.chartRotation.value * Math.PI / 180;
        return circularDistance(visualMid, Math.PI / 2) < circularDistance(available[best].mid + state.chartRotation.value * Math.PI / 180, Math.PI / 2) ? itemIndex : best;
      }, 0);
    }
    const nextIndex = (index + (direction > 0 ? 1 : -1) + available.length) % available.length;
    selectAsset(doc, stage, state, available[nextIndex].asset.id, { rotateToBottom: true });
  }

  function selectAsset(doc, stage, state, id, options = {}) {
    clearTimeout(state.detailTimer);
    clearTimeout(state.inlineRatioTimer);
    const inlineEditor = stage.querySelector('.assetPieInlineRatio');
    if (!id || inlineEditor?.dataset.assetId !== id) inlineEditor?.remove();
    state.selectedId = id;
    stage.classList.toggle('hasSelection', Boolean(id));
    state.flowStartedAt = performance.now();
    const selectedGeometry = state.geometry.find((item) => item.asset.id === id);
    if (options.rotateToBottom) {
      state.chartRotation.target = selectedGeometry
        ? model.rotationTargetFor(selectedGeometry.mid, state.chartRotation.value)
        : model.nearestEquivalentAngle(0, state.chartRotation.value);
    }
    for (const group of stage.querySelectorAll('.assetPetal')) {
      group.setAttribute('aria-pressed', group.dataset.id === id ? 'true' : 'false');
    }
    if (id) {
      const selectedGroup = stage.querySelector(`.assetPetal[data-id="${CSS.escape(id)}"]`);
      if (selectedGroup) selectedGroup.parentNode.append(selectedGroup);
    }
    startSelectionSpring(stage, state);
    if (id) {
      const delay = state.reduceMotion ? 0 : (options.detailDelay ?? 105);
      state.detailTimer = setTimeout(() => {
        if (state.selectedId === id) renderDetail(doc, stage, state, id);
      }, delay);
    }
    else closeDetail(stage, state);
  }

  function openInlineRatioEditor(doc, stage, state, id) {
    if (state.mode !== 'pie' || state.morphing || state.selectedId !== id) return;
    const asset = state.assets.find((item) => item.id === id);
    const hit = stage.querySelector(`.assetPetal[data-id="${CSS.escape(id)}"] .petalPctHit`);
    const viewport = stage.querySelector('.assetPieViewport');
    if (!asset || !hit || !viewport) return;
    stage.querySelector('.assetPieInlineRatio')?.remove();
    const editor = doc.createElement('div');
    editor.className = 'assetPieInlineRatio';
    editor.dataset.assetId = id;
    editor.setAttribute('role', 'group');
    editor.setAttribute('aria-label', `调整 ${asset.name} 的配置比例`);
    const decrease = doc.createElement('button');
    decrease.type = 'button';
    decrease.textContent = '−';
    decrease.setAttribute('aria-label', '减少比例');
    const input = doc.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.1';
    input.inputMode = 'decimal';
    input.value = trimNumber(asset.pct);
    input.setAttribute('aria-label', `${asset.name} 配置比例`);
    const unit = doc.createElement('span');
    unit.className = 'ratioUnit';
    unit.textContent = '%';
    const increase = doc.createElement('button');
    increase.type = 'button';
    increase.textContent = '+';
    increase.setAttribute('aria-label', '增加比例');
    editor.append(decrease, input, unit, increase);
    viewport.append(editor);
    const hitRect = hit.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const left = Math.max(92, Math.min(viewportRect.width - 92, hitRect.left + hitRect.width / 2 - viewportRect.left));
    const top = Math.max(62, Math.min(viewportRect.height - 8, hitRect.top - viewportRect.top - 4));
    editor.style.left = `${left}px`;
    editor.style.top = `${top}px`;
    const commit = () => {
      const original = doc.querySelector(`#tbody tr[data-row-id="${CSS.escape(id)}"] .pctInput`);
      if (!original) return;
      const next = Math.max(0, parseNumber(input.value));
      input.value = trimNumber(next);
      original.value = trimNumber(next);
      original.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const step = (delta) => {
      input.value = trimNumber(Math.max(0, parseNumber(input.value) + delta));
      commit();
      input.focus({ preventScroll: true });
      input.select();
    };
    decrease.addEventListener('click', (event) => { event.stopPropagation(); step(-1); });
    increase.addEventListener('click', (event) => { event.stopPropagation(); step(1); });
    input.addEventListener('input', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        editor.remove();
        hit.focus({ preventScroll: true });
      } else if (event.key === 'Enter') {
        commit();
        editor.remove();
        hit.focus({ preventScroll: true });
      }
    });
    editor.animate(
      state.reduceMotion
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translate(-50%,-88%) scale(.88)' }, { opacity: 1, transform: 'translate(-50%,-100%) scale(1)' }],
      { duration: state.reduceMotion ? 100 : 260, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
    input.focus({ preventScroll: true });
    input.select();
  }

  function startSelectionSpring(stage, state) {
    if (state.selectionRaf) return;
    state.selectionAnimating = true;
    state.selectionLast = performance.now();
    const tick = (now) => {
      const dt = Math.min(.032, Math.max(.001, (now - state.selectionLast) / 1000));
      state.selectionLast = now;
      let moving = false;
      for (const [id, spring] of state.selection) {
        const target = id === state.selectedId ? 1 : 0;
        const k = state.selectedId ? model.MOTION.selectStiffness : model.MOTION.settleStiffness;
        const c = state.selectedId ? model.MOTION.selectDamping : model.MOTION.settleDamping;
        const mass = state.selectedId ? model.MOTION.selectMass : model.MOTION.settleMass;
        const acceleration = (k * (target - spring.value) - c * spring.velocity) / mass;
        spring.velocity += acceleration * dt;
        spring.value += spring.velocity * dt;
        spring.value = Math.max(-.16, Math.min(1.68, spring.value));
        if (Math.abs(spring.value - target) > .0007 || Math.abs(spring.velocity) > .005) moving = true;
        else { spring.value = target; spring.velocity = 0; }
      }
      const rotation = state.chartRotation;
      if (!rotation.dragging) {
        const acceleration = (model.MOTION.rotateStiffness * (rotation.target - rotation.value) - model.MOTION.rotateDamping * rotation.velocity) / model.MOTION.rotateMass;
        rotation.velocity += acceleration * dt;
        rotation.value += rotation.velocity * dt;
        rotation.velocity = Math.max(-720, Math.min(720, rotation.velocity));
        if (Math.abs(rotation.value - rotation.target) > .015 || Math.abs(rotation.velocity) > .04) moving = true;
        else { rotation.value = rotation.target; rotation.velocity = 0; }
      }
      applyBubbleField(stage, state);
      if (!state.reduceMotion && performance.now() - state.flowStartedAt < model.MOTION.fluidMs) moving = true;
      if (moving && !state.reduceMotion) state.selectionRaf = requestAnimationFrame(tick);
      else {
        if (state.reduceMotion) {
          for (const [id, spring] of state.selection) { spring.value = id === state.selectedId ? 1 : 0; spring.velocity = 0; }
          state.chartRotation.value = state.chartRotation.target;
          state.chartRotation.velocity = 0;
          applyBubbleField(stage, state);
        }
        state.selectionRaf = 0;
        state.selectionAnimating = false;
        if (state.compactMotion) applyBubbleField(stage, state, true);
      }
    };
    state.selectionRaf = requestAnimationFrame(tick);
  }

  function renderDetail(doc, stage, state, id) {
    const asset = state.assets.find((item) => item.id === id);
    const detail = stage.querySelector('.assetPieDetail');
    if (!asset) return;
    detail.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    const previousId = detail.dataset.assetId || '';
    const currentTable = detail.querySelector('table.detailCurrent') || detail.querySelector('table');
    const leaving = previousId && previousId !== id && currentTable ? currentTable.cloneNode(true) : null;
    const clone = asset.row.cloneNode(true);
    const table = doc.createElement('table');
    table.className = 'detailCurrent';
    const tbody = doc.createElement('tbody');
    tbody.append(clone);
    table.append(tbody);
    detail.replaceChildren(table);
    if (leaving) {
      leaving.className = 'detailLeaving';
      leaving.setAttribute('aria-hidden', 'true');
      detail.append(leaving);
    }
    detail.hidden = false;
    detail.dataset.assetId = id;
    const geometry = state.geometry.find((item) => item.asset.id === id);
    const selectedGroup = stage.querySelector(`.assetPetal[data-id="${CSS.escape(id)}"]`);
    const selectedRect = selectedGroup?.getBoundingClientRect();
    const detailRect = detail.getBoundingClientRect();
    const fallbackAnchor = geometry ? 50 + Math.cos(geometry.mid) * 32 : 50;
    const anchor = selectedRect && detailRect.width
      ? (selectedRect.left + selectedRect.width / 2 - detailRect.left) / detailRect.width * 100
      : fallbackAnchor;
    const boundedAnchor = Math.max(10, Math.min(90, anchor));
    detail.style.setProperty('--detail-anchor', `${boundedAnchor}%`);
    detail.style.transformOrigin = `${boundedAnchor}% 0`;
    detail.querySelectorAll('input,select,button').forEach((control) => {
      if (control.classList.contains('dragHandle') || control.classList.contains('assetSelectBtn')) return;
      control.addEventListener('input', () => syncDetailControl(doc, state, control));
      control.addEventListener('change', () => syncDetailControl(doc, state, control));
    });
    detail.onclick = (event) => {
      const button = event.target.closest('button');
      if (!button || button.classList.contains('dragHandle')) return;
      const identityClass = [...button.classList].find((name) => /Btn$|Toggle$/.test(name));
      if (!identityClass) return;
      const selector = `#tbody .${CSS.escape(identityClass)}[data-id="${CSS.escape(button.dataset.id || '')}"]`;
      const original = doc.querySelector(selector);
      if (!original) return;
      event.preventDefault();
      original.click();
      setTimeout(() => {
        const refreshed = readRows(doc);
        const freshAsset = refreshed.find((row) => row.id === id);
        if (freshAsset) {
          const index = state.assets.findIndex((row) => row.id === id);
          if (index >= 0) state.assets[index] = freshAsset;
          renderDetail(doc, stage, state, id);
        }
      }, 90);
    };
    if (!previousId) {
      detail.animate(
        state.reduceMotion
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
            { opacity: 0, transform: 'translateY(-28px) scale(.78,.34)' },
            { opacity: .82, transform: 'translateY(2px) scale(1.012,1.018)', offset: .72 },
            { opacity: 1, transform: 'none' },
          ],
        { duration: state.reduceMotion ? 130 : 440, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
    } else if (previousId !== id && leaving) {
      const oldIndex = state.ringOrder.indexOf(previousId);
      const nextIndex = state.ringOrder.indexOf(id);
      const direction = nextIndex >= oldIndex ? 1 : -1;
      const incoming = state.reduceMotion
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: `translateX(${direction * 18}px) scale(.985)` }, { opacity: 1, transform: 'none' }];
      const outgoing = state.reduceMotion
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-direction * 18}px) scale(.985)` }];
      table.animate(incoming, { duration: state.reduceMotion ? 120 : 310, easing: 'cubic-bezier(.22,1,.36,1)' });
      const leavingAnimation = leaving.animate(outgoing, { duration: state.reduceMotion ? 120 : 260, easing: 'cubic-bezier(.4,0,.2,1)' });
      leavingAnimation.onfinish = () => leaving.remove();
      leavingAnimation.oncancel = () => leaving.remove();
    }
  }

  function syncDetailControl(doc, state, control) {
    const className = [...control.classList].find((name) => /Input$|pctInput|sharesInput/.test(name));
    if (!className) return;
    const original = doc.querySelector(`#tbody .${CSS.escape(className)}[data-id="${CSS.escape(control.dataset.id || '')}"]`);
    if (!original) return;
    original.value = control.value;
    original.dispatchEvent(new Event('input', { bubbles: true }));
    if (control.matches('select')) original.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function readRows(doc) {
    return [...doc.querySelectorAll('#tbody tr[data-row-id]')].map((row) => ({
      id: row.dataset.rowId,
      name: row.querySelector('.assetName')?.textContent.trim() || row.dataset.rowId,
      pct: parseNumber(row.querySelector('.pctInput')?.value),
      amount: parseNumber(row.querySelector('.money')?.textContent || '0'),
      moneyText: row.querySelector('.money')?.textContent || '¥0',
      desc: row.querySelector('.desc')?.textContent.trim() || '',
      shares: row.querySelector('.sharesInput')?.value?.trim() || '',
      texture: row.classList.contains('goldAsset') ? 'gold' : row.classList.contains('hkdAsset') ? 'hkd' : row.classList.contains('cnyAsset') ? 'cny' : 'usd',
      row,
    }));
  }

  function orderAssetsByIds(assets, ids) {
    const map = new Map(assets.map((asset) => [asset.id, asset]));
    return ids.map((id) => map.get(id)).filter(Boolean).concat(assets.filter((asset) => !ids.includes(asset.id)));
  }

  function closeDetail(stage, state) {
    const detail = stage.querySelector('.assetPieDetail');
    if (detail.hidden) return;
    detail.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    const animation = detail.animate(
      state.reduceMotion ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-9px) scale(.98)' }],
      { duration: state.reduceMotion ? 110 : 230, easing: 'cubic-bezier(.4,0,.2,1)' },
    );
    animation.onfinish = () => {
      if (state.selectedId) return;
      detail.hidden = true;
      detail.replaceChildren();
      delete detail.dataset.assetId;
    };
  }

  function animateDataChange(doc, stage, state, targetAssets) {
    if (!stage || state.mode !== 'pie' || !Array.isArray(targetAssets)) return;
    const transitionAssets = model.reconcileAssetTransition(state.assets, targetAssets);
    const from = transitionAssets.from.map((asset) => ({ ...asset }));
    const to = transitionAssets.to.map((asset) => ({ ...asset }));
    const finalAssets = transitionAssets.final.map((asset) => ({ ...asset }));
    if (state.dataRaf) cancelAnimationFrame(state.dataRaf);
    const start = performance.now();
    const duration = state.reduceMotion ? 140 : model.MOTION.dataMs;
    const selected = state.selectedId;
    state.dataTransition = { fromById: new Map(from.map((asset) => [asset.id, asset])), toById: new Map(to.map((asset) => [asset.id, asset])), raw: 0, clock: 0 };
    const tick = (now) => {
      const raw = Math.min(1, (now - start) / duration);
      const progress = state.reduceMotion ? raw : cubicBezierProgress(raw, .22, 1, .36, 1);
      state.dataTransition.raw = progress;
      state.dataTransition.clock = raw;
      state.assets = from.map((asset, index) => ({
        ...asset,
        pct: asset.pct + (to[index].pct - asset.pct) * progress,
        amount: asset.amount + (to[index].amount - asset.amount) * progress,
        shares: progress < 1 ? asset.shares : to[index].shares,
      }));
      renderPie(doc, stage, state);
      state.selectedId = selected;
      updateSummary(doc, stage);
      if (raw < 1) state.dataRaf = requestAnimationFrame(tick);
      else {
        state.assets = finalAssets;
        state.dataTransition = null;
        if (selected && !finalAssets.some((asset) => asset.id === selected)) {
          state.selectedId = null;
          stage.classList.remove('hasSelection');
          closeDetail(stage, state);
        }
        renderPie(doc, stage, state, true);
        state.dataRaf = 0;
        if (state.selectedId) renderDetail(doc, stage, state, state.selectedId);
        const selectedAsset = finalAssets.find((asset) => asset.id === selected);
        if (selectedAsset) announce(doc, `${selectedAsset.name} 已更新为 ${trimNumber(selectedAsset.pct)}%，金额 ${formatMoney(selectedAsset.amount)}`);
      }
    };
    state.dataRaf = requestAnimationFrame(tick);
  }

  function cubicBezierProgress(x, x1, y1, x2, y2) {
    let t = x;
    for (let i = 0; i < 5; i++) {
      const omt = 1 - t;
      const estimate = 3 * omt * omt * t * x1 + 3 * omt * t * t * x2 + t * t * t;
      const derivative = 3 * omt * omt * x1 + 6 * omt * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(derivative) < 1e-5) break;
      t -= (estimate - x) / derivative;
      t = Math.max(0, Math.min(1, t));
    }
    const omt = 1 - t;
    return 3 * omt * omt * t * y1 + 3 * omt * t * t * y2 + t * t * t;
  }

  function announce(doc, text) {
    let live = doc.getElementById('assetPieLive');
    if (!live) {
      live = doc.createElement('div');
      live.id = 'assetPieLive';
      live.setAttribute('aria-live', 'polite');
      live.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
      doc.body.append(live);
    }
    live.textContent = text;
  }

  function samplePetalMorphShape(group, rect, pointCount = 56) {
    const path = group?.querySelector('.petalEdge');
    if (!path || !rect || rect.width <= 0 || rect.height <= 0 || typeof path.getTotalLength !== 'function') {
      const rounded = roundedProxyClip(pointCount, 0);
      return { petal: rounded, rounded };
    }
    const length = path.getTotalLength();
    const matrix = path.getScreenCTM();
    if (!length || !matrix) {
      const rounded = roundedProxyClip(pointCount, 0);
      return { petal: rounded, rounded };
    }
    const svg = path.ownerSVGElement;
    const points = Array.from({ length: pointCount }, (_, index) => {
      const local = path.getPointAtLength(length * index / pointCount);
      const svgPoint = svg.createSVGPoint();
      svgPoint.x = local.x;
      svgPoint.y = local.y;
      const screen = svgPoint.matrixTransform(matrix);
      return {
        x: Math.max(-3, Math.min(103, (screen.x - rect.left) / rect.width * 100)),
        y: Math.max(-3, Math.min(103, (screen.y - rect.top) / rect.height * 100)),
      };
    });
    const first = points[0];
    const startAngle = Math.atan2(first.y - 50, first.x - 50);
    return { petal: polygonClip(points), rounded: roundedProxyClip(pointCount, startAngle) };
  }

  function cacheCompactMorphClips(stage, state) {
    if (!state.compactMotion) return;
    for (const group of stage.querySelectorAll('.assetPetal')) {
      const edge = group.querySelector('.petalEdge');
      if (!edge?.getAttribute('d')) continue;
      const rect = edge.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      state.compactMorphClips.set(group.dataset.id, samplePetalMorphShape(group, rect, COMPACT_MORPH_POINTS));
    }
  }

  function roundedProxyClip(pointCount, startAngle) {
    const exponent = 4.6;
    const points = Array.from({ length: pointCount }, (_, index) => {
      const angle = startAngle + index / pointCount * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const normalizer = Math.pow(Math.pow(Math.abs(cosine), exponent) + Math.pow(Math.abs(sine), exponent), 1 / exponent) || 1;
      return { x: 50 + 49 * cosine / normalizer, y: 50 + 49 * sine / normalizer };
    });
    return polygonClip(points);
  }

  function polygonClip(points) {
    return `polygon(${points.map((point) => `${point.x.toFixed(3)}% ${point.y.toFixed(3)}%`).join(',')})`;
  }

  function interpolatePolygonClip(from, to, progress) {
    const read = (value) => [...String(value || '').matchAll(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
    const a = read(from);
    const b = read(to);
    if (!a.length || a.length !== b.length) return progress < .5 ? from : to;
    return polygonClip(a.map((point, index) => ({
      x: point.x + (b[index].x - point.x) * progress,
      y: point.y + (b[index].y - point.y) * progress,
    })));
  }

  function blendedMorphRect(start, center, target, weights, assetId, reverse = false) {
    const centerOf = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const startCenter = centerOf(start);
    const aggregateCenter = centerOf(center);
    const targetCenter = centerOf(target);
    const x = startCenter.x * weights.start + aggregateCenter.x * weights.center + targetCenter.x * weights.target;
    const y = startCenter.y * weights.start + aggregateCenter.y * weights.center + targetCenter.y * weights.target;
    const compactProgress = model.morphSizeProgress(weights, reverse);
    const width = weights.target > 0
      ? center.width + (target.width - center.width) * compactProgress
      : start.width + (center.width - start.width) * compactProgress;
    const height = weights.target > 0
      ? center.height + (target.height - center.height) * compactProgress
      : start.height + (center.height - start.height) * compactProgress;
    const rect = { left: x - width / 2, top: y - height / 2, width, height };
    const from = weights.target > 0 ? center : start;
    const to = weights.target > 0 ? target : center;
    const phase = weights.target > 0 ? weights.target : weights.center;
    const fromX = from.left + from.width / 2;
    const fromY = from.top + from.height / 2;
    const toX = to.left + to.width / 2;
    const toY = to.top + to.height / 2;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy) || 1;
    const seed = [...String(assetId)].reduce((hash, character) => (Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0), 2166136261) / 4294967295;
    const bend = (seed < .5 ? -1 : 1) * Math.min(18, 5 + length * .035) * Math.sin(Math.PI * phase);
    rect.left += -dy / length * bend;
    rect.top += dx / length * bend;
    return rect;
  }

  function continuousMorphFrames(base, start, center, target, assetId, roundedClip, petalClip, reverse = false) {
    return Array.from({ length: 61 }, (_, index) => {
      const progress = index / 60;
      const weights = model.continuousMorphWeights(progress);
      const rect = blendedMorphRect(start, center, target, weights, assetId, reverse);
      const petalWeight = reverse ? weights.start : weights.target;
      const opacity = progress < .96 ? 1 : 1 - (progress - .96) / .04;
      const radius = `${model.morphCornerPercent(weights, reverse).toFixed(3)}%`;
      return transformRectFrame(base, rect, opacity, radius, progress, interpolatePolygonClip(roundedClip, petalClip, petalWeight));
    });
  }

  function lightweightMorphFrames(base, start, center, target, assetId, roundedClip, petalClip, reverse = false) {
    return [0, .10, .20, .32, .46, .58, .68, .76, .84, .90, .96, 1].map((progress) => {
      const weights = model.continuousMorphWeights(progress);
      const rect = blendedMorphRect(start, center, target, weights, assetId, reverse);
      const shapeProgress = model.clamp01((progress - (reverse ? .46 : .54)) / (reverse ? .44 : .42));
      const easedShape = shapeProgress * shapeProgress * (3 - 2 * shapeProgress);
      const opacity = reverse
        ? (progress < .14 ? model.clamp01(progress / .14) : progress < .82 ? 1 : Math.max(0, 1 - (progress - .82) / .18))
        : (progress < .82 ? 1 : Math.max(0, 1 - (progress - .82) / .18));
      const clipPath = reverse
        ? interpolatePolygonClip(petalClip, roundedClip, easedShape)
        : interpolatePolygonClip(roundedClip, petalClip, easedShape);
      const frame = transformRectFrame(base, rect, opacity, '28%', progress, clipPath);
      delete frame.borderRadius;
      return frame;
    });
  }

  function lightweightIdentityFrames(reverse = false) {
    if (reverse) return [
      { opacity: 0 },
      { opacity: 0, offset: .20 },
      { opacity: 1, offset: .42 },
      { opacity: 1, offset: .86 },
      { opacity: 0, offset: 1 },
    ];
    return [
      { opacity: 1 },
      { opacity: 1, offset: .54 },
      { opacity: .35, offset: .68 },
      { opacity: 0, offset: .78 },
      { opacity: 0 },
    ];
  }

  function lightweightVanishFrames(base, start, center, assetId) {
    return [0, .18, .36, .50, .62, .74, 1].map((progress) => {
      const gather = model.clamp01(progress / .58);
      const eased = gather * gather * (3 - 2 * gather);
      const rect = curvedIntermediateRect(start, center, eased, assetId, 1);
      const opacity = progress < .46 ? 1 : Math.max(0, 1 - (progress - .46) / .24);
      return transformRectFrame(base, rect, opacity, '28%', progress, roundedProxyClip(COMPACT_MORPH_POINTS, 0));
    });
  }

  async function morphToPieCompact(doc, stage, tableWrap, toggle, state, refresh) {
    state.morphing = true;
    if (state.reduceMotion) {
      if (state.dataDirty || !state.assets.length) refresh();
      stage.hidden = false;
      doc.body.classList.add('assetPieMode');
      state.mode = 'pie';
      state.morphing = false;
      toggle.setAttribute('aria-pressed', 'true');
      toggle.setAttribute('aria-label', '切换回资产卡片视图');
      return;
    }
    doc.body.classList.add('assetPieBusy', 'assetPieMorphingIn');
    if (state.dataDirty || !state.assets.length) refresh();
    const rows = [...doc.querySelectorAll('#tbody tr[data-row-id]')];
    const rowRects = new Map(rows.map((row) => [row.dataset.rowId, row.getBoundingClientRect()]));
    stage.hidden = false;
    stage.style.opacity = '0';
    const targetShapes = new Map([...stage.querySelectorAll('.assetPetal')].map((group) => {
      const edge = group.querySelector('.petalEdge');
      if (!edge?.getAttribute('d')) return [group.dataset.id, null];
      const rect = edge.getBoundingClientRect();
      const clip = state.compactMorphClips.get(group.dataset.id) || samplePetalMorphShape(group, rect, COMPACT_MORPH_POINTS);
      return [group.dataset.id, { rect, clip }];
    }));
    const chartRect = stage.querySelector('#assetPieSvg')?.getBoundingClientRect();
    const aggregateRect = centerAggregateRect(chartRect);
    const proxies = createLightweightProxies(doc, state.assets, rowRects, rowRects);
    const duration = state.reduceMotion ? 140 : model.MOTION.viewMorphMs;
    const petals = [...stage.querySelectorAll('.assetPetal')];
    petals.forEach((petal) => { petal.style.opacity = '0'; });
    tableWrap.style.opacity = '0';
    const animations = proxies.map((proxy, index) => {
      const targetShape = targetShapes.get(proxy.dataset.id);
      const start = rowRects.get(proxy.dataset.id);
      if (!start) return null;
      if (!targetShape) return proxy.animate(
        lightweightVanishFrames(proxyBaseRect(proxy), start, aggregateRect, proxy.dataset.id),
        { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' },
      );
      return proxy.animate(
        lightweightMorphFrames(proxyBaseRect(proxy), start, aggregateRect, targetShape.rect, proxy.dataset.id, targetShape.clip.rounded, targetShape.clip.petal),
        { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' },
      );
    }).filter(Boolean);
    const identityAnimations = proxies.map((proxy, index) => proxy.querySelector('.assetMorphIdentity')?.animate(
      lightweightIdentityFrames(false),
      { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' },
    )).filter(Boolean);
    const petalAnimations = petals.map((petal, index) => petal.animate([
      { opacity: 0 },
      { opacity: 0, offset: .82 },
      { opacity: .38, offset: .90 },
      { opacity: 1, offset: 1 },
    ], { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' }));
    const stageAnimation = stage.animate([
      { opacity: 0 },
      { opacity: .42, offset: .28 },
      { opacity: 1, offset: .52 },
      { opacity: 1 },
    ], { duration, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    await Promise.allSettled([...animations, ...identityAnimations, ...petalAnimations, stageAnimation].map((animation) => animation.finished));
    proxies.forEach((proxy) => proxy.remove());
    stageAnimation.cancel();
    stage.style.opacity = '';
    petals.forEach((petal) => { petal.style.opacity = ''; });
    petalAnimations.forEach((animation) => animation.cancel());
    identityAnimations.forEach((animation) => animation.cancel());
    doc.body.classList.add('assetPieMode');
    tableWrap.style.opacity = '';
    state.mode = 'pie';
    state.morphing = false;
    doc.body.classList.remove('assetPieBusy', 'assetPieMorphingIn');
    toggle.setAttribute('aria-pressed', 'true');
    toggle.setAttribute('aria-label', '切换回资产卡片视图');
  }

  async function morphToCardsCompact(doc, stage, tableWrap, toggle, state) {
    state.morphing = true;
    if (state.reduceMotion) {
      clearTimeout(state.detailTimer);
      if (state.selectionRaf) cancelAnimationFrame(state.selectionRaf);
      state.selectionRaf = 0;
      doc.body.classList.remove('assetPieMode');
      stage.hidden = true;
      state.mode = 'cards';
      state.morphing = false;
      state.selectedId = null;
      state.chartRotation.value = 0;
      state.chartRotation.target = 0;
      state.chartRotation.velocity = 0;
      stage.classList.remove('hasSelection');
      for (const spring of state.selection.values()) { spring.value = 0; spring.velocity = 0; }
      closeDetail(stage, state);
      toggle.setAttribute('aria-pressed', 'false');
      toggle.setAttribute('aria-label', '切换为资产配置饼状图');
      return;
    }
    doc.body.classList.add('assetPieBusy', 'assetPieMorphingOut');
    const stageRect = stage.getBoundingClientRect();
    const sourceShapes = new Map([...stage.querySelectorAll('.assetPetal')].map((group) => {
      const rect = group.querySelector('.petalEdge')?.getBoundingClientRect() || group.getBoundingClientRect();
      const clip = state.compactMorphClips.get(group.dataset.id) || samplePetalMorphShape(group, rect, COMPACT_MORPH_POINTS);
      return [group.dataset.id, { rect, clip }];
    }));
    clearTimeout(state.detailTimer);
    if (state.selectionRaf) cancelAnimationFrame(state.selectionRaf);
    state.selectionRaf = 0;
    state.selectedId = null;
    closeDetail(stage, state);
    stage.classList.remove('hasSelection');
    Object.assign(stage.style, {
      position: 'fixed',
      left: `${stageRect.left}px`,
      top: `${stageRect.top}px`,
      width: `${stageRect.width}px`,
      height: `${stageRect.height}px`,
      margin: '0',
      zIndex: '2147482000',
      pointerEvents: 'none',
    });
    doc.body.classList.remove('assetPieMode');
    tableWrap.style.opacity = '0';
    const rows = [...doc.querySelectorAll('#tbody tr[data-row-id]')];
    const targetRects = new Map(rows.map((row) => [row.dataset.rowId, row.getBoundingClientRect()]));
    const assets = orderAssetsByIds(readRows(doc), state.ringOrder);
    const chartRect = stage.querySelector('#assetPieSvg')?.getBoundingClientRect();
    const aggregateRect = centerAggregateRect(chartRect);
    const sourceRects = new Map([...sourceShapes].map(([id, shape]) => [id, shape.rect]));
    const proxies = createLightweightProxies(doc, assets, sourceRects, targetRects);
    const duration = state.reduceMotion ? 140 : model.MOTION.viewMorphMs;
    const animations = proxies.map((proxy, index) => {
      const sourceShape = sourceShapes.get(proxy.dataset.id);
      const target = targetRects.get(proxy.dataset.id);
      if (!sourceShape || !target) return null;
      return proxy.animate(
        lightweightMorphFrames(proxyBaseRect(proxy), sourceShape.rect, aggregateRect, target, proxy.dataset.id, sourceShape.clip.rounded, sourceShape.clip.petal, true),
        { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' },
      );
    }).filter(Boolean);
    const identityAnimations = proxies.map((proxy, index) => proxy.querySelector('.assetMorphIdentity')?.animate(
      lightweightIdentityFrames(true),
      { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' },
    )).filter(Boolean);
    const petals = [...stage.querySelectorAll('.assetPetal')];
    const petalAnimations = petals.map((petal, index) => petal.animate([
      { opacity: 1 },
      { opacity: .45, offset: .10 },
      { opacity: 0, offset: .20 },
      { opacity: 0 },
    ], { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' }));
    const stageAnimation = stage.animate([
      { opacity: 1 },
      { opacity: 1, offset: .38 },
      { opacity: .28, offset: .58 },
      { opacity: 0 },
    ], { duration, easing: 'linear', fill: 'forwards' });
    const tableAnimation = tableWrap.animate([
      { opacity: 0 },
      { opacity: 0, offset: .70 },
      { opacity: .18, offset: .79 },
      { opacity: .62, offset: .91 },
      { opacity: 1 },
    ], { duration, easing: 'linear', fill: 'forwards' });
    await Promise.allSettled([...animations, ...identityAnimations, ...petalAnimations, stageAnimation, tableAnimation].map((animation) => animation.finished));
    proxies.forEach((proxy) => proxy.remove());
    stageAnimation.cancel();
    tableAnimation.cancel();
    tableWrap.style.opacity = '';
    stage.hidden = true;
    for (const property of ['position', 'left', 'top', 'width', 'height', 'margin', 'zIndex', 'pointerEvents']) {
      stage.style[property] = '';
    }
    petalAnimations.forEach((animation) => animation.cancel());
    identityAnimations.forEach((animation) => animation.cancel());
    state.mode = 'cards';
    state.morphing = false;
    state.selectedId = null;
    state.chartRotation.value = 0;
    state.chartRotation.target = 0;
    state.chartRotation.velocity = 0;
    stage.classList.remove('hasSelection');
    for (const spring of state.selection.values()) { spring.value = 0; spring.velocity = 0; }
    closeDetail(stage, state);
    doc.body.classList.remove('assetPieBusy', 'assetPieMorphingOut');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', '切换为资产配置饼状图');
  }

  async function morphToPie(doc, win, stage, tableWrap, toggle, state, refresh) {
    if (state.compactMotion) return morphToPieCompact(doc, stage, tableWrap, toggle, state, refresh);
    state.morphing = true;
    doc.body.classList.add('assetPieBusy', 'assetPieMorphingIn');
    refresh();
    const rows = [...doc.querySelectorAll('#tbody tr[data-row-id]')];
    const rowRects = new Map(rows.map((row) => [row.dataset.rowId, row.getBoundingClientRect()]));
    stage.hidden = false;
    stage.style.opacity = '0';
    const targetShapes = new Map([...stage.querySelectorAll('.assetPetal')].map((group) => {
      const rect = group.querySelector('.petalEdge')?.getBoundingClientRect() || group.getBoundingClientRect();
      return [group.dataset.id, { rect, clip: samplePetalMorphShape(group, rect) }];
    }));
    const largestId = model.largestAssetId(state.assets);
    const chartRect = stage.querySelector('#assetPieSvg')?.getBoundingClientRect();
    const aggregateRect = centerAggregateRect(chartRect);
    const proxies = createProxies(doc, state.assets, rowRects, rowRects);
    const duration = state.reduceMotion ? 140 : model.MOTION.viewMorphMs;
    const animations = [];
    const contentAnimations = [];
    const petalAnimations = [];
    const petals = [...stage.querySelectorAll('.assetPetal')];
    petals.forEach((petal) => { petal.style.opacity = '0'; });
    tableWrap.style.opacity = '0';
    for (const [index, proxy] of proxies.entries()) {
      const targetShape = targetShapes.get(proxy.dataset.id);
      const target = targetShape?.rect;
      const start = rowRects.get(proxy.dataset.id);
      if (!target || !start) continue;
      const base = proxyBaseRect(proxy);
      proxy.style.zIndex = String(2147483001 + (proxy.dataset.id === largestId ? 30 : index));
      animations.push(proxy.animate(
        continuousMorphFrames(base, start, aggregateRect, target, proxy.dataset.id, targetShape.clip.rounded, targetShape.clip.petal),
        { duration, delay: state.reduceMotion ? 0 : index * 4, easing: 'linear', fill: 'forwards' },
      ));
      const tableContent = proxy.querySelector('.assetMorphProxyTable');
      const identity = proxy.querySelector('.assetMorphIdentity');
      contentAnimations.push(tableContent.animate([
        { opacity: 1 },
        { opacity: .18, offset: .13 },
        { opacity: 0, offset: .19 },
        { opacity: 0 },
      ], { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' }));
      contentAnimations.push(identity.animate([
        { opacity: 0 },
        { opacity: 0, offset: .58 },
        { opacity: .48, offset: .68 },
        { opacity: 1, offset: .79 },
        { opacity: 1 },
      ], { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' }));
      const petal = stage.querySelector(`.assetPetal[data-id="${CSS.escape(proxy.dataset.id)}"]`);
      if (petal) petalAnimations.push(petal.animate([
        { opacity: 0 },
        { opacity: 0, offset: .91 },
        { opacity: .54, offset: .96 },
        { opacity: 1 },
      ], { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' }));
    }
    const stageAnimation = stage.animate([{ opacity: 0 }, { opacity: .38, offset: .28 }, { opacity: 1, offset: .54 }, { opacity: 1 }], { duration, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
    await Promise.allSettled([...animations, ...contentAnimations, ...petalAnimations, stageAnimation].map((animation) => animation.finished));
    proxies.forEach((proxy) => proxy.remove());
    stageAnimation.cancel();
    stage.style.opacity = '';
    petals.forEach((petal) => { petal.style.opacity = ''; });
    doc.body.classList.add('assetPieMode');
    tableWrap.style.opacity = '';
    doc.body.classList.remove('assetPieBusy', 'assetPieMorphingIn');
    state.mode = 'pie';
    state.morphing = false;
    toggle.setAttribute('aria-pressed', 'true');
    toggle.setAttribute('aria-label', '切换回资产卡片视图');
  }

  async function morphToCards(doc, win, stage, tableWrap, toggle, state) {
    if (state.compactMotion) return morphToCardsCompact(doc, stage, tableWrap, toggle, state);
    state.morphing = true;
    doc.body.classList.add('assetPieBusy', 'assetPieMorphingOut');
    const sourceShapes = new Map([...stage.querySelectorAll('.assetPetal')].map((group) => {
      const rect = group.querySelector('.petalEdge')?.getBoundingClientRect() || group.getBoundingClientRect();
      return [group.dataset.id, { rect, clip: samplePetalMorphShape(group, rect) }];
    }));
    clearTimeout(state.detailTimer);
    state.selectedId = null;
    closeDetail(stage, state);
    stage.classList.remove('hasSelection');
    const sourceRects = new Map([...sourceShapes].map(([id, shape]) => [id, shape.rect]));
    doc.body.classList.remove('assetPieMode');
    tableWrap.style.opacity = '0';
    const rows = [...doc.querySelectorAll('#tbody tr[data-row-id]')];
    const targetRects = new Map(rows.map((row) => [row.dataset.rowId, row.getBoundingClientRect()]));
    tableWrap.style.visibility = 'hidden';
    const assets = orderAssetsByIds(readRows(doc), state.ringOrder);
    const largestId = model.largestAssetId(assets);
    const chartRect = stage.querySelector('#assetPieSvg')?.getBoundingClientRect();
    const aggregateRect = centerAggregateRect(chartRect);
    const proxies = createProxies(doc, assets, sourceRects, targetRects);
    const duration = state.reduceMotion ? 140 : model.MOTION.viewMorphMs;
    const animations = [];
    const contentAnimations = [];
    const petalAnimations = [];
    for (const [index, proxy] of proxies.entries()) {
      const start = sourceRects.get(proxy.dataset.id);
      const sourceShape = sourceShapes.get(proxy.dataset.id);
      const target = targetRects.get(proxy.dataset.id);
      if (!start || !target || !sourceShape) continue;
      const base = proxyBaseRect(proxy);
      proxy.style.zIndex = String(2147483001 + (proxy.dataset.id === largestId ? 30 : index));
      animations.push(proxy.animate(
        continuousMorphFrames(base, start, aggregateRect, target, proxy.dataset.id, sourceShape.clip.rounded, sourceShape.clip.petal, true),
        { duration, delay: state.reduceMotion ? 0 : index * 4, easing: 'linear', fill: 'forwards' },
      ));
      const tableContent = proxy.querySelector('.assetMorphProxyTable');
      const identity = proxy.querySelector('.assetMorphIdentity');
      contentAnimations.push(tableContent.animate([
        { opacity: 0 },
        { opacity: 0, offset: .58 },
        { opacity: .18, offset: .68 },
        { opacity: .65, offset: .82 },
        { opacity: 1, offset: .94 },
        { opacity: 1 },
      ], { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' }));
      contentAnimations.push(identity.animate([
        { opacity: 1 },
        { opacity: 1, offset: .58 },
        { opacity: .65, offset: .70 },
        { opacity: .15, offset: .82 },
        { opacity: 0, offset: .92 },
        { opacity: 0 },
      ], { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' }));
      const petal = stage.querySelector(`.assetPetal[data-id="${CSS.escape(proxy.dataset.id)}"]`);
      if (petal) petalAnimations.push(petal.animate([
        { opacity: 1 },
        { opacity: .5, offset: .03 },
        { opacity: 0, offset: .06 },
        { opacity: 0 },
      ], { duration, delay: state.reduceMotion ? 0 : index * 2, easing: 'linear', fill: 'forwards' }));
    }
    const stageAnimation = stage.animate([{ opacity: 1 }, { opacity: 1, offset: .38 }, { opacity: .28, offset: .58 }, { opacity: 0 }], { duration, easing: 'linear', fill: 'forwards' });
    const tableAnimation = tableWrap.animate([{ opacity: 0 }, { opacity: 0, offset: .96 }, { opacity: .5, offset: .985 }, { opacity: 1 }], { duration, easing: 'linear', fill: 'forwards' });
    await Promise.allSettled([...animations, ...contentAnimations, ...petalAnimations, stageAnimation, tableAnimation].map((animation) => animation.finished));
    proxies.forEach((proxy) => proxy.remove());
    stageAnimation.cancel();
    tableAnimation.cancel();
    tableWrap.style.visibility = '';
    tableWrap.style.opacity = '';
    stage.hidden = true;
    state.mode = 'cards';
    state.morphing = false;
    state.selectedId = null;
    state.chartRotation.value = 0;
    state.chartRotation.target = 0;
    state.chartRotation.velocity = 0;
    stage.classList.remove('hasSelection');
    for (const spring of state.selection.values()) { spring.value = 0; spring.velocity = 0; }
    closeDetail(stage, state);
    doc.body.classList.remove('assetPieBusy', 'assetPieMorphingOut');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', '切换为资产配置饼状图');
  }

  function createProxies(doc, assets, rects, baseRects = rects) {
    return assets.map((asset) => {
      const rect = rects.get(asset.id);
      const base = baseRects.get(asset.id) || rect;
      if (!rect || !base) return null;
      const proxy = doc.createElement('div');
      proxy.className = 'assetMorphProxy';
      proxy.dataset.id = asset.id;
      proxy.dataset.baseWidth = String(Math.max(2, base.width));
      proxy.dataset.baseHeight = String(Math.max(2, base.height));
      proxy.style.cssText = `width:${Math.max(2, base.width)}px;height:${Math.max(2, base.height)}px;border-radius:14px`;
      proxy.style.backgroundImage = `linear-gradient(rgba(5,11,17,.54),rgba(5,11,17,.72)),url("${TEXTURES[asset.texture] || TEXTURES.usd}")`;
      proxy.setAttribute('aria-hidden', 'true');
      const table = doc.createElement('table');
      table.className = 'assetMorphProxyTable';
      const body = doc.createElement('tbody');
      const card = asset.row.cloneNode(true);
      card.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      card.querySelectorAll('input,button,select,a,[tabindex]').forEach((node) => node.setAttribute('tabindex', '-1'));
      body.append(card);
      table.append(body);
      const identity = doc.createElement('div');
      identity.className = 'assetMorphIdentity';
      const code = doc.createElement('strong');
      code.textContent = asset.name;
      const percentage = doc.createElement('span');
      percentage.textContent = `${trimNumber(asset.pct)}%`;
      const amount = doc.createElement('small');
      amount.textContent = formatMoney(asset.amount);
      identity.append(code, percentage, amount);
      proxy.append(table, identity);
      doc.body.append(proxy);
      return proxy;
    }).filter(Boolean);
  }

  function createLightweightProxies(doc, assets, rects, baseRects = rects) {
    return assets.map((asset) => {
      const rect = rects.get(asset.id);
      const base = baseRects.get(asset.id) || rect;
      if (!rect || !base) return null;
      // Keep the raster surface near the aggregate-bubble size. The proxy can
      // still match a full card through compositor scaling, without asking the
      // browser to repaint seven full-card texture layers during every morph.
      const rasterWidth = 104;
      const rasterHeight = 104;
      const proxy = doc.createElement('div');
      proxy.className = 'assetMorphProxy isLightweight';
      proxy.dataset.id = asset.id;
      proxy.dataset.baseWidth = String(rasterWidth);
      proxy.dataset.baseHeight = String(rasterHeight);
      proxy.style.cssText = `width:${rasterWidth}px;height:${rasterHeight}px;border-radius:28%`;
      proxy.style.backgroundImage = `linear-gradient(rgba(5,11,17,.54),rgba(5,11,17,.72)),url("${TEXTURES[asset.texture] || TEXTURES.usd}")`;
      proxy.setAttribute('aria-hidden', 'true');
      const identity = doc.createElement('div');
      identity.className = 'assetMorphIdentity';
      const code = doc.createElement('strong');
      code.textContent = asset.name;
      const percentage = doc.createElement('span');
      percentage.textContent = `${trimNumber(asset.pct)}%`;
      const amount = doc.createElement('small');
      amount.textContent = formatMoney(asset.amount);
      identity.append(code, percentage, amount);
      proxy.append(identity);
      doc.body.append(proxy);
      return proxy;
    }).filter(Boolean);
  }

  function proxyBaseRect(proxy) {
    return {
      width: Math.max(2, Number(proxy.dataset.baseWidth) || 2),
      height: Math.max(2, Number(proxy.dataset.baseHeight) || 2),
    };
  }

  function transformRectFrame(base, rect, opacity, borderRadius, offset, clipPath) {
    const scaleX = Math.max(.001, rect.width / base.width);
    const scaleY = Math.max(.001, rect.height / base.height);
    const frame = {
      opacity,
      borderRadius,
      transform: `translate3d(${rect.left.toFixed(3)}px,${rect.top.toFixed(3)}px,0) scale(${scaleX.toFixed(5)},${scaleY.toFixed(5)})`,
    };
    if (offset !== undefined) frame.offset = offset;
    if (clipPath) frame.clipPath = clipPath;
    return frame;
  }

  function centerAggregateRect(chartRect) {
    const rect = chartRect || { left: innerWidth / 2 - 52, top: 165, width: 104, height: 104 };
    const size = Math.max(88, Math.min(108, rect.width * .27));
    const centerX = rect.left + rect.width * .5;
    const centerY = rect.top + rect.height * (196 / 430);
    return { left: centerX - size / 2, top: centerY - size / 2, width: size, height: size };
  }

  function compactRectAt(rect, size) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + Math.min(rect.height * .5, 82);
    return { left: centerX - size / 2, top: centerY - size / 2, width: size, height: size };
  }

  function intermediateRect(from, to, progress) {
    const mix = (a, b) => a + (b - a) * progress;
    return { left: mix(from.left, to.left, progress), top: mix(from.top, to.top, progress), width: mix(from.width, to.width, progress), height: mix(from.height, to.height, progress) };
  }

  function curvedIntermediateRect(from, to, progress, assetId, direction) {
    const rect = intermediateRect(from, to, progress);
    const fromX = from.left + from.width / 2;
    const fromY = from.top + from.height / 2;
    const toX = to.left + to.width / 2;
    const toY = to.top + to.height / 2;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.hypot(dx, dy) || 1;
    const seed = [...String(assetId)].reduce((hash, character) => (Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0), 2166136261) / 4294967295;
    const sign = seed < .5 ? -1 : 1;
    const amplitude = Math.min(24, 8 + distance * .045) * Math.sin(Math.PI * progress) * sign * direction;
    rect.left += -dy / distance * amplitude;
    rect.top += dx / distance * amplitude;
    return rect;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAssetPieView, { once: true });
  } else {
    bootAssetPieView();
  }
})();
