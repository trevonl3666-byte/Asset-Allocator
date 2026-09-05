(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AssetPieMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LOCKED_MOTION_SOURCES = Object.freeze(['VIDEO2', 'VIDEO3', 'VIDEO4']);
  const MOTION = Object.freeze({
    viewMorphMs: 980,
    dataMs: 620,
    fluidMs: 620,
    dataEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    selectStiffness: 350,
    selectDamping: 26,
    selectMass: 0.8,
    settleStiffness: 290,
    settleDamping: 28,
    settleMass: 0.82,
    rotateStiffness: 330,
    rotateDamping: 28,
    rotateMass: 0.84,
  });

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function softResponse(angularDistance) {
    const distance = Math.max(0, Number(angularDistance) || 0);
    return Math.exp(-0.92 * distance * distance);
  }

  function softGapChannel(response) {
    const t = clamp01(response);
    const smooth = t * t * (3 - 2 * t);
    // Selection must never consume the visible channel between neighboring
    // petals.  The extra angular clearance is shared by every path while the
    // chosen face lifts vertically.
    return 1 + 0.19 * smooth;
  }

  function repulsiveGapChannel(totalPercentage, response = 0) {
    const overAllocation = Math.max(0, (Number(totalPercentage) || 0) - 100);
    const pressure = Math.min(.35, overAllocation / 200);
    return softGapChannel(response) * (1 + pressure);
  }

  function reduceSelection(currentAssetId, pressedAssetId) {
    return currentAssetId === pressedAssetId ? null : pressedAssetId;
  }

  function hashUnit(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 10000) / 10000;
  }

  function transientFlow(assetId, ageMs, response = 1) {
    const duration = 560;
    const age = Math.max(0, Number(ageMs) || 0);
    if (age >= duration || response <= 0) return { radial: 0, tangent: 0, rotation: 0, envelope: 0 };
    const t = age / duration;
    const envelope = (1 - t) * (1 - t) * Math.max(0, Number(response) || 0);
    const seed = hashUnit(assetId);
    const phase = seed * Math.PI * 2;
    const pulse = Math.sin(t * Math.PI * 2.15 + phase);
    const counterPulse = Math.cos(t * Math.PI * 1.72 + phase * .73);
    return {
      radial: pulse * 3 * envelope,
      tangent: counterPulse * 1.4 * envelope,
      rotation: (pulse * .42 + counterPulse * .24) * envelope,
      envelope,
    };
  }

  function selectionPose(spanRadians, ownResponse, neighborResponse) {
    const span = Math.max(0, Number(spanRadians) || 0);
    const own = Math.max(0, Math.min(1.08, Number(ownResponse) || 0));
    const field = clamp01(neighborResponse);
    const boundaryProjection = Math.max(.08, Math.sin(Math.min(Math.PI / 2, span / 2)));
    const safeTravelLimit = Math.min(18, 5.4 / boundaryProjection);
    const selectedTravel = safeTravelLimit * own;
    const scaleResponse = Math.min(1, .28 / boundaryProjection);
    const scale = Math.min(1.045, 1 + .035 * scaleResponse * Math.min(1, own) + .002 * field);
    return { boundaryProjection, safeTravelLimit, selectedTravel, scale };
  }

  function nearestEquivalentAngle(targetDegrees, currentDegrees) {
    const target = Number(targetDegrees) || 0;
    const current = Number(currentDegrees) || 0;
    return target + Math.round((current - target) / 360) * 360;
  }

  function rotationTargetFor(midpointRadians, currentDegrees) {
    const midpointDegrees = (Number(midpointRadians) || 0) * 180 / Math.PI;
    return nearestEquivalentAngle(90 - midpointDegrees, currentDegrees);
  }

  function geometryPercentages(values) {
    const raw = values.map((value) => Math.max(0, Number(value) || 0));
    const total = raw.reduce((sum, value) => sum + value, 0);
    if (total <= 100) return { raw, visible: raw.slice(), vacancy: 100 - total, total };
    return {
      raw,
      visible: raw.map((value) => value / total * 100),
      vacancy: 0,
      total,
    };
  }

  function petalVisualPercentages(values) {
    const rawGeometry = geometryPercentages(values);
    const occupied = Math.min(100, rawGeometry.total);
    const weights = rawGeometry.raw.map((value) => value > 0 ? Math.pow(value, .62) : 0);
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const visible = weightTotal > 0
      ? weights.map((value) => value / weightTotal * occupied)
      : weights;
    return {
      raw: rawGeometry.raw,
      visible,
      vacancy: 100 - occupied,
      total: rawGeometry.total,
    };
  }

  function petalLayout(values) {
    const visual = petalVisualPercentages(values);
    const activeIndices = visual.raw.map((value, index) => value > 1e-6 ? index : -1).filter((index) => index >= 0);
    const activeCount = activeIndices.length;
    const startAngle = referenceStartAngleDegrees() * Math.PI / 180;
    if (!activeCount) return visual.raw.map(() => ({ start: startAngle, end: startAngle, mid: startAngle, span: 0, sparse: true, allocationTotal: visual.total }));
    if (activeCount >= 5) {
      let cursor = startAngle;
      return visual.visible.map((percentage) => {
        const span = percentage / 100 * Math.PI * 2;
        const start = cursor;
        const end = cursor + span;
        cursor = end;
        return { start, end, mid: start + span / 2, span, sparse: false, allocationTotal: visual.total };
      });
    }
    const slot = Math.PI * 2 / activeCount;
    const firstMid = activeCount === 4 ? -Math.PI * .75 : -Math.PI / 2;
    const activeWeights = activeIndices.map((index) => Math.pow(visual.raw[index], .62));
    const largestWeight = Math.max(...activeWeights, 1e-6);
    const activeRank = new Map(activeIndices.map((index, rank) => [index, rank]));
    return visual.raw.map((value, index) => {
      if (value <= 1e-6) return { start: firstMid, end: firstMid, mid: firstMid, span: 0, sparse: true, allocationTotal: visual.total };
      const rank = activeRank.get(index);
      const mid = firstMid + rank * slot;
      const relativeWeight = Math.sqrt(activeWeights[rank] / largestWeight);
      const fullness = activeCount === 1 ? .78 : .68 + .22 * relativeWeight;
      const span = slot * Math.min(.90, fullness);
      return { start: mid - span / 2, end: mid + span / 2, mid, span, sparse: true, allocationTotal: visual.total };
    });
  }

  function shortestAngleDelta(from, to) {
    let delta = (Number(to) || 0) - (Number(from) || 0);
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function transitionPetalLayout(fromValues, toValues, progress) {
    const t = clamp01(progress);
    const from = petalLayout(fromValues);
    const to = petalLayout(toValues);
    if (t === 0) return from;
    if (t === 1) return to;
    const fromCount = from.filter((item) => item.span > 0).length;
    const toCount = to.filter((item) => item.span > 0).length;
    if (fromCount === toCount) return petalLayout(interpolateAmounts(fromValues, toValues, t));
    const shrink = smoothStep(t / .46);
    const move = smoothStep((t - .48) / .28);
    const grow = smoothStep((t - .74) / .26);
    const targetActive = to.map((item, index) => item.span > 0 ? index : -1).filter((index) => index >= 0);
    const alignedTargetMids = to.map((item) => item.mid);
    if (targetActive.length) {
      const firstIndex = targetActive[0];
      const firstTarget = to[firstIndex].mid;
      const firstSource = from[firstIndex].span > 0 ? from[firstIndex].mid : firstTarget;
      const alignedFirst = firstTarget + Math.round((firstSource - firstTarget) / (Math.PI * 2)) * Math.PI * 2;
      for (const index of targetActive) alignedTargetMids[index] = alignedFirst + (to[index].mid - firstTarget);
    }
    return from.map((fromItem, index) => {
      const toItem = to[index] || fromItem;
      const survives = fromItem.span > 0 && toItem.span > 0;
      const fromMid = fromItem.span > 0 ? fromItem.mid : toItem.mid;
      const toMid = toItem.span > 0 ? alignedTargetMids[index] : fromMid;
      const mid = fromMid + (toMid - fromMid) * move;
      let span;
      if (survives) {
        const contracted = Math.min(fromItem.span, toItem.span) * .58;
        const shrinking = fromItem.span + (contracted - fromItem.span) * shrink;
        span = shrinking + (toItem.span - shrinking) * grow;
      } else if (fromItem.span > 0) {
        span = fromItem.span * (1 - smoothStep(t / .48));
      } else {
        span = toItem.span * smoothStep((t - .76) / .24);
      }
      return {
        start: mid - span / 2,
        end: mid + span / 2,
        mid,
        span,
        sparse: fromItem.sparse || toItem.sparse,
        allocationTotal: fromItem.allocationTotal + (toItem.allocationTotal - fromItem.allocationTotal) * t,
      };
    });
  }

  function transitionLabelOpacity(progress) {
    const t = clamp01(progress);
    if (t <= .34) return 1 - smoothStep(t / .34);
    if (t < .72) return 0;
    return smoothStep((t - .72) / .28);
  }

  function petalBodyProfile(spanRadians) {
    const degrees = Math.max(0, Number(spanRadians) || 0) * 180 / Math.PI;
    const raw = Math.max(0, Math.min(1, (degrees - 10) / 50));
    const fullness = raw * raw * (3 - 2 * raw);
    const innerRadius = 32 - 14 * fullness;
    const outerRaw = Math.max(0, Math.min(1, (degrees - 10) / 80));
    const outerFullness = outerRaw * outerRaw * (3 - 2 * outerRaw);
    const outerRadius = 151 + 11 * outerFullness;
    const labelRadius = innerRadius + (outerRadius - innerRadius) * (degrees < 18 ? .64 : degrees < 42 ? .58 : .55);
    return {
      innerRadius,
      outerRadius,
      labelRadius,
      sideBend: .009 + .013 * (1 - fullness),
    };
  }

  const REFERENCE_OUTER_RADIUS = 158;
  const REFERENCE_PETAL_PROFILES = Object.freeze({
    VOO: Object.freeze({ innerRadius: 22, labelFactor: .62 }),
    SCHD: Object.freeze({ innerRadius: 25, labelFactor: .83 }),
    '512890': Object.freeze({ innerRadius: 24, labelFactor: .70 }),
    '03032': Object.freeze({ innerRadius: 25, labelFactor: .80 }),
    '159361': Object.freeze({ innerRadius: 23, labelFactor: .69 }),
    SGOL: Object.freeze({ innerRadius: 22, labelFactor: .65 }),
    QQQ: Object.freeze({ innerRadius: 22, labelFactor: .63 }),
  });

  const REFERENCE_LABEL_PLACEMENTS = Object.freeze({
    QQQ: Object.freeze({ x: 126, y: 94, scale: .84 }),
    VOO: Object.freeze({ x: 246, y: 166, scale: 1 }),
    SGOL: Object.freeze({ x: 76, y: 158, scale: .9 }),
    '159361': Object.freeze({ x: 84, y: 245, scale: .62 }),
    '03032': Object.freeze({ x: 107, y: 286, scale: .45 }),
    '512890': Object.freeze({ x: 177, y: 306, scale: .58 }),
    SCHD: Object.freeze({ x: 239, y: 302, scale: .47 }),
  });

  function referenceLabelPlacement(assetName) {
    const label = REFERENCE_LABEL_PLACEMENTS[String(assetName || '').toUpperCase()];
    return label ? { ...label } : null;
  }

  function referencePetalProfile(assetName, spanRadians) {
    const fallback = petalBodyProfile(spanRadians);
    const preset = REFERENCE_PETAL_PROFILES[String(assetName || '').toUpperCase()];
    if (!preset) return { ...fallback, outerRadius: REFERENCE_OUTER_RADIUS, baseOffset: 0 };
    const degrees = Math.max(0, Number(spanRadians) || 0) * 180 / Math.PI;
    const tinyPetal = smoothStep((22 - degrees) / 10);
    const innerRadius = preset.innerRadius + 40 * tinyPetal;
    return {
      innerRadius,
      outerRadius: REFERENCE_OUTER_RADIUS,
      baseOffset: 0,
      labelRadius: innerRadius + (REFERENCE_OUTER_RADIUS - innerRadius) * preset.labelFactor,
      sideBend: fallback.sideBend,
    };
  }

  function referenceOuterRadius() {
    return REFERENCE_OUTER_RADIUS;
  }

  function referenceInnerBoundary(assetName) {
    return String(assetName || '').toUpperCase() === 'VOO' ? 'organic' : 'bubble';
  }

  function referenceInnerJoinRadius(assetName, spanRadians) {
    if (String(assetName || '').toUpperCase() !== 'VOO') return 14.5;
    const degrees = Math.max(0, Number(spanRadians) || 0) * 180 / Math.PI;
    return 20 + 7 * smoothStep((degrees - 85) / 105);
  }

  function referenceStartAngleDegrees() {
    return -90;
  }

  function referenceLabelScale(assetName, degrees) {
    const span = Math.max(0, Number(degrees) || 0);
    const base = span > 120 ? 1 : span > 55 ? .9 : span > 28 ? .84 : span > 16 ? .62 : .5;
    if (/^\d{5,}$/.test(String(assetName || ''))) return span > 28 ? .70 : .45;
    if (span <= 28) return .46;
    return base;
  }

  function innerClosureProfile(spanRadians, innerRadius) {
    const radius = Math.max(1, Number(innerRadius) || 1);
    return { mode: 'flat-cap', capRadius: radius };
  }

  function referenceInnerCornerAngle(spanRadians, cornerRadius, innerRadius) {
    const span = Math.max(.004, Number(spanRadians) || 0);
    const corner = Math.max(0, Number(cornerRadius) || 0);
    const radius = Math.max(1, Number(innerRadius) || 1);
    return Math.min(corner / radius, span * .06, .045);
  }

  function referenceInnerCapHalfWidth(spanRadians, innerRadius, selectedResponse = 0) {
    const span = Math.max(0, Number(spanRadians) || 0);
    const radius = Math.max(1, Number(innerRadius) || 1);
    const natural = radius * Math.sin(Math.min(Math.PI / 2, span / 2));
    const selected = Math.max(0, Math.min(1, Number(selectedResponse) || 0));
    return Math.min(12, Math.max(6.5, natural) + 2.4 * selected);
  }

  function referenceInnerCapDepth(spanRadians, innerRadius, selectedResponse = 0) {
    const halfWidth = referenceInnerCapHalfWidth(spanRadians, innerRadius, selectedResponse);
    const selected = Math.max(0, Math.min(1, Number(selectedResponse) || 0));
    return Math.min(10, Math.max(4, halfWidth * .72) + selected * 1.35);
  }

  function referenceBubbleNoseProfile(spanRadians, innerRadius, selectedResponse = 0) {
    const radius = Math.max(1, Number(innerRadius) || 1);
    const span = Math.max(0, Number(spanRadians) || 0);
    const selected = Math.max(0, Math.min(1, Number(selectedResponse) || 0));
    const natural = radius * Math.sin(Math.min(Math.PI / 2, span / 2));
    const halfWidth = Math.min(14, Math.max(9.5, natural + 5.2) + 2.7 * selected);
    const shoulderRadius = radius + Math.max(5.5, halfWidth * .58);
    const noseRadius = shoulderRadius - Math.min(4, 2.4 + halfWidth * .08);
    return { halfWidth, shoulderRadius, noseRadius, flare: 0 };
  }

  function identityHandoff(progress) {
    const value = clamp01(progress);
    if (value <= .92) return { proxy: 1, live: 0 };
    if (value >= 1) return { proxy: 0, live: 1 };
    const t = (value - .92) / .08;
    const smooth = t * t * (3 - 2 * t);
    return { proxy: 1 - smooth, live: smooth };
  }

  function smoothStep(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
  }

  function viewMorphTimeline(progress) {
    const value = clamp01(progress);
    const aggregate = smoothStep(value / .42);
    const unfold = smoothStep((value - .42) / .50);
    const handoff = identityHandoff(value);
    return { aggregate, unfold, proxy: handoff.proxy, live: handoff.live };
  }

  function continuousMorphWeights(progress) {
    const value = clamp01(progress);
    const centerPoint = .46;
    const smoother = (input) => {
      const t = clamp01(input);
      return t * t * t * (t * (t * 6 - 15) + 10);
    };
    if (value <= centerPoint) {
      const center = smoother(value / centerPoint);
      return { start: 1 - center, center, target: 0 };
    }
    const target = smoother((value - centerPoint) / (1 - centerPoint));
    return { start: 0, center: 1 - target, target };
  }

  function morphSizeProgress(weights, reverse = false) {
    const center = clamp01(weights?.center);
    const target = clamp01(weights?.target);
    if (target > 0) return reverse ? Math.pow(target, 1.4) : target;
    return 1 - Math.pow(1 - center, 2.2);
  }

  function morphCornerPercent(weights, reverse = false) {
    const start = clamp01(weights?.start);
    const target = clamp01(weights?.target);
    if (reverse) return target > 0 ? 50 - 46 * target : 50 - 28 * start;
    return target > 0 ? 50 - 28 * target : 4 + 46 * clamp01(weights?.center);
  }

  function largestAssetId(assets) {
    let selected = null;
    let largest = Number.NEGATIVE_INFINITY;
    for (const asset of Array.isArray(assets) ? assets : []) {
      const value = Math.max(0, Number(asset?.pct) || 0);
      if (value > largest) {
        selected = asset?.id ?? null;
        largest = value;
      }
    }
    return selected;
  }

  function aggregationSlots(hubRect, orderedIds, largestId) {
    const rect = hubRect || { left: 0, top: 0, width: 0, height: 0 };
    const centerX = (Number(rect.left) || 0) + (Number(rect.width) || 0) / 2;
    const centerY = (Number(rect.top) || 0) + (Number(rect.height) || 0) / 2;
    const ids = Array.isArray(orderedIds) ? orderedIds.slice() : [];
    const outer = ids.filter((id) => id !== largestId);
    const slots = [];
    if (ids.includes(largestId)) slots.push({ id: largestId, left: centerX - 21, top: centerY - 21, width: 42, height: 42 });
    outer.forEach((id, index) => {
      const ringIndex = Math.floor(index / 8);
      const ringItems = Math.min(8, outer.length - ringIndex * 8);
      const withinRing = index % 8;
      const radius = 58 + ringIndex * 42;
      const angle = -Math.PI / 2 + withinRing / ringItems * Math.PI * 2;
      const size = ringIndex === 0 ? 32 : 28;
      slots.push({
        id,
        left: centerX + Math.cos(angle) * radius - size / 2,
        top: centerY + Math.sin(angle) * radius - size / 2,
        width: size,
        height: size,
      });
    });
    return ids.map((id) => slots.find((slot) => slot.id === id)).filter(Boolean);
  }

  function centeredTokenRect(rect, size = 36) {
    const source = rect || { left: 0, top: 0, width: 0, height: 0 };
    const tokenSize = Math.max(24, Math.min(48, Number(size) || 36));
    const centerX = (Number(source.left) || 0) + (Number(source.width) || 0) / 2;
    const centerY = (Number(source.top) || 0) + (Number(source.height) || 0) / 2;
    return {
      left: centerX - tokenSize / 2,
      top: centerY - tokenSize / 2,
      width: tokenSize,
      height: tokenSize,
    };
  }

  function selectedDepthPose(ownResponse, reduceMotion) {
    const own = Math.max(0, Math.min(1.08, Number(ownResponse) || 0));
    const highlight = Math.min(1, own);
    const flat = { thickness: 0, opacity: 0, highlight, faceLift: 0, lipOffset: 0, wallOffset: 0, lipOpacity: 0, wallOpacity: 0 };
    if (reduceMotion || !own) return flat;
    const restrained = own <= 1 ? own : 1 + (own - 1) * .5;
    return {
      thickness: 9.8 * restrained,
      opacity: .92 * highlight,
      highlight,
      faceLift: -4.6 * restrained,
      lipOffset: 6.2 * restrained,
      wallOffset: 9.4 * restrained,
      lipOpacity: .6 * highlight,
      wallOpacity: .88 * highlight,
    };
  }

  function bubbleInteractionPose(relativeAngle, response = 1, selected = false) {
    const strength = Math.max(0, Math.min(1.08, Number(response) || 0));
    if (selected) {
      return {
        scaleRadial: 1,
        scaleTangent: 1,
        radial: 0,
        tangent: 0,
        attraction: 0,
        liftX: 0,
        liftY: -4.6 * strength,
      };
    }
    return {
      scaleRadial: 1,
      scaleTangent: 1,
      radial: 0,
      tangent: 0,
      attraction: 0,
      liftX: 0,
      liftY: 0,
    };
  }

  function innerSlidePose(relativeAngle, response = 1, selected = false) {
    const strength = clamp01(response);
    if (!strength) return { angle: 0, radius: 0 };
    if (selected) return { angle: 0, radius: -3.2 * strength };
    let signed = Number(relativeAngle) || 0;
    while (signed > Math.PI) signed -= Math.PI * 2;
    while (signed < -Math.PI) signed += Math.PI * 2;
    const near = Math.exp(-.72 * signed * signed);
    return {
      angle: Math.sign(signed) * .032 * near * strength,
      radius: -3.8 * near * strength,
    };
  }

  function interactionEdgeDelta(centerDelta, spanA, spanB) {
    const signed = Number(centerDelta) || 0;
    if (Math.abs(signed) < 1e-6) return 0;
    const clearance = Math.max(0, Math.abs(signed) - (Math.max(0, Number(spanA) || 0) + Math.max(0, Number(spanB) || 0)) / 2);
    return Math.sign(signed) * Math.max(.008, clearance);
  }

  function bubbleSplitTimeline(progress) {
    const value = clamp01(progress);
    if (value === 0) return { cards: 1, mother: 0, children: 0, petals: 0 };
    if (value === 1) return { cards: 0, mother: 0, children: 0, petals: 1 };
    const cards = 1 - smoothStep(value / .36);
    const motherIn = smoothStep(value / .28);
    const motherOut = 1 - smoothStep((value - .58) / .34);
    const mother = motherIn * motherOut;
    const childIn = smoothStep((value - .42) / .14);
    const childOut = 1 - smoothStep((value - .86) / .14);
    const children = childIn * childOut;
    const petals = smoothStep((value - .86) / .14);
    return { cards, mother, children, petals };
  }

  function interpolateAmounts(from, to, progress) {
    const t = clamp01(progress);
    return from.map((value, index) => {
      const start = Number(value) || 0;
      const end = Number(to[index]) || 0;
      return start + (end - start) * t;
    });
  }

  function reconcileAssetTransition(currentAssets, targetAssets) {
    const current = Array.isArray(currentAssets) ? currentAssets : [];
    const target = Array.isArray(targetAssets) ? targetAssets : [];
    const currentById = new Map(current.map((asset) => [asset.id, asset]));
    const targetById = new Map(target.map((asset) => [asset.id, asset]));
    const ids = current.map((asset) => asset.id);
    for (const asset of target) if (!currentById.has(asset.id)) ids.push(asset.id);
    const zeroed = (asset) => ({ ...asset, pct: 0, amount: 0, shares: '' });
    return {
      from: ids.map((id) => currentById.get(id) || zeroed(targetById.get(id))),
      to: ids.map((id) => targetById.get(id) || zeroed(currentById.get(id))),
      final: target.slice(),
    };
  }

  function reconcileById(existingItems, orderedIds, createItem) {
    const existingById = new Map((existingItems || []).map((item) => [item.id, item]));
    return (orderedIds || []).map((id) => existingById.get(id) || createItem(id));
  }

  function observeAvailableNode(ObserverClass, preferredNode, fallbackNode, callback) {
    const node = preferredNode || fallbackNode;
    if (!ObserverClass || !node) return null;
    const observer = new ObserverClass(callback);
    observer.observe(node, { childList: true, subtree: true });
    return observer;
  }

  function shouldCaptureRotationPointer(hasCrossedDragThreshold) {
    return hasCrossedDragThreshold === true;
  }

  function selectionInflation(ownResponse) {
    const own = Math.max(0, Math.min(1.08, Number(ownResponse) || 0));
    return {
      uniform: 6 * own,
      localized: 1.1 * own,
      inner: .55 * own,
    };
  }

  function coherentFluidField(relativeAngle, ageMs, response = 1) {
    const duration = MOTION.fluidMs;
    const age = Math.max(0, Number(ageMs) || 0);
    const strength = Math.max(0, Math.min(1.08, Number(response) || 0));
    if (age >= duration || strength <= 0) return { radial: 0, tangent: 0, contour: 0, inner: 0, phase: 0, envelope: 0 };
    let signed = Number(relativeAngle) || 0;
    while (signed > Math.PI) signed -= Math.PI * 2;
    while (signed < -Math.PI) signed += Math.PI * 2;
    const distance = Math.abs(signed);
    const t = age / duration;
    const pulse = Math.sin(Math.PI * t);
    const influence = .18 + .82 * softResponse(distance);
    const envelope = pulse * influence * strength;
    return {
      radial: 2.75 * Math.sin(Math.PI * t * 1.35) * (1 - .35 * t) * influence * strength,
      tangent: Math.sign(signed) * 1.9 * pulse * (1 - t) * influence * strength,
      contour: 3.15 * envelope,
      inner: 1.15 * Math.sin(Math.PI * t * 1.15) * influence * strength,
      phase: signed * .42 + t * Math.PI * .82,
      envelope,
    };
  }

  return {
    LOCKED_MOTION_SOURCES,
    MOTION,
    clamp01,
    softResponse,
    softGapChannel,
    repulsiveGapChannel,
    reduceSelection,
    transientFlow,
    selectionPose,
    nearestEquivalentAngle,
    rotationTargetFor,
    geometryPercentages,
    petalVisualPercentages,
    petalLayout,
    transitionPetalLayout,
    transitionLabelOpacity,
    petalBodyProfile,
    referencePetalProfile,
    referenceOuterRadius,
    referenceInnerBoundary,
    referenceInnerJoinRadius,
    referenceLabelPlacement,
    referenceStartAngleDegrees,
    referenceLabelScale,
    innerClosureProfile,
    referenceInnerCornerAngle,
    referenceInnerCapHalfWidth,
    referenceInnerCapDepth,
    referenceBubbleNoseProfile,
    identityHandoff,
    viewMorphTimeline,
    continuousMorphWeights,
    morphSizeProgress,
    morphCornerPercent,
    largestAssetId,
    aggregationSlots,
    centeredTokenRect,
    selectedDepthPose,
    bubbleInteractionPose,
    innerSlidePose,
    interactionEdgeDelta,
    bubbleSplitTimeline,
    interpolateAmounts,
    reconcileAssetTransition,
    reconcileById,
    observeAvailableNode,
    shouldCaptureRotationPointer,
    selectionInflation,
    coherentFluidField,
  };
});
