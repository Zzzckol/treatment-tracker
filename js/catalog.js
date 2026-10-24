/**
 * 检查项目录 + 症状目录
 *
 * 参考区间取自国内三甲医院常用成人参考值，仅作「异常提示」用，
 * 不同医院、不同检测平台会有差异，最终以化验单上印的参考值为准。
 * 用户可在设置里改，但默认值是给「一眼看出红了」服务的，不用于诊断。
 */

/* ---------- 检查项目 ---------- */

export const LAB_PANELS = [
  {
    id: 'cbc',
    name: '血常规',
    hint: '化疗前后必查，主要看骨髓抑制到什么程度',
    items: [
      { code: 'WBC', name: '白细胞', unit: '×10⁹/L', lo: 3.5, hi: 9.5, star: true },
      { code: 'NEUT', name: '中性粒细胞绝对值', unit: '×10⁹/L', lo: 1.8, hi: 6.3, star: true, note: '<1.5 偏低，<1.0 明显抑制，<0.5 属粒细胞缺乏，发热要立刻就医' },
      { code: 'HGB', name: '血红蛋白', unit: 'g/L', lo: 130, hi: 175, star: true, note: '<100 贫血，<80 医生可能考虑输血' },
      { code: 'PLT', name: '血小板', unit: '×10⁹/L', lo: 125, hi: 350, star: true, note: '<100 偏低，<50 有出血风险，注意牙龈出血/皮下瘀斑' },
      { code: 'LYMPH', name: '淋巴细胞绝对值', unit: '×10⁹/L', lo: 1.1, hi: 3.2 },
      { code: 'MONO', name: '单核细胞绝对值', unit: '×10⁹/L', lo: 0.1, hi: 0.6 },
      { code: 'RBC', name: '红细胞', unit: '×10¹²/L', lo: 4.3, hi: 5.8 },
      { code: 'HCT', name: '红细胞压积', unit: '%', lo: 40, hi: 50 },
    ],
  },
  {
    id: 'liver',
    name: '肝功能',
    hint: '化疗药和免疫治疗都可能伤肝，这是常规监测项',
    items: [
      { code: 'ALT', name: '丙氨酸氨基转移酶', unit: 'U/L', lo: 9, hi: 50, star: true, note: '超过正常上限 3 倍通常需要处理，免疫治疗后要更警惕' },
      { code: 'AST', name: '天门冬氨酸氨基转移酶', unit: 'U/L', lo: 15, hi: 40, star: true },
      { code: 'TBIL', name: '总胆红素', unit: 'μmol/L', lo: 3, hi: 22, star: true },
      { code: 'ALB', name: '白蛋白', unit: 'g/L', lo: 40, hi: 55, note: '偏低常提示营养不足，要跟医生聊营养支持' },
      { code: 'GGT', name: 'γ-谷氨酰转肽酶', unit: 'U/L', lo: 10, hi: 60 },
      { code: 'ALP', name: '碱性磷酸酶', unit: 'U/L', lo: 45, hi: 125 },
      { code: 'DBIL', name: '直接胆红素', unit: 'μmol/L', lo: 0, hi: 7 },
    ],
  },
  {
    id: 'renal',
    name: '肾功能',
    hint: '铂类等药物对肾有影响，喝水很重要',
    items: [
      { code: 'CREA', name: '肌酐', unit: 'μmol/L', lo: 57, hi: 97, star: true },
      { code: 'UREA', name: '尿素', unit: 'mmol/L', lo: 3.1, hi: 8.0 },
      { code: 'UA', name: '尿酸', unit: 'μmol/L', lo: 208, hi: 428 },
      { code: 'eGFR', name: '估算肾小球滤过率', unit: 'mL/min', lo: 90, hi: 200 },
      { code: 'CYSC', name: '胱抑素C', unit: 'mg/L', lo: 0.6, hi: 1.1 },
    ],
  },
  {
    id: 'electro',
    name: '电解质',
    hint: '化疗后呕吐、腹泻容易电解质紊乱',
    items: [
      { code: 'K', name: '钾', unit: 'mmol/L', lo: 3.5, hi: 5.3, star: true },
      { code: 'NA', name: '钠', unit: 'mmol/L', lo: 137, hi: 147 },
      { code: 'CL', name: '氯', unit: 'mmol/L', lo: 99, hi: 110 },
      { code: 'CA', name: '总钙', unit: 'mmol/L', lo: 2.11, hi: 2.52 },
      { code: 'MG', name: '镁', unit: 'mmol/L', lo: 0.75, hi: 1.02 },
    ],
  },
  {
    id: 'inflammation',
    name: '炎症指标',
    hint: '发热时看这个判断有没有感染',
    items: [
      { code: 'CRP', name: 'C反应蛋白', unit: 'mg/L', lo: 0, hi: 10, star: true },
      { code: 'PCT', name: '降钙素原', unit: 'ng/mL', lo: 0, hi: 0.05 },
      { code: 'ESR', name: '血沉', unit: 'mm/h', lo: 0, hi: 15 },
    ],
  },
  {
    id: 'thyroid',
    name: '甲状腺功能',
    hint: '免疫治疗最常见的内分泌副作用，通常 6-8 周查一次',
    ireae: true,
    items: [
      { code: 'TSH', name: '促甲状腺激素', unit: 'mIU/L', lo: 0.27, hi: 4.2, star: true, note: '免疫治疗后甲减很常见，表现为乏力、怕冷、浮肿、体重上升' },
      { code: 'FT4', name: '游离甲状腺素', unit: 'pmol/L', lo: 12, hi: 22 },
      { code: 'FT3', name: '游离三碘甲状腺原氨酸', unit: 'pmol/L', lo: 3.1, hi: 6.8 },
    ],
  },
  {
    id: 'glucose',
    name: '血糖',
    hint: '免疫治疗可能引起免疫相关性糖尿病，来得急',
    ireae: true,
    items: [
      { code: 'GLU', name: '空腹血糖', unit: 'mmol/L', lo: 3.9, hi: 6.1, star: true },
      { code: 'HBA1C', name: '糖化血红蛋白', unit: '%', lo: 4, hi: 6 },
    ],
  },
  {
    id: 'tumor',
    name: '肿瘤标志物',
    hint: '同一家医院、同一台仪器比较才准，趋势比单次数值有意义',
    items: [
      { code: 'CEA', name: '癌胚抗原', unit: 'ng/mL', lo: 0, hi: 5, star: true },
      { code: 'CA199', name: 'CA19-9', unit: 'U/mL', lo: 0, hi: 37 },
      { code: 'CA125', name: 'CA125', unit: 'U/mL', lo: 0, hi: 35 },
      { code: 'AFP', name: '甲胎蛋白', unit: 'ng/mL', lo: 0, hi: 7 },
      { code: 'CYFRA', name: 'CYFRA21-1', unit: 'ng/mL', lo: 0, hi: 3.3 },
      { code: 'NSE', name: '神经元特异性烯醇化酶', unit: 'ng/mL', lo: 0, hi: 16.3 },
      { code: 'SCC', name: '鳞状细胞癌抗原', unit: 'ng/mL', lo: 0, hi: 1.5 },
      { code: 'PSA', name: '前列腺特异性抗原', unit: 'ng/mL', lo: 0, hi: 4 },
    ],
  },
  {
    id: 'coag',
    name: '凝血功能',
    hint: '化疗期间偶尔要查',
    items: [
      { code: 'PT', name: '凝血酶原时间', unit: 's', lo: 11, hi: 14.5 },
      { code: 'INR', name: 'INR', unit: '', lo: 0.8, hi: 1.2 },
      { code: 'APTT', name: '活化部分凝血活酶时间', unit: 's', lo: 28, hi: 45 },
      { code: 'FIB', name: '纤维蛋白原', unit: 'g/L', lo: 2, hi: 4 },
      { code: 'DD', name: 'D-二聚体', unit: 'mg/L', lo: 0, hi: 0.55 },
    ],
  },
  {
    id: 'imaging',
    name: '影像与评估',
    hint: 'CT/MRI/PET 的结论和病灶尺寸，疗效评估看这个',
    textOnly: true,
    items: [
      { code: 'SIZE', name: '靶病灶最长径之和', unit: 'mm', lo: 0, hi: 9999 },
    ],
  },
];

export const LAB_INDEX = (() => {
  const m = new Map();
  for (const p of LAB_PANELS) for (const it of p.items) m.set(it.code, { ...it, panelId: p.id, panelName: p.name });
  return m;
})();

/** 判断一个值相对参考区间的位置 */
export function judge(code, value) {
  const it = LAB_INDEX.get(code);
  if (!it || value === '' || value == null || Number.isNaN(Number(value))) return null;
  const v = Number(value);
  if (v < it.lo) return 'low';
  if (v > it.hi) return 'high';
  return 'ok';
}

/* ---------- 症状目录 ---------- */

/**
 * 分级用 0-3：0 无 / 1 轻（能忍，不影响日常） / 2 中（影响吃饭睡觉或日常活动） / 3 重（需要联系医生）
 * 这是按 CTCAE 的思路翻译成家属能用的白话，不是正式分级工具。
 */
export const SYMPTOMS = [
  { id: 'nausea', name: '恶心', group: '消化道', severe: '完全吃不下、喝水都想吐' },
  { id: 'vomit', name: '呕吐', group: '消化道', severe: '一天吐 3 次以上或吐到脱水' },
  { id: 'appetite', name: '食欲下降', group: '消化道', severe: '一天几乎没吃东西，体重明显掉' },
  { id: 'diarrhea', name: '腹泻', group: '消化道', severe: '一天 6 次以上，或带血、伴腹痛发烧' },
  { id: 'constipation', name: '便秘', group: '消化道', severe: '3 天以上没排便，腹胀明显' },
  { id: 'mouth', name: '口腔溃疡/口腔痛', group: '消化道', severe: '疼到没法进食' },
  { id: 'taste', name: '味觉改变', group: '消化道', severe: '所有东西都发苦发金属味' },

  { id: 'fatigue', name: '乏力', group: '全身', severe: '大部分时间卧床，起不来' },
  { id: 'fever', name: '发热', group: '全身', severe: '体温 ≥38.3℃' },
  { id: 'pain', name: '疼痛', group: '全身', severe: '疼得睡不着，止痛药不管用' },
  { id: 'sleep', name: '睡眠差', group: '全身', severe: '整夜基本没睡' },
  { id: 'dizzy', name: '头晕', group: '全身', severe: '起身就晕，差点摔倒' },
  { id: 'weight', name: '体重下降', group: '全身', severe: '一个月掉 5% 以上' },

  { id: 'rash', name: '皮疹', group: '皮肤', severe: '大面积、起疱、脱皮或伴发烧' },
  { id: 'itch', name: '皮肤瘙痒', group: '皮肤', severe: '抓到破皮，影响睡眠' },
  { id: 'handfoot', name: '手足麻木/刺痛', group: '皮肤', severe: '影响拿筷子、走路' },
  { id: 'hair', name: '脱发', group: '皮肤', severe: '基本掉光（通常可恢复）' },
  { id: 'skin', name: '皮肤发黄/眼白发黄', group: '皮肤', severe: '明显发黄，尿色像浓茶' },

  { id: 'cough', name: '咳嗽', group: '呼吸循环', severe: '持续干咳，活动后加重' },
  { id: 'dyspnea', name: '气短/喘不上气', group: '呼吸循环', severe: '安静时也喘，走几步就喘' },
  { id: 'palp', name: '心慌', group: '呼吸循环', severe: '心跳很快、胸闷' },
  { id: 'edema', name: '水肿', group: '呼吸循环', severe: '脚踝或脸明显肿' },

  { id: 'numb', name: '手脚麻木（化疗神经毒性）', group: '神经', severe: '拿不稳东西、走路发飘' },
  { id: 'memory', name: '记性差/反应慢', group: '神经', severe: '影响正常交流' },

  { id: 'polyuria', name: '口干+多尿', group: '免疫相关警示', ireae: true, severe: '喝很多水还渴、尿特别多（警惕免疫性糖尿病）' },
  { id: 'cold', name: '怕冷/浮肿/变懒', group: '免疫相关警示', ireae: true, severe: '明显怕冷、脸肿、反应变慢（警惕甲减）' },
  { id: 'mood', name: '情绪低落/焦虑', group: '心理', severe: '持续两周以上，影响生活' },
];

export const SYMPTOM_INDEX = new Map(SYMPTOMS.map((s) => [s.id, s]));
export const SYMPTOM_GROUPS = [...new Set(SYMPTOMS.map((s) => s.group))];

export const LEVELS = ['无', '轻度', '中度', '重度'];

/* ---------- 治疗类型 ---------- */

export const APPT_TYPES = [
  { id: 'chemo', name: '化疗', color: '#0EA5A0' },
  { id: 'radio', name: '放疗', color: '#4A7FD4' },
  { id: 'immuno', name: '免疫治疗', color: '#8B6FD4' },
  { id: 'test', name: '抽血/复查', color: '#D98324' },
  { id: 'shot', name: '升白针/其他注射', color: '#E0534A' },
  { id: 'visit', name: '门诊/住院', color: '#12A150' },
  { id: 'other', name: '其他', color: '#6B8A9E' },
];

export const APPT_TYPE_INDEX = new Map(APPT_TYPES.map((t) => [t.id, t]));

/* ---------- 资料类型 ---------- */

export const DOC_KINDS = [
  '化验单', '影像报告', '出院小结', '门诊病历', '病理报告', '基因检测',
  '处方/用药单', '发票与清单', '医保材料', '知情同意书', '其他',
];

/* ---------- 需要立刻联系医生的红线 ---------- */

export const RED_FLAGS = [
  (r) => (r.temp >= 38.3 ? '体温 ' + r.temp + '℃，化疗后发热可能是中性粒细胞缺乏伴感染，今天就要联系医生，不要等到明天' : null),
  (r) => (r.temp >= 38 && r.temp < 38.3 ? '体温 ' + r.temp + '℃，先复测确认，如果确认发烧按医生给的发热处理流程走' : null),
  (r) => (r.scores?.diarrhea >= 2 ? '腹泻达到中度以上，注意补液，并告诉医生（免疫治疗相关腹泻需要评估）' : null),
  (r) => (r.scores?.dyspnea >= 1 ? '出现气短，免疫治疗期间要排除免疫性肺炎，尽快联系医生' : null),
  (r) => (r.scores?.skin >= 1 ? '皮肤或眼白发黄，要查肝功能' : null),
  (r) => (r.scores?.polyuria >= 1 ? '口干多尿，需要查血糖和酮体，警惕免疫相关性糖尿病' : null),
  (r) => (r.scores?.rash >= 2 ? '皮疹中度以上，免疫治疗相关皮疹需要医生评估，不要自行涂药' : null),
  (r) => (r.scores?.vomit >= 2 ? '呕吐明显，注意脱水和电解质，必要时补液' : null),
];

export function checkRedFlags(record) {
  const out = [];
  for (const f of RED_FLAGS) {
    try { const m = f(record); if (m) out.push(m); } catch { /* 忽略缺字段 */ }
  }
  return out;
}
