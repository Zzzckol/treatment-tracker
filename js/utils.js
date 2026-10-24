/** 小工具：日期、DOM、图表、提示 */

/* ---------- 日期（一律本地时区，避免跨时区错位） ---------- */

export const pad = (n) => String(n).padStart(2, '0');

export function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function today() { return ymd(new Date()); }

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 两个日期相差天数（b - a），只算日期不看时间 */
export function daysBetween(a, b) {
  const A = parseYmd(a), B = parseYmd(b);
  return Math.round((B - A) / 86400000);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function fmtMD(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtYMD(s) {
  const d = parseYmd(s);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function weekday(s) {
  const d = parseYmd(s);
  return '日一二三四五六'[d.getDay()];
}

/** 相对今天的说法 */
export function relDay(s) {
  const n = daysBetween(today(), s);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === 2) return '后天';
  if (n === -1) return '昨天';
  if (n < 0) return `${-n}天前`;
  return `${n}天后`;
}

export function nowHHMM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- DOM ---------- */

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer = null;
export function toast(msg, ms = 2000) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

/* ---------- 图表：手写 SVG 折线，无依赖 ---------- */

export const CHART = {
  ink3: '#7a8fa3',
  line: '#e2ecf0',
  band: '#12a150',
  brand: '#0ea5a0',
  bad: '#e0534a',
};

/**
 * 画一条趋势线，带参考区间阴影带。
 * @param {{x:string,y:number}[]} points 已按 x 升序
 * @param {object} opt {lo, hi, unit, w, h, color}
 */
export function sparkline(points, opt = {}) {
  const W = opt.w || 340, H = opt.h || 132;
  // 手机屏幕上坐标轴文字不能小于 10px，留足够边距
  const PL = 42, PR = 12, PT = 14, PB = 24;
  const iw = W - PL - PR, ih = H - PT - PB;

  if (!points.length) {
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">
      <text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="${CHART.ink3}">还没有数据</text></svg>`;
  }

  const ys = points.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const refLo = opt.lo, refHi = opt.hi;
  if (Number.isFinite(refLo) && Number.isFinite(refHi)) {
    lo = Math.min(lo, refLo);
    hi = Math.max(hi, refHi);
  }
  if (hi === lo) { hi = lo + 1; lo = lo - 1; }
  const padY = (hi - lo) * 0.12;
  lo -= padY; hi += padY;

  // 医学指标通常不会为负：参考下限 >= 0 时，轴不越过 0
  const nonNegative = Number.isFinite(refLo) ? refLo >= 0 : Math.min(...ys) >= 0;
  if (nonNegative && lo < 0) lo = 0;

  const X = (i) => PL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const Y = (v) => PT + ih - ((v - lo) / (hi - lo)) * ih;

  let band = '';
  if (Number.isFinite(refLo) && Number.isFinite(refHi)) {
    const y1 = Y(refHi), y2 = Y(refLo);
    band = `<rect x="${PL}" y="${y1}" width="${iw}" height="${Math.max(1, y2 - y1)}" fill="${CHART.band}" opacity=".13"/>`;
  }

  // 水平网格：字号提到 10.5，手机上才看得清
  let grid = '';
  for (let i = 0; i <= 2; i++) {
    const v = lo + ((hi - lo) * i) / 2;
    const y = Y(v);
    grid += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="${CHART.line}" stroke-width="1"/>
      <text x="${PL - 6}" y="${y + 4}" text-anchor="end" font-size="11.5" fill="${CHART.ink3}">${fmtNum(v)}</text>`;
  }

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = path + ` L${X(points.length - 1).toFixed(1)},${PT + ih} L${X(0).toFixed(1)},${PT + ih} Z`;

  const lineColor = opt.color || CHART.brand;
  const dots = points.map((p, i) => {
    const out = p.y > (opt.hi ?? Infinity) || p.y < (opt.lo ?? -Infinity);
    return `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${out ? 3.4 : 2.6}"
      fill="${out ? CHART.bad : lineColor}" stroke="#fff" stroke-width="1.2"/>`;
  }).join('');

  const first = points[0].x, last = points[points.length - 1].x;
  const xlabel = `<text x="${PL}" y="${H - 6}" font-size="11.5" fill="${CHART.ink3}">${shortDate(first)}</text>` +
    (points.length > 1 ? `<text x="${W - PR}" y="${H - 6}" text-anchor="end" font-size="11.5" fill="${CHART.ink3}">${shortDate(last)}</text>` : '');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="趋势图">
    ${grid}${band}
    <path d="${area}" fill="${lineColor}" opacity=".07"/>
    <path d="${path}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${xlabel}
  </svg>`;
}

function shortDate(s) {
  const [, m, d] = String(s).split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function fmtNum(v) {
  if (!Number.isFinite(v)) return '';
  // 整数不补小数：96 就是 96，不要 96.0
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  // 去掉尾随的 0：2.10 → 2.1，5.40 → 5.4
  return String(parseFloat(s));
}

/* ---------- 文件下载 ---------- */

export function download(filename, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/* ---------- 弹层 ---------- */

const mask = () => document.getElementById('mask');

export function openSheet({ title, body, footer }) {
  document.getElementById('sheet-title').textContent = title;
  const b = document.getElementById('sheet-body');
  const f = document.getElementById('sheet-foot');
  b.replaceChildren();
  f.replaceChildren();
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
  if (footer) for (const x of [].concat(footer)) f.append(x);
  mask().classList.add('on');
  b.scrollTop = 0;
}

export function closeSheet() {
  mask().classList.remove('on');
}

export function initSheet() {
  document.getElementById('sheet-x').addEventListener('click', closeSheet);
  mask().addEventListener('click', (e) => { if (e.target === mask()) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
}

/* ---------- 确认 ---------- */

export function confirmAsk(msg) {
  return new Promise((resolve) => {
    const yes = el('button', { class: 'btn danger', onclick: () => { closeSheet(); resolve(true); } }, '确定');
    const no = el('button', { class: 'btn', onclick: () => { closeSheet(); resolve(false); } }, '取消');
    openSheet({ title: '确认一下', body: el('p', { text: msg }), footer: [no, yes] });
  });
}
