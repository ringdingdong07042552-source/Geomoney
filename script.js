/* =========================================================
   THE WEALTHY SAVER — annuity-due savings simulator
   S_n = R(1+r)[((1+r)^n - 1)/r]
   ========================================================= */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- number formatting ---------- */
const fmt = (num, decimals = 0) =>
  Number(num).toLocaleString('th-TH', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });

/* ---------- core math engine ---------- */
const Engine = {
  monthlyRate(annualPct) { return annualPct / 100 / 12; },

  // Mode 1: find S_n
  findSn(R, annualPct, years) {
    const r = this.monthlyRate(annualPct);
    const n = years * 12;
    if (Math.abs(r) < 1e-12) return R * n;
    return R * (1 + r) * (((1 + r) ** n - 1) / r);
  },

  // Mode 2: find R
  findR(Sn, annualPct, years) {
    const r = this.monthlyRate(annualPct);
    const n = years * 12;
    if (Math.abs(r) < 1e-12) return Sn / n;
    return Sn / ((1 + r) * (((1 + r) ** n - 1) / r));
  },

  // Mode 3: find n (in months). returns null if unreachable.
  findN(Sn, R, annualPct) {
    const r = this.monthlyRate(annualPct);
    if (Math.abs(r) < 1e-12) return Sn / R;
    const ratio = (Sn * r) / (R * (1 + r));
    if (ratio <= -1) return null;
    return Math.log(1 + ratio) / Math.log(1 + r);
  },

  // Mode 4: find annual rate % via bisection. returns null if unreachable in [0%, 60%] annual.
  findRate(Sn, R, years) {
    const n = years * 12;
    const f = (r) => {
      if (Math.abs(r) < 1e-12) return R * n - Sn;
      return R * (1 + r) * (((1 + r) ** n - 1) / r) - Sn;
    };
    let lo = 0, hi = 0.05; // monthly, up to ~60%/yr
    const f0 = f(lo), fhi = f(hi);
    if (f0 >= 0) return 0; // target already reached at 0% interest
    if (fhi < 0) return null; // unreachable even at max rate
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (Math.abs(fm) < 1e-6) { lo = hi = mid; break; }
      if (fm > 0) hi = mid; else lo = mid;
    }
    return ((lo + hi) / 2) * 12 * 100;
  },

  // balance after each month, for charting
  series(R, annualPct, months) {
    const r = this.monthlyRate(annualPct);
    const arr = [];
    for (let i = 1; i <= months; i++) {
      arr.push(Math.abs(r) < 1e-12 ? R * i : R * (1 + r) * (((1 + r) ** i - 1) / r));
    }
    return arr;
  }
};

/* ---------- slider <-> number sync ---------- */
function pair(rangeId, numId, onChange) {
  const range = document.getElementById(rangeId);
  const num = document.getElementById(numId);
  range.addEventListener('input', () => {
    num.value = range.value;
    onChange();
  });
  num.addEventListener('input', () => {
    let v = parseFloat(num.value);
    if (isNaN(v)) return;
    const min = parseFloat(range.min);
    const rangeMax = parseFloat(range.max);
    // let the number field go above the slider's max (slider just clamps its own thumb)
    range.value = Math.min(Math.max(v, min), rangeMax);
    onChange();
  });
  return { get: () => parseFloat(num.value) || 0 };
}

/* registry so tab-switch / resize can re-trigger the right panel's calculation+chart */
const missionUpdaters = {};

/* ---------- count-up animation ---------- */
function animateValue(el, to, decimals = 0) {
  const from = parseFloat((el.dataset.raw || '0').replace(/,/g, '')) || 0;
  el.dataset.raw = to;
  if (reduceMotion) { el.textContent = fmt(to, decimals); return; }
  const duration = 450;
  const start = performance.now();
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = from + (to - from) * eased;
    el.textContent = fmt(val, decimals);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- jar fill + coin reveal + confetti ---------- */
const jarState = {}; // track whether each jar already celebrated

function setJar(prefix, percent) {
  const p = Math.max(0, Math.min(percent, 100));
  const fillEl = document.getElementById(prefix + '_fill');
  const bodyTop = 26, bodyH = 74, bodyBottom = 100;
  const h = (p / 100) * bodyH;
  fillEl.setAttribute('y', bodyBottom - h);
  fillEl.setAttribute('height', h);

  const jar = fillEl.closest('.jar');
  jar.querySelectorAll('.jar-coin').forEach((c, i) => {
    c.classList.toggle('show', p > (i + 1) * 25);
  });

  const percentEl = document.getElementById(prefix + '_percent');
  if (percentEl) percentEl.textContent = fmt(p, 0);

  if (p >= 100 && !jarState[prefix]) {
    jarState[prefix] = true;
    burstConfetti();
  } else if (p < 100) {
    jarState[prefix] = false;
  }
}

function burstConfetti() {
  if (reduceMotion) return;
  const layer = document.getElementById('confetti-layer');
  const count = 24;
  for (let i = 0; i < count; i++) {
    const coin = document.createElement('div');
    coin.className = 'confetti-coin';
    coin.textContent = '฿';
    const left = Math.random() * 100;
    const duration = 1.8 + Math.random() * 1.4;
    const delay = Math.random() * 0.3;
    coin.style.left = left + 'vw';
    coin.style.animationDuration = duration + 's';
    coin.style.animationDelay = delay + 's';
    layer.appendChild(coin);
    setTimeout(() => coin.remove(), (duration + delay) * 1000 + 100);
  }
}

/* ---------- chart drawing (canvas) ---------- */
function drawChart(canvasId, series, targetValue) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600;
  const H = canvas.clientHeight || 220;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padL = 46, padR = 14, padT = 16, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxVal = Math.max(...series, targetValue) * 1.08;

  function xAt(i) { return padL + (i / (series.length - 1)) * plotW; }
  function yAt(v) { return padT + plotH - (v / maxVal) * plotH; }

  function render(progress) {
    ctx.clearRect(0, 0, W, H);

    // grid + y labels
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      const v = (maxVal / steps) * s;
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillText(v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1000) + 'k', padL - 6, y);
    }

    // target line
    if (targetValue > 0 && targetValue <= maxVal) {
      const ty = yAt(targetValue);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#FFC300';
      ctx.beginPath();
      ctx.moveTo(padL, ty);
      ctx.lineTo(W - padR, ty);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#FFC300';
      ctx.textAlign = 'left';
      ctx.fillText('เป้าหมาย', padL + 4, ty - 8);
    }

    // x labels (years)
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const totalMonths = series.length;
    const yearsTotal = totalMonths / 12;
    const xTicks = Math.min(6, Math.max(2, Math.round(yearsTotal)));
    for (let t = 0; t <= xTicks; t++) {
      const idx = Math.round((t / xTicks) * (series.length - 1));
      ctx.fillText(Math.round((idx + 1) / 12) + 'y', xAt(idx), H - padB + 6);
    }

    // line (progressive reveal)
    const revealCount = Math.max(2, Math.floor(series.length * progress));
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#52B788';
    ctx.lineJoin = 'round';
    for (let i = 0; i < revealCount; i++) {
      const x = xAt(i), y = yAt(series[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // area fill
    ctx.lineTo(xAt(revealCount - 1), yAt(0));
    ctx.lineTo(xAt(0), yAt(0));
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
    grad.addColorStop(0, 'rgba(82,183,136,.35)');
    grad.addColorStop(1, 'rgba(82,183,136,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // endpoint dot
    if (revealCount > 0) {
      const lastIdx = revealCount - 1;
      ctx.beginPath();
      ctx.fillStyle = '#FFC300';
      ctx.arc(xAt(lastIdx), yAt(series[lastIdx]), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (reduceMotion) { render(1); return; }
  const start = performance.now();
  const dur = 700;
  function frame(now) {
    const p = Math.min((now - start) / dur, 1);
    render(1 - Math.pow(1 - p, 3));
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ---------- formula plug-in text helpers ---------- */
function fmtR(r) { return r.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''); }

/* =========================================================
   MISSION 1 — find S_n
   ========================================================= */
(function mission1() {
  const R = pair('m1_R', 'm1_R_num', update);
  const rate = pair('m1_rate', 'm1_rate_num', update);
  const years = pair('m1_years', 'm1_years_num', update);
  const TARGET = 1000000;

  function update() {
    const Rv = R.get(), ratePct = rate.get(), yrs = years.get();
    const r = Engine.monthlyRate(ratePct);
    const n = yrs * 12;
    const Sn = Engine.findSn(Rv, ratePct, yrs);

    document.getElementById('m1_formula').textContent =
      `S₍${n}₎ = ${fmt(Rv)}(1+${fmtR(r)}) × [((1+${fmtR(r)})^${n} − 1) / ${fmtR(r)}]  ≈  ${fmt(Sn)} บาท`;

    animateValue(document.getElementById('m1_result'), Sn);

    const status = document.getElementById('m1_status');
    const pct = (Sn / TARGET) * 100;
    if (Sn >= TARGET) {
      status.textContent = '🎉 ถึงเป้าหมาย 1 ล้านบาทแล้ว!';
      status.className = 'result-status success';
    } else {
      status.textContent = `ยังห่างเป้าหมาย 1 ล้านบาทอยู่ ${fmt(TARGET - Sn)} บาท`;
      status.className = 'result-status';
    }

    setJar('m1', pct);
    drawChart('m1_chart', Engine.series(Rv, ratePct, n), TARGET);
  }
  missionUpdaters['1'] = update;
  update();
})();

/* =========================================================
   MISSION 2 — find R
   ========================================================= */
(function mission2() {
  const target = pair('m2_target', 'm2_target_num', update);
  const rate = pair('m2_rate', 'm2_rate_num', update);
  const years = pair('m2_years', 'm2_years_num', update);

  function update() {
    const Sn = target.get(), ratePct = rate.get(), yrs = years.get();
    const r = Engine.monthlyRate(ratePct);
    const n = yrs * 12;
    const Rv = Engine.findR(Sn, ratePct, yrs);

    document.getElementById('m2_formula').textContent =
      `R = ${fmt(Sn)} ÷ [(1+${fmtR(r)}) × ((1+${fmtR(r)})^${n} − 1)/${fmtR(r)}]  ≈  ${fmt(Rv)} บาท/เดือน`;

    animateValue(document.getElementById('m2_result'), Rv);

    const status = document.getElementById('m2_status');
    if (Rv > 0 && isFinite(Rv)) {
      status.textContent = `ออม ${fmt(Rv)} บาท/เดือน นาน ${yrs} ปี → ครบ ${fmt(Sn)} บาทพอดี`;
      status.className = 'result-status success';
    } else {
      status.textContent = 'ลองปรับตัวเลขใหม่อีกครั้ง';
      status.className = 'result-status fail';
    }

    setJar('m2', 100); // this mode always resolves exactly to the goal
    drawChart('m2_chart', Engine.series(Rv, ratePct, n), Sn);
  }
  missionUpdaters['2'] = update;
  update();
})();

/* =========================================================
   MISSION 3 — find n
   ========================================================= */
(function mission3() {
  const target = pair('m3_target', 'm3_target_num', update);
  const R = pair('m3_R', 'm3_R_num', update);
  const rate = pair('m3_rate', 'm3_rate_num', update);

  function update() {
    const Sn = target.get(), Rv = R.get(), ratePct = rate.get();
    const r = Engine.monthlyRate(ratePct);
    const months = Engine.findN(Sn, Rv, ratePct);

    const formulaEl = document.getElementById('m3_formula');
    const status = document.getElementById('m3_status');
    const resultEl = document.getElementById('m3_result');
    const unitEl = document.getElementById('m3_unit');

    if (months === null || !isFinite(months) || months <= 0) {
      formulaEl.textContent = 'ยอดออมต่อเดือนนี้ไม่สามารถพาไปถึงเป้าหมายได้ในสมการนี้';
      resultEl.textContent = '—';
      unitEl.textContent = '';
      status.textContent = 'ลองเพิ่มเงินออมต่อเดือน หรือลดเป้าหมายลง';
      status.className = 'result-status fail';
      setJar('m3', 0);
      drawChart('m3_chart', Engine.series(Rv, ratePct, 12), Sn);
      return;
    }

    const yrsExact = months / 12;
    formulaEl.textContent =
      `${months.toFixed(1)} = ln(1 + ${fmt(Sn)}×${fmtR(r)}/(${fmt(Rv)}×(1+${fmtR(r)}))) / ln(1+${fmtR(r)})  →  ${yrsExact.toFixed(1)} ปี`;

    animateValue(resultEl, yrsExact, 1);
    unitEl.textContent = `ปี (${Math.round(months)} งวด)`;

    status.textContent = `ออม ${fmt(Rv)} บาท/เดือน ครบ ${fmt(Sn)} บาท ใน ${yrsExact.toFixed(1)} ปี`;
    status.className = 'result-status success';

    setJar('m3', 100);
    drawChart('m3_chart', Engine.series(Rv, ratePct, Math.ceil(months)), Sn);
  }
  missionUpdaters['3'] = update;
  update();
})();

/* =========================================================
   MISSION 4 — find r (annual %)
   ========================================================= */
(function mission4() {
  const target = pair('m4_target', 'm4_target_num', update);
  const R = pair('m4_R', 'm4_R_num', update);
  const years = pair('m4_years', 'm4_years_num', update);

  function update() {
    const Sn = target.get(), Rv = R.get(), yrs = years.get();
    const n = yrs * 12;
    const ratePct = Engine.findRate(Sn, Rv, yrs);

    const formulaEl = document.getElementById('m4_formula');
    const status = document.getElementById('m4_status');
    const resultEl = document.getElementById('m4_result');

    if (ratePct === null) {
      formulaEl.textContent = 'แม้แต่ดอกเบี้ยสูงถึง 60% ต่อปี ก็ยังไปไม่ถึงเป้าหมายนี้';
      resultEl.textContent = '—';
      status.textContent = 'ลองเพิ่มเงินออมต่อเดือน หรือขยายระยะเวลา';
      status.className = 'result-status fail';
      setJar('m4', 0);
      drawChart('m4_chart', Engine.series(Rv, 0, n), Sn);
      return;
    }

    const r = Engine.monthlyRate(ratePct);
    formulaEl.textContent =
      `แก้สมการ ${fmt(Sn)} = ${fmt(Rv)}(1+r)[((1+r)^${n} − 1)/r]  →  r ≈ ${fmtR(r)} ต่อเดือน = ${ratePct.toFixed(2)}% ต่อปี`;

    animateValue(resultEl, ratePct, 2);

    status.textContent = ratePct <= 0
      ? 'ไม่ต้องมีดอกเบี้ยก็ถึงเป้าหมายอยู่แล้ว'
      : `ต้องหาผลตอบแทนเฉลี่ย ${ratePct.toFixed(2)}% ต่อปี`;
    status.className = 'result-status success';

    setJar('m4', 100);
    drawChart('m4_chart', Engine.series(Rv, ratePct, n), Sn);
  }
  missionUpdaters['4'] = update;
  update();
})();

/* =========================================================
   TAB NAVIGATION
   ========================================================= */
let activeMission = '1';

document.querySelectorAll('.mission-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.mission;
    activeMission = id;
    document.querySelectorAll('.mission-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
    });
    document.querySelectorAll('.mission-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.panel === id);
    });
    // recompute + redraw the chart now that its canvas is actually visible/sized
    if (missionUpdaters[id]) missionUpdaters[id]();
  });
});

/* redraw the currently visible chart on resize (debounced) */
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (missionUpdaters[activeMission]) missionUpdaters[activeMission]();
  }, 150);
});
