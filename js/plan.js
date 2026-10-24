/**
 * 日程推算引擎
 *
 * 目标：录一次治疗方案，自动往后排 6 个月的所有关键日子。
 * 规则全部按常见临床节奏写，医生改了方案用户在设置里改参数即可。
 */

import { today, addDays, daysBetween, parseYmd } from './utils.js';
import { APPT_TYPE_INDEX } from './catalog.js';

/**
 * 根据方案参数生成日程草稿（不写库，交给界面确认）
 * @param {object} p profile
 * @param {string} anchor 起始日（本轮化疗第1天）
 * @param {number} cycles 生成几个周期
 */
export function buildCyclePlan(p, anchor, cycles = 6) {
  const out = [];
  const cycleDays = Number(p.chemoCycleDays) || 21;

  for (let i = 0; i < cycles; i++) {
    const d1 = addDays(anchor, i * cycleDays);
    const round = i + 1;

    // 化疗给药日（Day 1）
    out.push({
      date: d1,
      type: 'chemo',
      title: `化疗 第${round}周期 D1`,
      time: '',
      place: p.hospital || '',
      note: `第 ${round}/${cycles} 周期`,
      auto: true,
      key: `chemo-${d1}`,
    });

    // 化疗后 3-5 天查血常规（看骨髓抑制最低点前后）
    out.push({
      date: addDays(d1, 3),
      type: 'test',
      title: '血常规（化疗后 D4）',
      note: '看白细胞和中性粒细胞掉到什么程度',
      auto: true,
      key: `cbc-${d1}-3`,
    });

    // 化疗后 7-10 天，多数方案这时是骨髓抑制最低点
    out.push({
      date: addDays(d1, 8),
      type: 'test',
      title: '血常规（化疗后 D9，最低点）',
      note: '中性粒细胞常在这附近最低，掉到 1.0 以下问医生要不要打升白针',
      auto: true,
      key: `cbc-${d1}-8`,
    });

    // 下一周期前 1-2 天查血 + 肝肾功能
    if (i < cycles - 1) {
      out.push({
        date: addDays(d1, cycleDays - 1),
        type: 'test',
        title: `下周期前检查（血常规+肝肾功）`,
        note: '指标不合格可能需要推迟化疗',
        auto: true,
        key: `pre-${d1}`,
      });
    }
  }

  // 免疫治疗：按周期给药，通常比化疗周期长
  const immDays = Number(p.immunoCycleDays) || 21;
  if (immDays > 0 && p.immuno !== false) {
    for (let i = 0; i < cycles; i++) {
      const d = addDays(anchor, i * immDays);
      out.push({
        date: d,
        type: 'immuno',
        title: `免疫治疗 第${i + 1}次`,
        note: '免疫治疗按固定间隔给药，尽量不要拖',
        auto: true,
        key: `imm-${d}`,
      });
    }
  }

  // 免疫治疗相关复查：甲功、血糖常 6-8 周一次
  const immSpan = (cycles - 1) * immDays;
  for (let d = 42; d <= immSpan; d += 42) {
    out.push({
      date: addDays(anchor, d),
      type: 'test',
      title: '免疫治疗随访（甲功+血糖）',
      note: '免疫性甲状腺炎和免疫性糖尿病是常见副作用，早发现好处理',
      auto: true,
      key: `immfu-${d}`,
    });
  }

  // 疗效评估：一般 2-3 周期后做一次影像
  for (let i = 2; i < cycles; i += 2) {
    const d = addDays(anchor, i * cycleDays - 2);
    out.push({
      date: d,
      type: 'test',
      title: `疗效评估（第${i}周期后影像复查）`,
      note: 'CT/MRI 对比病灶大小，带上次片子一起去',
      auto: true,
      key: `eval-${i}`,
    });
  }

  return out;
}

/** 放疗：按每个工作日一次，跳过周六日 */
export function buildRadioPlan(startDate, total, hospital = '') {
  const out = [];
  let d = startDate;
  let n = 0;
  const totalN = Math.max(1, Number(total) || 0);
  let guard = 0;
  while (n < totalN && guard < totalN * 3) {
    guard++;
    const wd = parseYmd(d).getDay();
    if (wd !== 0 && wd !== 6) {
      n++;
      out.push({
        date: d,
        type: 'radio',
        title: `放疗 第${n}/${totalN}次`,
        note: n === 1 ? '首次放疗，通常时间较长' : '',
        place: hospital,
        auto: true,
        key: `radio-${n}`,
      });
    }
    d = addDays(d, 1);
  }
  return out;
}

/** 把草稿合并进已有日程，已存在同 key 的跳过 */
export function mergePlan(existing, drafts) {
  const seen = new Set(existing.filter((a) => a.key).map((a) => a.key));
  const seenDateType = new Set(existing.map((a) => `${a.date}|${a.type}|${a.title}`));
  const add = [];
  for (const d of drafts) {
    if (d.key && seen.has(d.key)) continue;
    if (seenDateType.has(`${d.date}|${d.type}|${d.title}`)) continue;
    add.push(d);
  }
  return add;
}

/** 从日程里推算「下一个要关注的日子」 */
export function nextAppointment(appts, from = today()) {
  const upcoming = appts
    .filter((a) => a.date >= from && !a.done)
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] || null;
}

/** 已完成的化疗周期数 */
export function chemoRoundsDone(appts) {
  return appts.filter((a) => a.type === 'chemo' && a.done).length;
}

/** 距离下次复查还有多久（找 test 类） */
export function nextTest(appts, from = today()) {
  return appts
    .filter((a) => a.date >= from && a.type === 'test' && !a.done)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

/** 最近一次做过的同类日程 */
export function lastDone(appts, type, from = today()) {
  return appts
    .filter((a) => a.type === type && a.done && a.date <= from)
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

/** 按天聚合，给日历用 */
export function groupByDate(appts) {
  const m = new Map();
  for (const a of appts) {
    if (!m.has(a.date)) m.set(a.date, []);
    m.get(a.date).push(a);
  }
  for (const list of m.values()) {
    list.sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
  }
  return m;
}

export function typeMeta(type) {
  return APPT_TYPE_INDEX.get(type) || APPT_TYPE_INDEX.get('other');
}

/** 生成 ICS 日历文件内容，用于导入手机系统日历 */
export function toICS(appts, calName = '治疗日程') {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (s) => {
    const d = parseYmd(s);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  };
  const nowUTC = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//treatment-tracker//ZH//',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icalEscape(calName)}`,
    'X-WR-TIMEZONE:Asia/Shanghai',
  ];

  for (const a of appts) {
    if (a.done) continue;
    const d = stamp(a.date);
    const start = a.time ? `${d}T${a.time.replace(':', '')}00` : `${d}T090000`;
    const end = a.time ? `${d}T${addHour(a.time)}00` : `${d}T100000`;
    const tzSuffix = a.time ? '' : '';
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id || a.key || Math.random().toString(36).slice(2)}@tx-tracker`,
      `DTSTAMP:${nowUTC}`,
      a.time ? `DTSTART;TZID=Asia/Shanghai:${start}` : `DTSTART;VALUE=DATE:${d}`,
      a.time ? `DTEND;TZID=Asia/Shanghai:${end}` : `DTEND;VALUE=DATE:${d}`,
      `SUMMARY:${icalEscape(a.title || '治疗')}`,
      a.place ? `LOCATION:${icalEscape(a.place)}` : '',
      `DESCRIPTION:${icalEscape([a.note, '由治疗跟进生成'].filter(Boolean).join('\\n'))}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT15H',   // 前一天 18:00 左右提醒（相对 9 点事件）
      'ACTION:DISPLAY',
      `DESCRIPTION:${icalEscape('明天：' + (a.title || '治疗'))}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.filter((x) => x !== '').join('\r\n');
}

function addHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const nh = (h + 1) % 24;
  return `${String(nh).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

function icalEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** 未来 N 天内需要推送的提醒项（供云端定时任务使用） */
export function buildReminderPayload(appts, profile, daysAhead = 14) {
  const from = today();
  const until = addDays(from, daysAhead);
  const items = appts
    .filter((a) => !a.done && a.date >= from && a.date <= until)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((a) => ({
      date: a.date,
      time: a.time || '',
      type: a.type,
      title: a.title,
      place: a.place || '',
      daysLeft: daysBetween(from, a.date),
    }));
  return { generatedAt: new Date().toISOString(), patient: profile.name || '', items };
}
