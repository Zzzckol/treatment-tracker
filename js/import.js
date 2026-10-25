/**
 * 资料导入：把 AI 整理好的结构化数据包导入本地库
 *
 * 设计思路
 * ---------
 * 照片识别放在网页外做（用 AI 读图），网页只负责：
 *   1. 给出「怎么把照片交给 AI」的清晰指引
 *   2. 接收整理好的 JSON，逐条预览，让你确认后再写入
 *
 * 这样做是因为浏览器里做 OCR 准确率不可接受 —— 化验单上
 * 0/O、1/l、小数点丢失都会导致数据错误，而错的数据比没数据更危险。
 */

import * as db from './db.js';
import {
  el, toast, today, fmtYMD, openSheet, closeSheet, download,
} from './utils.js';
import { LAB_INDEX, judge, SYMPTOM_INDEX, DOC_KINDS } from './catalog.js';

/* ---------- 导出提示词：让用户复制给 AI ---------- */

export function buildExtractPrompt() {
  return `你是一个医疗资料整理助手。我会给你若干张与肿瘤治疗相关的照片（化验单、病历、出院小结、影像报告、处方等）。

请逐张识别，然后输出一个 JSON，格式严格如下，不要加任何解释文字、不要用 markdown 代码块包裹：

{
  "profile": {
    "name": "患者姓名，认不出就留空字符串",
    "sex": "男 或 女 或 空",
    "birth": "YYYY-MM-DD 或 空",
    "diagnosis": "诊断，如 肺腺癌",
    "stage": "分期，如 IIIB期 或 空",
    "hospital": "主要医院",
    "dept": "科室",
    "doctor": "主治医生姓名，认不出留空",
    "chemoCycleDays": 21,
    "immunoCycleDays": 21,
    "radioTotal": 0
  },
  "labs": [
    {
      "date": "YYYY-MM-DD",
      "values": { "WBC": 5.2, "NEUT": 3.1, "HGB": 128 },
      "note": "这张单子是什么时候的，如 第3周期化疗后"
    }
  ],
  "appointments": [
    { "date": "YYYY-MM-DD", "type": "chemo", "title": "化疗 第3周期 D1", "time": "09:00", "place": "肿瘤内科", "note": "" }
  ],
  "docs": [
    { "date": "YYYY-MM-DD", "kind": "影像报告", "title": "第3周期后胸腹部CT", "hospital": "省肿瘤医院", "summary": "关键结论摘要" }
  ],
  "symptoms": [
    { "date": "YYYY-MM-DD", "temp": 37.2, "weight": 62, "scores": { "nausea": 2, "fatigue": 1 }, "note": "" }
  ]
}

重要规则：

1. labs.values 的键必须用下面这套代码，只填照片上真实出现的项，没有的就不要写：
   WBC 白细胞, NEUT 中性粒细胞绝对值, HGB 血红蛋白, PLT 血小板, LYMPH 淋巴细胞, MONO 单核细胞, RBC 红细胞, HCT 红细胞压积,
   ALT 丙氨酸氨基转移酶, AST 天门冬氨酸氨基转移酶, TBIL 总胆红素, ALB 白蛋白, GGT γ-谷氨酰转肽酶, ALP 碱性磷酸酶, DBIL 直接胆红素,
   CREA 肌酐, UREA 尿素, UA 尿酸, eGFR 估算肾小球滤过率, CYSC 胱抑素C,
   K 钾, NA 钠, CL 氯, CA 钙, MG 镁,
   CRP C反应蛋白, PCT 降钙素原, ESR 血沉,
   TSH 促甲状腺激素, FT4 游离甲状腺素, FT3 游离三碘甲状腺原氨酸,
   GLU 空腹血糖, HBA1C 糖化血红蛋白,
   CEA 癌胚抗原, CA199 CA19-9, CA125, AFP 甲胎蛋白, CYFRA CYFRA21-1, NSE, SCC, PSA

2. 数值一律用数字，不要带单位、不要带箭头、不要带 < 或 >。如果原单写 "<0.05"，填 0.05。
3. 日期统一转成 YYYY-MM-DD。只有年月就填该月 01 日。
4. appointments.type 只能是：chemo 化疗 / radio 放疗 / immuno 免疫治疗 / test 抽血复查 / shot 打针 / visit 门诊住院 / other 其他
5. symptoms.scores 的键只能是：nausea 恶心, vomit 呕吐, appetite 食欲下降, diarrhea 腹泻, constipation 便秘, mouth 口腔溃疡, taste 味觉改变, fatigue 乏力, fever 发热, pain 疼痛, sleep 睡眠差, dizzy 头晕, weight 体重下降, rash 皮疹, itch 瘙痒, handfoot 手足麻木, hair 脱发, skin 皮肤发黄, cough 咳嗽, dyspnea 气短, palp 心慌, edema 水肿, numb 手脚麻木, memory 记性差, polyuria 口干多尿, cold 怕冷浮肿, mood 情绪低落。值是 0-3 的整数（0无 1轻 2中 3重）
6. docs.kind 只能是：${DOC_KINDS.join(' / ')}
7. 认不出的字段一律留空字符串或省略该项，**绝对不要猜测或编造数值**。宁可少填，不要填错。
8. 如果照片里没有某类信息，对应的数组就写 []。
9. **输出要紧凑**：不要缩进、不要换行美化，用最紧凑的 JSON 单行格式，减少长度。
10. 如果内容太多（超过 3000 字），**先只输出 profile 和 labs 两部分**，然后问我是否继续；不要一次输出全部导致被截断。

只输出 JSON，不要任何其他内容。不要用 \`\`\` 包裹。`;
}

/* ---------- 校验导入数据 ---------- */

const APPT_TYPES_OK = ['chemo', 'radio', 'immuno', 'test', 'shot', 'visit', 'other'];

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  // 关键：用 UTC 构造反查，避免 Date 把 2月30日自动顺延成 3月2日
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export /** 各项目的生物学合理上限，用于拦截 OCR 误识（如把 10.8 认成 1080） */
const SANE_MAX = {
  WBC: 500, NEUT: 400, LYMPH: 300, MONO: 100, RBC: 15, HGB: 300, HCT: 80, PLT: 2000,
  ALT: 10000, AST: 10000, TBIL: 1500, DBIL: 1000, ALB: 90, GGT: 10000, ALP: 5000,
  CREA: 3000, UREA: 200, UA: 2000, eGFR: 300, CYSC: 50,
  K: 15, NA: 200, CL: 200, CA: 10, MG: 10,
  CRP: 1000, PCT: 500, ESR: 300,
  TSH: 200, FT4: 200, FT3: 100,
  GLU: 100, HBA1C: 30,
  CEA: 100000, CA199: 100000, CA125: 100000, AFP: 1000000,
  CYFRA: 10000, NSE: 10000, SCC: 10000, PSA: 100000,
  PT: 200, INR: 20, APTT: 300, FIB: 30, DD: 200,
  SIZE: 1000,
};

/* ---------- JSON 容错解析 ---------- */

/**
 * 去掉 AI 回复里的包裹物：markdown 代码块、前后说明文字。
 * AI 经常回「好的，我整理好了：```json {...} ``` 以上是结果」这种。
 */
function extractJSON(text) {
  let s = String(text || '').trim();
  // 去掉 markdown 围栏（可能有多段）
  s = s.replace(/```(?:json|JSON|javascript|js)?\s*/g, '').replace(/```/g, '');
  // 从第一个 { 或 [ 开始，到最后一个 } 或 ] 结束
  const first = s.search(/[{[]/);
  if (first === -1) return s;
  const lastBrace = s.lastIndexOf('}');
  const lastBracket = s.lastIndexOf(']');
  const last = Math.max(lastBrace, lastBracket);
  if (last > first) return s.slice(first, last + 1);
  return s.slice(first);
}

/** 重新扫描一段文本的结构状态 */
function scanStructure(t) {
  let inString = false;
  let escape = false;
  const stack = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  return { inString, stack, escape };
}

/**
 * 尝试把被截断的 JSON 补成合法结构。
 *
 * 背景：手机复制长文本很容易被截断（微信/输入框都有长度限制），
 * 用户看到的报错是 "Unterminated string"。
 *
 * 策略：闭合未完成的字符串 → 补齐未闭合的括号 → 逐步回退到能解析的位置。
 * 只修补，不猜测内容：不补任何数据，只补结构符号。
 */
function repairJSON(text) {
  const base = extractJSON(text).trim();
  if (!base) return null;

  const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      // 只接受对象，避免把 [1,2,3 这种碎片当成有效数据
      return isPlainObject(v) ? v : null;
    } catch {
      return null;
    }
  };

  // 快速路径：本身就能解析
  const direct = tryParse(base);
  if (direct) return direct;

  const closeAll = (s) => {
    const st = scanStructure(s);
    let out = s + (st.inString ? '"' : '');
    const st2 = scanStructure(out);
    for (let i = st2.stack.length - 1; i >= 0; i--) {
      out += st2.stack[i] === '{' ? '}' : ']';
    }
    return out;
  };

  // 第一轮：直接闭合
  const c1 = tryParse(closeAll(base));
  if (c1) return c1;

  // 第二轮：逐步回退，找最长的可闭合前缀
  const maxBack = Math.min(base.length, 600);
  for (let back = 1; back <= maxBack; back++) {
    let head = base.slice(0, base.length - back).trimEnd();
    // 去掉尾部悬挂的逗号、冒号、或没写完的 key
    head = head.replace(/[,:]\s*$/, '').trimEnd();
    head = head.replace(/,?\s*"[^"]*$/, '').trimEnd(); // 半个 key
    head = head.replace(/[,:]\s*$/, '').trimEnd();
    if (!head) break;
    const c = tryParse(closeAll(head));
    if (c) return c;
  }

  return null;
}

/** 从错误信息判断大概原因，给用户能操作的提示 */
function diagnoseJSONError(raw) {
  const s = String(raw || '');
  if (!s.trim()) return '内容是空的。检查一下是不是没粘贴进去。';

  const firstBrace = s.search(/[{[]/);
  const lastBrace = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  const { stack, inString } = scanStructure(s);
  const looksTruncated = firstBrace !== -1 && lastBrace <= firstBrace;
  const unbalanced = stack.length > 0 || inString;
  const hasMarkdown = /```/.test(s);

  if (looksTruncated || unbalanced) {
    return [
      '内容看起来被截断了，复制过来的不是完整的一段。',
      '手机上长文本确实容易这样，有三个办法：',
      '一，让 AI 分几次输出（跟它说「分两段发，每段不超过 2000 字」）；',
      '二，先复制到备忘录或记事本，再从那里全选复制过来；',
      '三，只保留一部分粘贴，剩下的下次再导入。',
    ].join('');
  }
  if (firstBrace === -1) {
    return '这段内容里没有找到 JSON。确认复制的是 AI 返回的结果，而不是它说的话。结果应该从 { 开始。';
  }
  if (hasMarkdown) {
    return '内容里带了 markdown 代码块标记，已经尝试清理但没成功。只复制大括号 {} 之间的部分试试。';
  }
  return '内容不是合法的 JSON。确认复制的是完整的 AI 返回结果，开头应该是 { 结尾是 }。如果 AI 在 JSON 前后加了说明文字，去掉那些字只留 JSON。';
}

export function validateBundle(raw) {
  const errors = [];
  const warnings = [];
  let data;

  if (typeof raw !== 'string') {
    data = raw;
  } else {
    // 先尝试直接解析，失败再走容错
    try {
      data = JSON.parse(raw);
    } catch (directErr) {
      const repaired = repairJSON(raw);
      if (repaired) {
        data = repaired;
        warnings.push('粘贴的内容不完整或带了多余文字，已自动修复后导入。请仔细核对下面的明细，确认没有漏项。');
      } else {
        // 错误信息用中文说人话，不暴露原始英文异常
        errors.push(diagnoseJSONError(raw));
        return { ok: false, errors, warnings, data: null };
      }
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['内容不是一个 JSON 对象（应该以 { 开头）'], warnings, data: null };
  }

  const out = { profile: {}, labs: [], appointments: [], docs: [], symptoms: [] };

  // profile
  if (data.profile && typeof data.profile === 'object') {
    const p = data.profile;
    const allowed = ['name', 'sex', 'birth', 'diagnosis', 'stage', 'hospital', 'dept',
      'doctor', 'doctorPhone', 'nursePhone', 'chemoCycleDays', 'immunoCycleDays', 'radioTotal'];
    for (const k of allowed) {
      if (p[k] === undefined || p[k] === null || p[k] === '') continue;
      if (['chemoCycleDays', 'immunoCycleDays', 'radioTotal'].includes(k)) {
        const n = Number(p[k]);
        if (Number.isFinite(n) && n >= 0) out.profile[k] = n;
        else warnings.push(`profile.${k} 不是有效数字，已跳过`);
      } else if (k === 'birth' && !isValidDate(p[k])) {
        warnings.push('profile.birth 日期格式不对，已跳过');
      } else {
        out.profile[k] = String(p[k]).slice(0, 200);
      }
    }
  }

  // labs
  if (Array.isArray(data.labs)) {
    data.labs.forEach((row, i) => {
      if (!row || !isValidDate(row.date)) {
        warnings.push(`第 ${i + 1} 张化验单日期无效，已跳过`);
        return;
      }
      const values = {};
      let n = 0;
      for (const [code, v] of Object.entries(row.values || {})) {
        if (!LAB_INDEX.has(code)) {
          warnings.push(`未知化验项目代码 "${code}"，已忽略`);
          continue;
        }
        const num = Number(v);
        if (!Number.isFinite(num)) {
          warnings.push(`${code} 的值 "${v}" 不是数字，已忽略`);
          continue;
        }
        // 合理性护栏：防止 OCR 把 10.8 认成 1080 这类错误
        const cap = SANE_MAX[code] ?? 100000;
        if (num < 0 || num > cap) {
          warnings.push(`${code}=${num} 超出可能的范围（上限 ${cap}），已忽略，请对照原单手工填`);
          continue;
        }
        values[code] = num;
        n++;
      }
      if (n) out.labs.push({ date: row.date, values, note: String(row.note || '').slice(0, 300) });
      else warnings.push(`${row.date} 的化验单没有任何有效数值，已跳过`);
    });
  }

  // appointments
  if (Array.isArray(data.appointments)) {
    data.appointments.forEach((row, i) => {
      if (!row || !isValidDate(row.date)) {
        warnings.push(`第 ${i + 1} 条日程日期无效，已跳过`);
        return;
      }
      const type = APPT_TYPES_OK.includes(row.type) ? row.type : 'other';
      out.appointments.push({
        date: row.date,
        type,
        title: String(row.title || '').slice(0, 120) || '治疗安排',
        time: /^\d{2}:\d{2}$/.test(row.time || '') ? row.time : '',
        place: String(row.place || '').slice(0, 120),
        note: String(row.note || '').slice(0, 300),
        done: false,
      });
    });
  }

  // docs
  if (Array.isArray(data.docs)) {
    data.docs.forEach((row, i) => {
      if (!row || !isValidDate(row.date)) {
        warnings.push(`第 ${i + 1} 条资料日期无效，已跳过`);
        return;
      }
      out.docs.push({
        date: row.date,
        kind: DOC_KINDS.includes(row.kind) ? row.kind : '其他',
        title: String(row.title || '').slice(0, 200) || '资料',
        hospital: String(row.hospital || '').slice(0, 120),
        summary: String(row.summary || '').slice(0, 2000),
        photo: '',
      });
    });
  }

  // symptoms
  if (Array.isArray(data.symptoms)) {
    data.symptoms.forEach((row, i) => {
      if (!row || !isValidDate(row.date)) {
        warnings.push(`第 ${i + 1} 条症状记录日期无效，已跳过`);
        return;
      }
      const scores = {};
      for (const [k, v] of Object.entries(row.scores || {})) {
        if (!SYMPTOM_INDEX.has(k)) continue;
        const n = Math.round(Number(v));
        if (Number.isFinite(n) && n >= 0 && n <= 3) scores[k] = n;
      }
      const temp = Number(row.temp);
      const weight = Number(row.weight);
      out.symptoms.push({
        date: row.date,
        scores,
        temp: Number.isFinite(temp) && temp > 30 && temp < 45 ? temp : null,
        weight: Number.isFinite(weight) && weight > 20 && weight < 300 ? weight : null,
        note: String(row.note || '').slice(0, 500),
      });
    });
  }

  const total = out.labs.length + out.appointments.length + out.docs.length + out.symptoms.length;
  if (total === 0 && Object.keys(out.profile).length === 0) {
    errors.push('没识别出任何可用数据。检查一下 AI 返回的内容格式是否正确。');
  }

  return { ok: errors.length === 0, errors, warnings, data: out };
}

/* ---------- 写入本地库 ---------- */

export async function applyBundle(bundle) {
  const counts = { profile: 0, labs: 0, appointments: 0, docs: 0, symptoms: 0 };

  if (Object.keys(bundle.profile || {}).length) {
    await db.saveProfile(bundle.profile);
    counts.profile = Object.keys(bundle.profile).length;
  }

  // 化验：同一天同项目已存在则合并，不产生重复记录
  const existingLabs = await db.allByDate('labs');
  for (const row of bundle.labs || []) {
    const same = existingLabs.find((x) => x.date === row.date);
    if (same) {
      same.values = { ...(same.values || {}), ...row.values };
      if (row.note && !same.note) same.note = row.note;
      await db.put('labs', same);
    } else {
      const rec = { id: db.uid(), ...row };
      await db.put('labs', rec);
      existingLabs.push(rec);
    }
    counts.labs++;
  }

  // 日程：同日期+同标题视为重复
  const existingAppts = await db.allByDate('appointments');
  for (const row of bundle.appointments || []) {
    const dup = existingAppts.some((x) => x.date === row.date && x.title === row.title);
    if (dup) continue;
    await db.put('appointments', { id: db.uid(), ...row });
    counts.appointments++;
  }

  for (const row of bundle.docs || []) {
    await db.put('docs', { id: db.uid(), ...row });
    counts.docs++;
  }

  // 症状：同一天已有则合并评分
  const existingSyms = await db.allByDate('symptoms');
  for (const row of bundle.symptoms || []) {
    const same = existingSyms.find((x) => x.date === row.date);
    if (same) {
      same.scores = { ...(same.scores || {}), ...row.scores };
      if (row.temp) same.temp = row.temp;
      if (row.weight) same.weight = row.weight;
      if (row.note && !same.note) same.note = row.note;
      await db.put('symptoms', same);
    } else {
      const rec = { id: db.uid(), ...row };
      await db.put('symptoms', rec);
      existingSyms.push(rec);
    }
    counts.symptoms++;
  }

  return counts;
}
