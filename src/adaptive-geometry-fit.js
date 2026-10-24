import * as THREE from 'three';
import {HUMANOID_TEMPLATE,moveJointWorld} from './autorig.js';
import {analyzeBodyGeometry,sampleGeometry} from './bodyfit.js';
// Geometry analysis contributed by Z.ai and adapted for Animation Studio.
// Isolated experiment for fitted JOINTS, not a skinning/weight algorithm.
// Limit geometry sampling for 4GB Android devices.
function quantile(data,q){
  if(!data?.length)return 0;
  const a=Array.from(data).sort((x,y)=>x-y);
  const f=Math.max(0,Math.min(1,q))*(a.length-1);
  const lo=Math.floor(f),hi=Math.ceil(f);
  return lo===hi?a[lo]:a[lo]*(hi-f)+a[hi]*(f-lo);
}
function wwTemplatePosition(e, t) {
  const n = t.height, i = t.bounds, r = t.lateralAxis, o = t.lateralCenter,
    a = t.depthAxis, c = t.coreDepth, l = t.forwardSign, u = t.span;
  const g = new THREE.Vector3;
  g[r] = o + e.lateral * u * (a === "x" ? -l : l);
  g.y = i.min.y + n * e.y;
  g[a] = c + e.forward * n * .035 * l;
  /Foot|ToeBase/.test(e.name) && (g[a] += .042 * n * l);
  /Head|Neck/.test(e.name) && (g[a] += .015 * n * l);
  /Hand/.test(e.name) && (g[a] += .015 * n * l);
  return g;
}
function wwStats(e, t, n) {
  const i = e.map(e => e[t]).sort((e, t) => e - t), r = e.map(e => e[n]).sort((e, t) => e - t);
  return { n: e.length, xs: i, pts: e, x: e => quantile(i, e), z: e => quantile(r, e) };
}
function wwGap(e, t, n, i) {
  const r = Math.max(1, Math.floor(e.length * t)), o = Math.min(e.length - 2, Math.ceil(e.length * n));
  let l = -1, c = 0;
  for (let a = r; a <= o; a++) { const f = e[a + 1] - e[a]; f > c && (c = f, l = a); }
  return l < 0 || c < i ? null : { from: e[l], to: e[l + 1], width: c, mid: (e[l] + e[l + 1]) * .5 };
}
function wwMean(e, r, a) {
  if (!e || !e.length) return null;
  let t = 0, n = 0, i = 0;
  for (const p of e) { t += p[r]; n += p.y; i += p[a]; }
  return { x: t / e.length, y: n / e.length, z: i / e.length };
}
function wwAnalyzeBody(e, t) {
  const n = e.height, i = e.bounds.min.y, r = e.lateralAxis, a = e.depthAxis,
    l = e.forwardSign, o = e.lateralCenter, c = e.coreDepth;
  const d = 90, f = [];
  for (let k = 0; k < d; k++) f.push([]);
  for (let v = 0; v < t.length; v++) {
    const p = t[v];
    let k = Math.floor((p.y - i) / n * d);
    k = k < 0 ? 0 : k >= d ? d - 1 : k;
    f[k].push(p);
  }
  const rowY = k => i + (k + .5) / d * n;
  const st = [];
  for (let k = 0; k < d; k++) st.push(f[k].length >= 8 ? wwStats(f[k], r, a) : null);
  const res = { crotchY: null, gapX: null, neckY: null, legs: { left: { found: !1 }, right: { found: !1 } }, arms: { left: { found: !1 }, right: { found: !1 } }, gapRows: [] };
  const sides = [["left", 1], ["right", -1]];
  const gapMin = n * .02;
  // ---- шея: самое узкое сечение в верхней зоне ----
  {
    let neckK = -1, neckA = Infinity;
    const areas = [];
    for (let k = Math.floor(d * .72); k < Math.floor(d * .94); k++) {
      const S = st[k];
      if (!S) continue;
      const a2 = (S.x(.98) - S.x(.02)) * (S.z(.98) - S.z(.02));
      areas.push(a2);
      if (a2 < neckA) { neckA = a2; neckK = k; }
    }
    if (neckK >= 0 && areas.length >= 6) {
      const med = quantile(areas.slice().sort((a, b) => a - b), .5);
      const ny = rowY(neckK);
      if (neckA < med * .72 && ny > i + n * .7 && ny < i + n * .92) res.neckY = ny;
    }
  }
  // ---- промежность: верхний устойчивый центральный зазор, ноги доходят до земли ----
  const bottomHasSplit = mid => {
    let ok = 0;
    for (let k = Math.floor(d * .015); k <= Math.floor(d * .07); k++) {
      const S = st[k];
      if (!S || S.n < 10) continue;
      const g2 = wwGap(S.xs, .15, .85, gapMin);
      if (g2 && Math.abs(g2.mid - mid) < n * .05) ok++;
    }
    return ok >= 2;
  };
  let crotchK = -1, gapMid = null;
  for (let k = Math.floor(d * .62); k >= Math.floor(d * .3); k--) {
    const S = st[k];
    if (!S || S.n < 14) continue;
    const g = wwGap(S.xs, .15, .85, gapMin);
    if (!g || Math.abs(g.mid - o) > n * .07) continue;
    let lo = 0;
    for (let q = 0; q < S.xs.length && S.xs[q] < g.mid; q++) lo++;
    const loF = lo / S.n;
    if (loF < .2 || loF > .8) continue;
    if (g.from - S.x(.1) < n * .03 || S.x(.9) - g.to < n * .03) continue;
    let ok = 0;
    for (let d2 = 1; d2 <= 3; d2++) {
      const S2 = st[k - d2];
      if (!S2) continue;
      const g2 = wwGap(S2.xs, .15, .85, gapMin);
      if (g2 && Math.abs(g2.mid - g.mid) < n * .035) ok++;
    }
    if (ok >= 2 && bottomHasSplit(g.mid)) { crotchK = k; gapMid = g.mid; break; }
  }
  if (crotchK >= 0) { res.crotchY = rowY(crotchK); res.gapX = gapMid; }
  for (let k = 1; k < Math.floor(d * .6); k++) {
    const S = st[k];
    if (!S || S.n < 12) continue;
    const g = wwGap(S.xs, .2, .8, n * .018);
    if (!g || Math.abs(g.mid - o) > n * .07) continue;
    let lo = 0;
    for (let q = 0; q < S.xs.length && S.xs[q] < g.mid; q++) lo++;
    if (lo / S.n < .15 || lo / S.n > .85) continue;
    const lp = S.pts.filter(p => p[r] > g.mid), rp = S.pts.filter(p => p[r] <= g.mid);
    if (lp.length < 5 || rp.length < 5) continue;
    const LS = wwStats(lp, r, a), RS = wwStats(rp, r, a);
    res.gapRows.push({ k: k, y: rowY(k), mid: g.mid, lx: LS.x(.5), rx: RS.x(.5), lz: LS.z(.5), rz: RS.z(.5) });
  }
  // ---- ноги ----
  for (const [sd, side] of sides) {
    const leg = res.legs[sd];
    if (crotchK < 0 || gapMid == null) continue;
    const LR = [];
    for (let k = 1; k <= crotchK; k++) {
      const S = st[k];
      if (!S) { LR.push(null); continue; }
      const pts = S.pts.filter(p => (p[r] - gapMid) * side > 0);
      if (pts.length < 6) { LR.push(null); continue; }
      const SS = wwStats(pts, r, a);
      const front = l > 0 ? SS.z(.93) : SS.z(.07), back = l > 0 ? SS.z(.07) : SS.z(.93);
      LR.push({ k: k, y: rowY(k), xC: quantile(pts.map(p => p[r]), .5), zC: quantile(pts.map(p => p[a]), .5), front: front, back: back, depth: Math.abs(front - back) });
    }
    const have = LR.filter(Boolean);
    if (have.length < 6) continue;
    const shinDepths = [];
    for (const r2 of have) if (r2.k > d * .05 && r2.k < d * .16) shinDepths.push(r2.depth);
    const shinRef = shinDepths.length ? quantile(shinDepths.slice().sort((a, b) => a - b), .5) : n * .018;
    let footTopK = -1;
    for (const r2 of have) if (r2.k <= d * .16 && (r2.depth > shinRef * 1.5 || r2.k < d * .03)) footTopK = Math.max(footTopK, r2.k);
    let ankleY = footTopK >= 0 ? rowY(footTopK) : i + n * .062;
    ankleY = Math.min(Math.max(ankleY, i + n * .028), i + n * .135);
    const footRows = have.filter(r2 => r2.y < ankleY + n * .006);
    if (footRows.length >= 2) {
      const fronts = footRows.map(r2 => r2.front), backs = footRows.map(r2 => r2.back);
      const fF = l > 0 ? quantile(fronts, .88) : quantile(fronts, .12);
      const fB = l > 0 ? quantile(backs, .12) : quantile(backs, .88);
      const fLen = Math.abs(fF - fB);
      if (fLen > n * .045) {
        leg.ankleY = ankleY;
        leg.footX = quantile(footRows.map(r2 => r2.xC), .5);
        leg.footZ = fB + l * fLen * .38;
        leg.toeZ = fF - l * fLen * .18;
        leg.toeY = Math.min(i + n * .018, Math.max(i + n * .005, ankleY - n * .02));
        leg.footFound = !0;
      }
    }
    const cY = res.crotchY, aY = ankleY + n * .025;
    const seg = have.filter(r2 => r2.y > aY && r2.y < cY - n * .012);
    if (seg.length >= 8) {
      const uOf = r2 => (cY - r2.y) / (cY - aY);
      const dep = seg.map(r2 => r2.depth);
      const sd2 = dep.map((v2, j) => (dep[Math.max(0, j - 1)] + v2 + dep[Math.min(dep.length - 1, j + 1)]) / 3);
      let bestJ = -1, bestS = 0;
      for (let j = 3; j < sd2.length - 1; j++) {
        const lo = (sd2[j - 3] + sd2[j - 2] + sd2[j - 1]) / 3;
        const hi = (sd2[j] + sd2[j + 1] + sd2[Math.min(sd2.length - 1, j + 2)]) / 3;
        const s2 = hi - lo;
        if (s2 > bestS) { bestS = s2; bestJ = j; }
      }
      let kneeU = .52;
      if (bestJ > 0 && bestS > n * .012) kneeU = Math.min(.68, Math.max(.35, uOf(seg[bestJ])));
      const kneeY = cY - kneeU * (cY - aY);
      let kn = null;
      for (const r2 of seg) if (!kn || Math.abs(r2.y - kneeY) < Math.abs(kn.y - kneeY)) kn = r2;
      if (kn) {
        leg.kneeX = kn.xC;
        leg.kneeY = Math.min(Math.max(kneeY, ankleY + n * .07), cY - n * .05);
        leg.kneeZ = (kn.front + kn.back) * .5 + l * Math.abs(kn.front - kn.back) * .08;
      }
    }
    if (leg.kneeY == null) {
      const target = ankleY + (cY - ankleY) * .52;
      let kn = null;
      for (const r2 of have) if (!kn || Math.abs(r2.y - target) < Math.abs(kn.y - target)) kn = r2;
      if (kn) { leg.kneeX = kn.xC; leg.kneeY = target; leg.kneeZ = (kn.front + kn.back) * .5; }
    }
    const hipRows = have.filter(r2 => r2.k <= crotchK && r2.k >= crotchK - 3);
    if (hipRows.length) {
      leg.hipX = quantile(hipRows.map(r2 => r2.xC), .5);
      leg.hipZ = c * .35 + quantile(hipRows.map(r2 => r2.zC), .5) * .65;
      leg.hipY = cY + n * .045;
    }
    leg.found = leg.kneeY != null && leg.hipX != null;
  }
  // ---- руки ----
  {
    // опорная полуширина талии — край центрального блоба по строке (устойчиво к рукам в поясе)
    const edges = [];
    for (let k = Math.floor(d * .38); k < Math.floor(d * .52); k++) {
      const S = st[k];
      if (!S || S.n < 12) continue;
      const ax = S.xs.map(v2 => Math.abs(v2 - o)).sort((a, b) => a - b);
      let edge = ax[Math.floor(ax.length * .93)];
      for (let q = Math.floor(ax.length * .12); q < ax.length * .92; q++) {
        if (ax[q + 1] - ax[q] > n * .025 && ax.length - q > ax.length * .08) { edge = ax[q]; break; }
      }
      edges.push(edge);
    }
    const bellyHalf = edges.length ? quantile(edges.slice().sort((a, b) => a - b), .5) : n * .09;
    const armTh = bellyHalf + n * .015;
    for (const [sd, side] of sides) {
      const arm = res.arms[sd];
      const kEnd = Math.floor(d * .94);
      const AR = [];
      for (let k = 6; k < kEnd; k++) {
        const S = st[k];
        if (!S) { AR.push(null); continue; }
        const armPts = S.pts.filter(p => (p[r] - o) * side > armTh);
        if (armPts.length < 5) { AR.push(null); continue; }
        let dMin = Infinity, dMax = -Infinity;
        for (const p of armPts) { const dl = (p[r] - o) * side; if (dl < dMin) dMin = dl; if (dl > dMax) dMax = dl; }
        const inner = o + side * dMin, outer = o + side * dMax;
        const thMax = k <= crotchK ? n * .13 : Infinity;
        if (dMax - dMin < n * .018 || dMax - dMin > thMax || dMax < n * .1) { AR.push(null); continue; }
        const zq = [quantile(armPts.map(p => p[a]), .85), quantile(armPts.map(p => p[a]), .15)];
        AR.push({ k: k, y: rowY(k), inner: inner, outer: outer, zC: quantile(armPts.map(p => p[a]), .5), zSpan: Math.abs(zq[0] - zq[1]), pts: armPts });
      }
    let bestA = -1, bestLen = 0, curA = -1;
    for (let j = 0; j <= AR.length; j++) {
      const ok = j < AR.length && AR[j];
      if (ok) { if (curA < 0) curA = j; }
      else if (curA >= 0) { const len = j - curA; if (len > bestLen) { bestLen = len; bestA = curA; } curA = -1; }
    }
    if (bestLen < 3) continue;
    const run = AR.slice(bestA, bestA + bestLen);
    const top = run[run.length - 1];
    if (top.y < i + n * .56) continue;
    let tipD = 0, tipR = null;
    const runMidY = (run[0].y + run[run.length - 1].y) * .5;
    const vertical = run[run.length - 1].y - run[0].y > n * .12;
    for (let j = 0; j < AR.length; j++) {
      const r2 = AR[j];
      if (!r2) continue;
      if (vertical && r2.y > runMidY + n * .02) continue;
      const d2 = (r2.outer - o) * side;
      if (d2 > tipD) { tipD = d2; tipR = r2; }
    }
    if (!tipR || tipD < n * .1) continue;
    const tipX = o + side * tipD, tipY = tipR.y, tipZ = tipR.zC;
    const armR = quantile(run.slice(-3).map(r2 => r2.zSpan).sort((a, b) => a - b), .5) * .5;
    let shY = res.neckY != null ? res.neckY - n * .04 : top.y + armR;
    shY = Math.min(Math.max(shY, i + n * .6), i + n * .9);
    const shX = quantile(run.slice(-2).map(r2 => r2.inner), .5) - side * n * .012;
    const shZ = c * .5 + quantile(run.slice(-2).map(r2 => r2.zC), .5) * .5;
    if ((tipX - shX) * side < n * .06) continue;
    const sh3 = { x: shX, y: shY, z: shZ }, tip3 = { x: tipX, y: tipY, z: tipZ };
    // полилиния по t-бинам вдоль плечо->кончик, локоть/кисть по длине дуги
    const dx = tipX - shX, dy = tipY - shY, dz = tipZ - shZ;
    const L2 = dx * dx + dy * dy + dz * dz;
    let elb = null, wri = null;
    if (L2 > 1e-9) {
      const NB = 14, bins = [];
      for (let b = 0; b < NB; b++) bins.push([]);
      for (const r2 of run) for (const p of r2.pts) {
        const t2 = ((p[r] - shX) * dx + (p.y - shY) * dy + (p[a] - shZ) * dz) / L2;
        if (t2 >= 0 && t2 < 1) bins[Math.min(NB - 1, Math.floor(t2 * NB))].push(p);
      }
      const centers = [];
      for (let b = 0; b < NB; b++) {
        const m = wwMean(bins[b], r, a);
        if (m && bins[b].length >= 4) centers.push(m);
      }
      if (centers.length >= 3) {
        centers.unshift({ x: shX, y: shY, z: shZ });
        let total = 0;
        const cum = [0];
        for (let b = 1; b < centers.length; b++) {
          total += Math.hypot(centers[b].x - centers[b - 1].x, centers[b].y - centers[b - 1].y, centers[b].z - centers[b - 1].z);
          cum.push(total);
        }
        const at = f => {
          if (f <= 0) return centers[0];
          if (f >= total) return centers[centers.length - 1];
          let b = 1;
          while (b < cum.length && cum[b] < f) b++;
          const seg2 = cum[b] - cum[b - 1] || 1e-9;
          const u2 = (f - cum[b - 1]) / seg2;
          const p0 = centers[b - 1], p1 = centers[b];
          return { x: p0.x + (p1.x - p0.x) * u2, y: p0.y + (p1.y - p0.y) * u2, z: p0.z + (p1.z - p0.z) * u2 };
        };
        elb = at(total * .5);
        // локоть в изгибе: пик суммы углов поворота полилинии бин-центроидов
        {
          let bi2 = -1, bestSum = 0;
          for (let b = 2; b < centers.length - 1; b++) {
            const seg = (i, j) => {
              const v1x = centers[j].x - centers[i].x, v1y = centers[j].y - centers[i].y, v1z = centers[j].z - centers[i].z;
              return Math.hypot(v1x, v1y, v1z);
            };
            const ang = (i, j, k2) => {
              const v1x = centers[j].x - centers[i].x, v1y = centers[j].y - centers[i].y, v1z = centers[j].z - centers[i].z;
              const v2x = centers[k2].x - centers[j].x, v2y = centers[k2].y - centers[j].y, v2z = centers[k2].z - centers[j].z;
              const l1 = Math.hypot(v1x, v1y, v1z), l2 = Math.hypot(v2x, v2y, v2z);
              if (l1 < n * .015 || l2 < n * .015) return 0;
              return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y + v1z * v2z) / (l1 * l2))));
            };
            const sum = ang(b - 1, b, b + 1) + ang(b, b + 1, b + 2 < centers.length ? b + 2 : b + 1);
            if (sum > bestSum) { bestSum = sum; bi2 = b; }
          }
          const arcFc = cum[bi2] / (total || 1);
          if (bi2 > 0 && bestSum > .5 && arcFc > .15 && arcFc < .7) elb = centers[bi2];
        }
        wri = at(total * .82);
      }
    }
    const lerp3 = (a3, b3, t3) => ({ x: a3.x + (b3.x - a3.x) * t3, y: a3.y + (b3.y - a3.y) * t3, z: a3.z + (b3.z - a3.z) * t3 });
    arm.shoulder = sh3;
    arm.elbow = elb || lerp3(sh3, tip3, .48);
    arm.wrist = wri || lerp3(sh3, tip3, .82);
    arm.tip = tip3;
    arm.found = !0;
    }
  }
  return res;
}
function ww(s, e = "z+") {
  const t = analyzeBodyGeometry(s, e);
  let verts = [];
  try { verts = sampleGeometry(s, 5000, 60000); } catch { verts = []; }
  let A = null;
  if (verts.length >= 120) { try { A = wwAnalyzeBody(t, verts); } catch { A = null; } }
  const P = new Map;
  for (const en of HUMANOID_TEMPLATE) P.set(en.name, wwTemplatePosition(en, t));
  if (A) {
    const { height: n, bounds: i, lateralAxis: r, lateralCenter: o, depthAxis: a, coreDepth: c, forwardSign: l } = t;
    const y0 = i.min.y;
    const fin = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? p : null;
    const V3 = (x, y, z) => { const g = new THREE.Vector3; g[r] = x; g.y = y; g[a] = z; return g; };
    const mir = p => p ? { x: 2 * o - p.x, y: p.y, z: p.z } : null;
    const mx = v => v == null ? null : 2 * o - v;
    if (A.arms.left.found && !A.arms.right.found) A.arms.right = { found: !0, mirrored: true, shoulder: mir(A.arms.left.shoulder), elbow: mir(A.arms.left.elbow), wrist: mir(A.arms.left.wrist), tip: mir(A.arms.left.tip) };
    if (A.arms.right.found && !A.arms.left.found) A.arms.left = { found: !0, mirrored: true, shoulder: mir(A.arms.right.shoulder), elbow: mir(A.arms.right.elbow), wrist: mir(A.arms.right.wrist), tip: mir(A.arms.right.tip) };
    if (A.legs.left.found && !A.legs.right.found) A.legs.right = { found: !0, mirrored: true, hipX: mx(A.legs.left.hipX), hipY: A.legs.left.hipY, hipZ: A.legs.left.hipZ, kneeX: mx(A.legs.left.kneeX), kneeY: A.legs.left.kneeY, kneeZ: A.legs.left.kneeZ, ankleY: A.legs.left.ankleY, footX: mx(A.legs.left.footX), footZ: A.legs.left.footZ, toeZ: A.legs.left.toeZ, toeY: A.legs.left.toeY, footFound: A.legs.left.footFound };
    if (A.legs.right.found && !A.legs.left.found) A.legs.left = { found: !0, mirrored: true, hipX: mx(A.legs.right.hipX), hipY: A.legs.right.hipY, hipZ: A.legs.right.hipZ, kneeX: mx(A.legs.right.kneeX), kneeY: A.legs.right.kneeY, kneeZ: A.legs.right.kneeZ, ankleY: A.legs.right.ankleY, footX: mx(A.legs.right.footX), footZ: A.legs.right.footZ, toeZ: A.legs.right.toeZ, toeY: A.legs.right.toeY, footFound: A.legs.right.footFound };
    const hipsY = A.crotchY != null ? A.crotchY + n * .075 : null;
    if (hipsY != null) P.set("mixamorigHips", V3(o, hipsY, c));
    const hipsRef = hipsY != null ? hipsY : y0 + n * .525;
    const neckRef = A.neckY != null ? A.neckY : y0 + n * .865;
    if (A.neckY != null) {
      P.set("mixamorigSpine", V3(o, hipsRef + (neckRef - hipsRef) * .34, c));
      P.set("mixamorigSpine1", V3(o, hipsRef + (neckRef - hipsRef) * .54, c));
      P.set("mixamorigSpine2", V3(o, hipsRef + (neckRef - hipsRef) * .78, c));
      P.set("mixamorigNeck", V3(o, neckRef, c));
      P.set("mixamorigHead", V3(o, neckRef + (y0 + n - neckRef) * .48, c + n * .015 * l));
    }
    const pickGap = h => {
      let best = null;
      for (const g of A.gapRows) if (best == null || Math.abs(g.y - (y0 + h * n)) < Math.abs(best.y - (y0 + h * n))) best = g;
      return best;
    };
    for (const [sd, side] of [["Left", 1], ["Right", -1]]) {
      const L = A.legs[sd.toLowerCase()];
      if (L && L.found) {
        const hp = fin({ x: L.hipX, y: L.hipY, z: L.hipZ });
        if (hp) P.set("mixamorig" + sd + "UpLeg", V3(hp.x, hp.y, hp.z));
        const kn = fin({ x: L.kneeX, y: L.kneeY, z: L.kneeZ });
        if (kn) P.set("mixamorig" + sd + "Leg", V3(kn.x, kn.y, kn.z));
        if (L.footFound) {
          const ft = fin({ x: L.footX, y: L.ankleY, z: L.footZ });
          if (ft) P.set("mixamorig" + sd + "Foot", V3(ft.x, ft.y, ft.z));
          const te = fin({ x: L.footX, y: L.toeY, z: L.toeZ });
          if (te) P.set("mixamorig" + sd + "ToeBase", V3(te.x, te.y, te.z));
        }
      } else if (A.gapRows.length) {
        const gH = pickGap(.47), gK = pickGap(.29), gF = pickGap(.08);
        const gx = side > 0 ? gH && gH.lx : gH && gH.rx, gz = side > 0 ? gH && gH.lz : gH && gH.rz;
        if (gH && Number.isFinite(gx)) P.set("mixamorig" + sd + "UpLeg", V3(gx, y0 + n * .49, c * .5 + gz * .5));
        const kx = side > 0 ? gK && gK.lx : gK && gK.rx, kz = side > 0 ? gK && gK.lz : gK && gK.rz;
        if (gK && Number.isFinite(kx)) P.set("mixamorig" + sd + "Leg", V3(kx, y0 + n * .29, c * .5 + kz * .5));
        const fx = side > 0 ? gF && gF.lx : gF && gF.rx, fz = side > 0 ? gF && gF.lz : gF && gF.rz;
        if (gF && Number.isFinite(fx)) {
          P.set("mixamorig" + sd + "Foot", V3(fx, y0 + n * .075, fz + l * n * .02));
          P.set("mixamorig" + sd + "ToeBase", V3(fx, y0 + n * .02, fz + l * n * .07));
        }
      }
      const arm = A.arms[sd.toLowerCase()];
      if (arm && arm.found) {
        const sh = fin(arm.shoulder), el = fin(arm.elbow), wr = fin(arm.wrist);
        if (sh) {
          P.set("mixamorig" + sd + "Arm", V3(sh.x, sh.y, sh.z));
          P.set("mixamorig" + sd + "Shoulder", V3(o + (sh.x - o) * .55, Math.min(sh.y + n * .035, y0 + n * .93), c));
          if (el) P.set("mixamorig" + sd + "ForeArm", V3(el.x, el.y, el.z));
          if (wr) P.set("mixamorig" + sd + "Hand", V3(wr.x, wr.y, wr.z));
        }
      }
    }
  }
  return { positions: P, info: t, detection: A, sampleCount: verts.length };
}
const JOINT_MAP={
  leftArm:['LeftShoulder','LeftArm','LeftForeArm','LeftHand'],
  rightArm:['RightShoulder','RightArm','RightForeArm','RightHand'],
  leftLeg:['LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase'],
  rightLeg:['RightUpLeg','RightLeg','RightFoot','RightToeBase']
};
export function calculateAdaptiveFit(model,direction='z+'){
 return ww(model,direction);
}
export function fitAdaptiveLimbs(guide,model,direction='z+'){
 if(!guide?.bones?.size)throw Error('Сначала создай скелет');
 const result=calculateAdaptiveFit(model,direction);
 const affected=[],skipped=[],groups={};
 for(const [key,names] of Object.entries(JOINT_MAP)){
  const side=key.slice(0,-3);
  const detected=key.endsWith('Arm')?result.detection?.arms?.[side]:result.detection?.legs?.[side];
  if(!detected?.found){skipped.push(key);groups[key]='not-detected';continue;}
  const pending=names.map(name=>['mixamorig'+name,result.positions.get('mixamorig'+name)]);
  if(pending.some(([name,p])=>!guide.bones.has(name)||!p?.isVector3||![p.x,p.y,p.z].every(Number.isFinite))){
   skipped.push(key);groups[key]='invalid';continue;
  }
  for(const [name,point] of pending){
   moveJointWorld(guide,name,point);
   affected.push(name);
  }
  groups[key]=detected.mirrored?'mirrored':'geometry';
 }
 if(!affected.length)throw Error('Геометрия конечностей не распознана. Старые суставы сохранены.');
 guide.lastAdaptiveFit={direction,groups,samples:result.sampleCount};
 return {affected,skipped,groups,samples:result.sampleCount,info:result.info};
}
