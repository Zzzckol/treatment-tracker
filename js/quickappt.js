/**
 * 日程录入重构版：极简入口 + 智能补充
 *
 * 设计目标（来自真实反馈）
 * -----------------------
 * 原来的问题：一上来就要填日期、时间、类型、名称、地点、备注 6 个字段，
 * 但用户手上可能只有一张华医通的截图，或者只有一句"下周三查血"。
 *
 * 现在改成：
 *   1. 一句话输入框（核心）—— 直接写"下周三查血"，系统自己解析日期和类型
 *   2. 可贴图（华医通截图、检查单照片）
 *   3. 日期/时间/地点等细节默认折叠，缺了才提醒补
 */

import * as db from './db.js';
import {
  el, toast, today, fmtYMD, weekday, openSheet, closeSheet, confirmAsk, addDays,
} from './utils.js';
import { APPT_TYPES, APPT_TYPE_INDEX } from './catalog.js';
import { typeMeta } from './plan.js';

/* ---------- 依赖注入 ---------- */

// app.js 启动时注入，避免循环依赖
let _reload = async () => {};
let _render = () => {};

export function initQuickAppt({ reload, render }) {
  _reload = reload || _reload;
  _render = render || _render;
}

async function afterChange() {
  await _reload();
  _render();
}

/* ---------- 中文日期解析 ---------- */

const WEEKDAY_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

/**
 * 从一句话里解析出日期
 * 支持：今天/明天/后天/下周三/周三/本周五/10月28日/10-28/2026-10-28/28号
 */
export function parseDateFromText(text, baseDate = today()) {
  const s = String(text || '');
  const base = parseYmdLocal(baseDate);

  const fmt = (d) => {
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  // 完整日期 2026-10-28 / 2026/10/28
  let m = s.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }

  // 10月28日 / 10-28 / 10/28
  m = s.match(/(\d{1,2})[-/月](\d{1,2})[日号]?/);
  if (m) {
    const mo = Number(m[1]), da = Number(m[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      let y = base.getFullYear();
      const d = new Date(y, mo - 1, da);
      // 如果这个日期已经过去很久，推断是明年
      if (d.getTime() < base.getTime() - 180 * 86400000) y += 1;
      return fmt(new Date(y, mo - 1, da));
    }
  }

  // 28号（本月或下月）
  m = s.match(/(\d{1,2})[日号]/);
  if (m) {
    const da = Number(m[1]);
    if (da >= 1 && da <= 31) {
      let d = new Date(base.getFullYear(), base.getMonth(), da);
      if (d.getTime() < base.getTime()) {
        d = new Date(base.getFullYear(), base.getMonth() + 1, da);
      }
      return fmt(d);
    }
  }

  // 相对日
  if (/大后天/.test(s)) return fmt(addDaysLocal(base, 3));
  if (/后天/.test(s)) return fmt(addDaysLocal(base, 2));
  if (/明天|明日/.test(s)) return fmt(addDaysLocal(base, 1));
  if (/今天|今日/.test(s)) return fmt(base);

  // 下周X / 本周X / 周X
  // 注意顺序：先匹配带前缀的，再匹配裸的周X
  m = s.match(/(下下|下|本|这)周([一二三四五六日天])/);
  if (m) {
    const prefix = m[1];
    const targetWd = WEEKDAY_MAP[m[2]];
    // 转成「周一=0 … 周日=6」的序号，符合中文习惯（周日记作周末最后一天）
    const toIdx = (d) => (d === 0 ? 6 : d - 1);
    const curIdx = toIdx(base.getDay());
    const tgtIdx = toIdx(targetWd);
    // 与本周一的天数差
    const mondayOffset = -curIdx;

    if (prefix === '下下') {
      return fmt(addDaysLocal(base, mondayOffset + 7 * 2 + tgtIdx));
    }
    if (prefix === '下') {
      return fmt(addDaysLocal(base, mondayOffset + 7 + tgtIdx));
    }
    // 本 / 这：这一周的周X，可能已经过去
    return fmt(addDaysLocal(base, mondayOffset + tgtIdx));
  }

  // 裸的「周X」：取未来最近的（含今天）
  m = s.match(/周([一二三四五六日天])/);
  if (m) {
    const targetWd = WEEKDAY_MAP[m[1]];
    const curWd = base.getDay();
    let diff = targetWd - curWd;
    if (diff < 0) diff += 7;   // 今天就是的话不变
    return fmt(addDaysLocal(base, diff));
  }

  return null;
}

function parseYmdLocal(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDaysLocal(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/** 从一句话里推断类型 */
export function guessType(text) {
  const s = String(text || '');
  if (/化疗/.test(s)) return 'chemo';
  if (/放疗/.test(s)) return 'radio';
  if (/免疫|PD-?1|帕博利珠|信迪利|替雷利/.test(s)) return 'immuno';
  if (/抽血|查血|血常规|肝肾功|化验|复查|检查|CT|核磁|MRI|B超|超声|PET/.test(s)) return 'test';
  if (/住院|门诊|挂号|复诊|看医生/.test(s)) return 'visit';
  if (/升白针|打针|注射/.test(s)) return 'shot';
  return 'other';
}

/** 从一句话里提取可能的时间 HH:MM */
export function parseTimeFromText(text) {
  const s = String(text || '');
  let m = s.match(/(\d{1,2})[:：](\d{2})/);
  if (m) {
    const h = Number(m[1]), mi = Number(m[2]);
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
      return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    }
  }
  // 上午9点 / 下午2点半
  m = s.match(/(上午|早上|下午|晚上|中午)?\s*(\d{1,2})\s*点\s*(半|\d{1,2}分?)?/);
  if (m) {
    let h = Number(m[2]);
    const period = m[1] || '';
    if (/下午|晚上/.test(period) && h < 12) h += 12;
    if (/中午/.test(period) && h < 11) h += 12;
    let mi = 0;
    if (m[3] === '半') mi = 30;
    else if (m[3]) mi = Number(String(m[3]).replace(/[^\d]/g, '')) || 0;
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  return null;
}

/* ---------- 极简录入面板 ---------- */

export function openQuickApptSheet(existing) {
  const isEdit = !!existing;
  const state = {
    id: existing?.id || null,
    date: existing?.date || '',
    time: existing?.time || '',
    type: existing?.type || '',
    title: existing?.title || '',
    place: existing?.place || '',
    note: existing?.note || '',
    photo: existing?.photo || '',
  };

  const body = el('div', {});

  // ===== 核心：一句话 =====
  const quick = el('textarea', {
    placeholder: '直接写就行，比如：\n下周三查血\n28号上午去华西复查\n11月12日第2周期化疗',
    style: 'min-height:78px;font-size:16px;line-height:1.6',
  });
  quick.value = isEdit ? state.title : '';
  body.append(el('div', { class: 'field' }, [
    el('label', { text: isEdit ? '这件事是什么' : '一句话说清是什么事' }),
    quick,
  ]));

  // 实时解析提示
  const hint = el('div', { style: 'margin:-6px 0 12px' });
  const updateHint = () => {
    hint.replaceChildren();
    const txt = quick.value.trim();
    if (!txt) return;

    const d = parseDateFromText(txt);
    const t = parseTimeFromText(txt);
    const ty = guessType(txt);

    const bits = [];
    if (d) bits.push(`日期 ${fmtYMD(d)} 周${weekday(d)}`);
    if (t) bits.push(`时间 ${t}`);
    if (ty !== 'other') bits.push(`类型 ${APPT_TYPE_INDEX.get(ty)?.name}`);

    if (bits.length) {
      hint.append(el('div', {
        class: 'alert info compact',
        style: 'padding:8px 12px;margin-bottom:8px',
      }, [
        el('span', { class: 'ico' }, '✓'),
        el('span', { class: 'txt' }, '认出来了：' + bits.join('，')),
      ]));
    } else if (txt.length > 3) {
      hint.append(el('div', {
        class: 'alert warn compact',
        style: 'padding:8px 12px;margin-bottom:8px',
      }, [
        el('span', { class: 'ico' }, '?'),
        el('span', { class: 'txt' }, '没认出日期，下面手动选一下'),
      ]));
    }
  };
  quick.addEventListener('input', updateHint);
  body.append(hint);
  if (isEdit) updateHint();

  // ===== 日期时间：默认展开但紧凑 =====
  const dateRow = el('div', { class: 'grid2' });
  const fDate = el('input', { type: 'date', value: state.date || today() });
  const fTime = el('input', { type: 'time', value: state.time || '' });
  dateRow.append(el('div', { class: 'field', style: 'margin-bottom:0' }, [
    el('label', { text: '日期' }), fDate,
  ]));
  dateRow.append(el('div', { class: 'field', style: 'margin-bottom:0' }, [
    el('label', { text: '时间（可不填）' }), fTime,
  ]));
  body.append(el('div', { style: 'margin:12px 0' }, dateRow));

  // 一句话改了就同步到日期
  quick.addEventListener('blur', () => {
    const d = parseDateFromText(quick.value);
    if (d) fDate.value = d;
    const t = parseTimeFromText(quick.value);
    if (t) fTime.value = t;
  });

  // ===== 类型 =====
  const typeSeg = el('div', { class: 'seg' });
  const setType = (id) => {
    state.type = id;
    typeSeg.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.t === id ? 'true' : 'false');
    });
  };
  for (const t of APPT_TYPES) {
    const b = el('button', { type: 'button', 'data-t': t.id, 'aria-pressed': 'false' }, t.name);
    b.addEventListener('click', () => setType(t.id));
    typeSeg.append(b);
  }
  if (state.type) setType(state.type);
  else setType(guessType(quick.value.trim()) || 'test');

  // 类型跟着文字自动走
  quick.addEventListener('input', () => {
    const g = guessType(quick.value.trim());
    if (g !== 'other') setType(g);
  });

  body.append(el('div', { class: 'field' }, [el('label', { text: '类型' }), typeSeg]));

  // ===== 可折叠的细节 =====
  const detailWrap = el('div', { style: 'display:none' });

  const fPlace = el('input', { type: 'text', value: state.place || '', placeholder: '比如：华西医院 门诊3楼 / 检验科' });
  detailWrap.append(el('div', { class: 'field' }, [el('label', { text: '地点' }), fPlace]));

  // 贴图
  let photoData = state.photo || '';
  const photoPreview = el('div', {});
  const renderPhoto = () => {
    photoPreview.replaceChildren();
    if (photoData) {
      photoPreview.append(el('div', { style: 'position:relative;display:inline-block;margin-top:6px' }, [
        el('img', {
          src: photoData,
          style: 'max-width:100%;max-height:180px;border-radius:10px;border:1px solid var(--line);display:block',
        }),
        el('button', {
          type: 'button',
          style: 'position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;'
            + 'border:0;background:rgba(15,36,48,.7);color:#fff;font-size:15px;line-height:1;cursor:pointer',
          onclick: (e) => { e.preventDefault(); photoData = ''; renderPhoto(); },
        }, '×'),
      ]));
    }
  };
  renderPhoto();

  const file = el('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      photoData = await shrinkImageFile(f, 1100, 0.75);
      renderPhoto();
      toast('图片已加上');
    } catch { toast('图片处理失败'); }
  });

  detailWrap.append(el('div', { class: 'field' }, [
    el('label', { text: '截图 / 照片（可选）' }),
    el('button', {
      class: 'btn block sm', type: 'button',
      onclick: () => file.click(),
    }, photoData ? '换一张图' : '拍华医通截图或单子'),
    file,
    photoPreview,
    el('div', { class: 'help' }, '可以贴预约截图、检查单，以后翻起来有据可查'),
  ]));

  const fNote = el('textarea', { placeholder: '要带的东西、空腹要求、注意事项…' });
  fNote.value = state.note || '';
  detailWrap.append(el('div', { class: 'field' }, [el('label', { text: '备注' }), fNote]));

  body.append(detailWrap);

  // 展开/收起细节
  const toggle = el('button', {
    class: 'btn block sm', type: 'button',
    style: 'margin-bottom:8px',
  }, '补充细节（地点、截图、备注）');
  toggle.addEventListener('click', () => {
    const open = detailWrap.style.display !== 'none';
    detailWrap.style.display = open ? 'none' : 'block';
    toggle.textContent = open ? '补充细节（地点、截图、备注）' : '收起细节';
  });
  if (isEdit && (state.place || state.note || state.photo)) {
    detailWrap.style.display = 'block';
    toggle.textContent = '收起细节';
  }
  body.append(toggle);

  // 删
  if (isEdit) {
    body.append(el('button', {
      class: 'btn block sm danger', style: 'margin-top:8px',
      onclick: async () => {
        if (await confirmAsk('删掉这条日程？')) {
          await db.del('appointments', existing.id);
          await afterChange();
          closeSheet();
          toast('已删除');
        }
      },
    }, '删除这条'));
  }

  // ===== 保存 =====
  const save = async () => {
    const text = quick.value.trim();
    let title = text;

    // 如果只有日期没内容，用类型名
    if (!title) {
      title = APPT_TYPE_INDEX.get(state.type)?.name || '安排';
    }

    // 去掉标题里的日期部分，让标题干净些
    title = title.replace(/^(今天|明天|后天|大后天|下+周[一二三四五六日天]|本?周[一二三四五六日天]|\d{1,2}[月\-/]\d{1,2}[日号]?)\s*/, '').trim();
    if (!title) title = APPT_TYPE_INDEX.get(state.type)?.name || '安排';

    const rec = {
      id: state.id || db.uid(),
      date: fDate.value || today(),
      time: fTime.value || '',
      type: state.type || 'other',
      title: title.slice(0, 120),
      place: fPlace.value.trim(),
      note: fNote.value.trim(),
      photo: photoData,
      done: existing?.done || false,
    };

    await db.put('appointments', rec);
    await afterChange();
    closeSheet();

    // 缺细节就提醒补，但不强制
    const missing = [];
    if (!rec.time) missing.push('具体时间');
    if (!rec.place) missing.push('地点');
    if (!rec.photo && rec.type === 'test') missing.push('检查单截图');
    if (missing.length) {
      setTimeout(() => {
        openIncompleteSheet(rec, missing);
      }, 260);
    } else {
      toast('已添加');
    }
  };

  openSheet({
    title: isEdit ? '修改日程' : '加一件事',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '取消'),
      el('button', { class: 'btn primary', onclick: save }, isEdit ? '保存' : '添加'),
    ],
  });

  // 自动聚焦
  setTimeout(() => quick.focus(), 120);
}

/** 缺细节时的温和提醒 */
function openIncompleteSheet(rec, missing) {
  const body = el('div', {});
  body.append(el('div', { class: 'alert info' }, [
    el('div', { class: 't' }, '已添加'),
    el('div', { class: 'tiny', style: 'margin-top:4px;line-height:1.7' },
      `${fmtYMD(rec.date)} · ${rec.title}`),
  ]));

  body.append(el('div', { class: 'section-title' }, '还可以补充'));
  const c = el('div', { class: 'card plain' });
  for (const m of missing) {
    const row = el('div', { style: 'padding:7px 0;display:flex;gap:8px;align-items:center' });
    row.append(el('span', { style: 'color:var(--warn);font-size:15px' }, '·'));
    row.append(el('span', { style: 'font-size:var(--fs-xs);color:var(--ink-2);flex:1' }, m));
    c.append(row);
  }
  body.append(c);

  body.append(el('div', { class: 'tiny muted', style: 'margin-top:10px;line-height:1.7' },
    '不补也行，以后想加随时点进去改。补了到时间提醒时更有用。'));

  openSheet({
    title: '补一下会更准',
    body,
    footer: [
      el('button', { class: 'btn', onclick: () => { closeSheet(); toast('好的'); } }, '不用了'),
      el('button', {
        class: 'btn primary',
        onclick: () => { closeSheet(); openQuickApptSheet(rec); },
      }, '现在补'),
    ],
  });
}


/** 压缩图片，避免撑爆存储 */
function shrinkImageFile(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
