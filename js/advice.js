/**
 * 建议引擎：把化验异常和症状分级，翻译成「现在该做什么」
 *
 * 设计原则
 * ---------
 * 只给三档行动建议，对应三种真实场景：
 *   watch  — 记着看趋势，下次门诊提一句
 *   ask    — 这次就诊要主动问医生（通常 1-3 天内）
 *   urgent — 今天就联系医生，别等
 *
 * 内容参考 CTCAE 的分级思路，但翻译成家属能直接用的白话。
 * 这不是诊断，是「帮你决定要不要打电话」。
 */

/* ---------- 化验指标的行动建议 ---------- */

/**
 * 每个项目按「偏离程度」给建议。
 * thresholds 里按严重程度从重到轻排列，命中第一条就返回。
 */
const LAB_ACTIONS = {
  // ===== 骨髓抑制：化疗最需要盯的 =====
  NEUT: {
    label: '中性粒细胞',
    thresholds: [
      { max: 0.5, level: 'urgent', why: '低于 0.5 属于粒细胞缺乏', what: '感染风险很高。今天就联系医生，出门戴口罩，避免去人多的地方，家里有人感冒要隔离。' },
      { max: 1.0, level: 'urgent', why: '低于 1.0 是明显骨髓抑制', what: '尽快联系医生。如果同时发烧到 38℃ 以上，直接去急诊，不要在家等。' },
      { max: 1.5, level: 'ask', why: '低于 1.5 偏低', what: '下次门诊主动问医生：要不要打升白针？这几天注意别去人多的地方。' },
      { max: 1.8, level: 'watch', why: '略低于参考下限', what: '不用紧张，化疗后常见。按医嘱复查血常规，看趋势。' },
    ],
  },
  WBC: {
    label: '白细胞',
    thresholds: [
      { max: 1.0, level: 'urgent', why: '严重降低', what: '今天就联系医生。注意有没有发烧，有任何发热立刻就医。' },
      { max: 2.0, level: 'ask', why: '明显偏低', what: '尽快问医生是否需要处理。这几天少去公共场所。' },
      { max: 3.0, level: 'ask', why: '偏低', what: '下次查血前跟医生提一句，通常观察即可。' },
      { max: 3.5, level: 'watch', why: '边缘偏低', what: '化疗后常见，按医嘱复查即可。' },
    ],
  },
  PLT: {
    label: '血小板',
    thresholds: [
      { max: 20, level: 'urgent', why: '低于 20 有自发出血风险', what: '今天就联系医生，可能需要输血小板。避免磕碰、刷牙要轻、别用力擤鼻涕。' },
      { max: 50, level: 'urgent', why: '低于 50 出血风险明显', what: '尽快联系医生。观察有没有牙龈出血、皮下瘀斑、大便发黑。' },
      { max: 100, level: 'ask', why: '低于 100', what: '下次门诊问医生要不要干预。日常避免剧烈运动和外伤。' },
      { max: 125, level: 'watch', why: '略低于参考下限', what: '轻度偏低，按医嘱复查。' },
    ],
  },
  HGB: {
    label: '血红蛋白',
    thresholds: [
      { max: 60, level: 'urgent', why: '重度贫血', what: '今天就联系医生，可能需要输血。注意有没有心慌、气短、头晕。' },
      { max: 80, level: 'urgent', why: '中度贫血', what: '尽快联系医生，评估要不要输血或调整方案。' },
      { max: 100, level: 'ask', why: '轻度贫血', what: '下次门诊问医生要不要补铁或加强营养。多吃瘦肉、动物肝脏、深绿色蔬菜。' },
      { max: 130, level: 'watch', why: '略低', what: '化疗后常见，注意营养，按医嘱复查。' },
    ],
  },

  // ===== 肝功能：化疗和免疫治疗都要盯 =====
  ALT: {
    label: '丙氨酸氨基转移酶',
    thresholds: [
      { max: Infinity, level: 'urgent', ratio: 5, why: '超过正常上限 5 倍', what: '尽快联系医生，可能需要停药或加保肝治疗。别喝酒，别自行吃任何药（包括中成药和保健品）。' },
      { max: Infinity, level: 'ask', ratio: 3, why: '超过正常上限 3 倍', what: '下次就诊要主动问医生是否影响化疗。这几周不喝酒、清淡饮食、避免乱吃保健品。' },
      { max: Infinity, level: 'ask', ratio: 1.5, why: '超过正常上限 1.5 倍', what: '门诊时提一句，让医生评估。避免饮酒和不明成分的补品。' },
      { max: Infinity, level: 'watch', ratio: 1, why: '略高于正常', what: '轻度升高，按医嘱复查肝功。注意休息，少吃油腻。' },
    ],
  },
  AST: {
    label: '天门冬氨酸氨基转移酶',
    thresholds: [
      { max: Infinity, level: 'urgent', ratio: 5, why: '超过正常上限 5 倍', what: '尽快联系医生。' },
      { max: Infinity, level: 'ask', ratio: 3, why: '超过正常上限 3 倍', what: '下次就诊主动问医生。避免饮酒。' },
      { max: Infinity, level: 'watch', ratio: 1, why: '轻度升高', what: '按医嘱复查，注意休息。' },
    ],
  },
  TBIL: {
    label: '总胆红素',
    thresholds: [
      { max: Infinity, level: 'urgent', ratio: 3, why: '明显升高', what: '尽快联系医生。如果眼白或皮肤发黄、尿色像浓茶，立即就医。' },
      { max: Infinity, level: 'ask', ratio: 1.5, why: '升高', what: '下次就诊问医生，同时观察有没有皮肤发黄。' },
      { max: Infinity, level: 'watch', ratio: 1, why: '略高', what: '按医嘱复查。' },
    ],
  },
  ALB: {
    label: '白蛋白',
    thresholds: [
      { max: 30, level: 'ask', why: '明显偏低，提示营养不良', what: '下次门诊问医生要不要营养支持。日常多吃鸡蛋、鱼、瘦肉、豆制品。' },
      { max: 35, level: 'ask', why: '偏低', what: '注意加强蛋白质摄入，跟医生提一下营养状况。' },
      { max: 40, level: 'watch', why: '略低', what: '注意饮食，每餐有点蛋白质。' },
    ],
  },

  // ===== 肾功能 =====
  CREA: {
    label: '肌酐',
    thresholds: [
      { max: Infinity, level: 'urgent', ratio: 2, why: '超过正常上限 2 倍', what: '尽快联系医生。多喝水（心功能不好的人要听医生说的量）。' },
      { max: Infinity, level: 'ask', ratio: 1.3, why: '升高', what: '下次就诊问医生。这几天保证喝够水。' },
      { max: Infinity, level: 'watch', ratio: 1, why: '略高', what: '按医嘱复查，注意补水。' },
    ],
  },

  // ===== 电解质 =====
  K: {
    label: '钾',
    high: {
      thresholds: [
        { min: Infinity, level: 'urgent', ratio: 1.2, why: '明显偏高', what: '马上联系医生。血钾高会影响心脏，不要拖。' },
        { min: Infinity, level: 'ask', ratio: 1, why: '偏高', what: '问医生是否需要处理，少吃香蕉、橙子、土豆等高钾食物。' },
      ],
    },
    low: {
      thresholds: [
        { max: 3.0, level: 'urgent', why: '明显偏低', what: '尽快联系医生。血钾低会心慌、乏力，可能需要口服或静脉补钾。' },
        { max: 3.5, level: 'ask', why: '偏低', what: '问医生要不要补钾。如果是呕吐腹泻导致的，要一起处理。' },
      ],
    },
  },
  NA: {
    label: '钠',
    low: {
      thresholds: [
        { max: 125, level: 'urgent', why: '明显偏低', what: '尽快联系医生，可能有乏力、意识模糊。' },
        { max: 137, level: 'ask', why: '偏低', what: '门诊问医生原因，注意有没有喝水过多或呕吐腹泻。' },
      ],
    },
  },

  // ===== 炎症 / 感染 =====
  CRP: {
    label: 'C反应蛋白',
    thresholds: [
      { min: Infinity, level: 'urgent', ratio: 10, why: '明显升高，警惕感染', what: '尽快联系医生。如果同时发烧，按医生给的发热流程走。' },
      { min: Infinity, level: 'ask', ratio: 1, why: '升高', what: '门诊问医生有没有感染迹象。注意体温。' },
    ],
  },
  PCT: {
    label: '降钙素原',
    thresholds: [
      { min: Infinity, level: 'urgent', ratio: 10, why: '明显升高，提示细菌感染', what: '尽快联系医生。' },
      { min: Infinity, level: 'ask', ratio: 1, why: '升高', what: '门诊让医生评估是否需要抗感染治疗。' },
    ],
  },

  // ===== 甲状腺：免疫治疗常见 =====
  TSH: {
    label: '促甲状腺激素',
    high: {
      thresholds: [
        { min: Infinity, level: 'urgent', ratio: 10, why: '明显升高，提示甲减', what: '尽快联系医生。甲减会让人非常乏力、怕冷、浮肿，需要补甲状腺素。' },
        { min: Infinity, level: 'ask', ratio: 1, why: '升高，可能甲减', what: '下次门诊问医生要不要查甲功全套、要不要补甲状腺素。注意有没有怕冷、浮肿、特别累。' },
      ],
    },
    low: {
      thresholds: [
        { min: Infinity, level: 'ask', ratio: 1, why: '偏低，可能甲亢', what: '门诊问医生。注意有没有心慌、手抖、消瘦。' },
      ],
    },
  },

  // ===== 血糖：免疫治疗相关糖尿病，来得急 =====
  GLU: {
    label: '空腹血糖',
    thresholds: [
      // 免疫相关性糖尿病可以突然出现，按绝对值判断更贴近临床
      { min: 13.9, level: 'urgent', why: '血糖明显升高', what: '今天就联系医生。免疫治疗可能引起糖尿病，如果同时口干、多尿、恶心呕吐，要去急诊查酮体，警惕酮症酸中毒。' },
      { min: 11.1, level: 'urgent', why: '血糖达到糖尿病诊断水平', what: '尽快联系医生。免疫治疗期间新出现的高血糖要排查免疫相关性糖尿病，需要查糖化血红蛋白和酮体。' },
      { min: 7.0, level: 'ask', why: '空腹血糖偏高', what: '下次就诊查糖化血红蛋白，问医生要不要评估。这段时间少吃甜食和精米白面。' },
      { min: 6.1, level: 'watch', why: '略高于正常', what: '控制主食量，少吃甜食，下次复查。' },
    ],
  },

  // ===== 肿瘤标志物：只给趋势建议，不给单次数值判断 =====
  CEA: { label: '癌胚抗原', marker: true },
  CYFRA: { label: 'CYFRA21-1', marker: true },
  NSE: { label: '神经元特异性烯醇化酶', marker: true },
  SCC: { label: '鳞状细胞癌抗原', marker: true },
  AFP: { label: '甲胎蛋白', marker: true },
  CA199: { label: 'CA19-9', marker: true },
  CA125: { label: 'CA125', marker: true },
};

/** 级别 → 展示用文案与颜色 */
export const LEVEL_META = {
  urgent: { label: '尽快联系医生', short: '就医', cls: 'bad', icon: '!' },
  ask: { label: '就诊时主动问医生', short: '问医生', cls: 'warn', icon: '?' },
  watch: { label: '观察 + 复查', short: '观察', cls: 'grey', icon: '·' },
  marker: { label: '看趋势，不比单次', short: '趋势', cls: 'grey', icon: '~' },
};

/**
 * 给单个化验项生成建议
 * @param {string} code 项目代码
 * @param {number} value 数值
 * @param {{lo:number, hi:number}} ref 参考区间
 * @param {number} prevValue 上一次的值（可选，用于趋势）
 * @returns {{level:string, text:string, why:string}|null}
 */
export function adviseLab(code, value, ref, prevValue) {
  const cfg = LAB_ACTIONS[code];
  if (!cfg) return null;

  const v = Number(value);
  if (!Number.isFinite(v)) return null;

  // 肿瘤标志物：只讲趋势
  if (cfg.marker) {
    if (!Number.isFinite(prevValue)) {
      return {
        level: 'marker',
        why: '第一次测',
        text: '这是基线值。肿瘤标志物单次高低意义有限，下次再测才知道方向。',
      };
    }
    const prev = Number(prevValue);
    const delta = v - prev;
    const pct = prev !== 0 ? (delta / Math.abs(prev)) * 100 : 0;
    if (Math.abs(pct) < 10) {
      return { level: 'marker', why: '变化不大', text: `比上次${delta >= 0 ? '高' : '低'} ${Math.abs(pct).toFixed(0)}%，基本持平。继续按计划复查。` };
    }
    if (delta > 0) {
      return {
        level: 'ask',
        why: '较上次升高',
        text: `比上次高 ${Math.abs(pct).toFixed(0)}%。单次升高不等于恶化，但要告诉医生，让他在下次评估时一起看。`,
      };
    }
    return { level: 'marker', why: '较上次下降', text: `比上次低 ${Math.abs(pct).toFixed(0)}%，是好信号。继续按计划复查。` };
  }

  const isHigh = Number.isFinite(ref?.hi) && v > ref.hi;
  const isLow = Number.isFinite(ref?.lo) && v < ref.lo;
  if (!isHigh && !isLow) return null;

  // 选对应方向的分支
  const branch = isLow && cfg.low ? cfg.low : isHigh && cfg.high ? cfg.high : cfg;
  const list = branch.thresholds || cfg.thresholds;
  if (!list) return null;

  for (const t of list) {
    // 按比值判断（ratio 相对参考上限/下限）
    if (Number.isFinite(t.ratio)) {
      if (isHigh) {
        const base = ref.hi;
        if (v >= base * t.ratio) return { level: t.level, why: t.why, text: t.what };
      } else {
        const base = ref.lo;
        if (v <= base / t.ratio) return { level: t.level, why: t.why, text: t.what };
      }
      continue;
    }
    // 按绝对值判断
    if (Number.isFinite(t.max) && v <= t.max) return { level: t.level, why: t.why, text: t.what };
    if (Number.isFinite(t.min) && v >= t.min) return { level: t.level, why: t.why, text: t.what };
  }

  return null;
}

/* ---------- 症状的行动建议 ---------- */

/**
 * 症状按等级给建议
 * level: 0 无 / 1 轻 / 2 中 / 3 重
 */
const SYMPTOM_ACTIONS = {
  nausea: {
    name: '恶心',
    byLevel: {
      1: { level: 'watch', text: '少量多餐，避开油腻和气味重的食物。姜茶、苏打饼干常有人管用。按医嘱吃止吐药。' },
      2: { level: 'ask', text: '影响吃饭了，联系医生调整止吐方案。化疗后的恶心多数有药可控制，不用硬扛。' },
      3: { level: 'urgent', text: '完全吃不下、喝水都想吐，容易脱水。今天就联系医生，可能需要补液。' },
    },
  },
  vomit: {
    name: '呕吐',
    byLevel: {
      1: { level: 'watch', text: '吐完少量多次喝水或口服补液盐，先别急着吃东西。' },
      2: { level: 'ask', text: '一天吐好几次，问医生要不要加止吐药。注意有没有口干、尿少。' },
      3: { level: 'urgent', text: '一天吐 3 次以上或吐到脱水，今天就联系医生。' },
    },
  },
  appetite: {
    name: '食欲下降',
    byLevel: {
      1: { level: 'watch', text: '不用强求三餐规律，能吃就吃。优先保证蛋白质：鸡蛋、牛奶、鱼肉。' },
      2: { level: 'ask', text: '吃得明显少了，跟医生提一下，可能需要营养支持或开增进食欲的药。' },
      3: { level: 'urgent', text: '一天几乎没吃东西，短期就会掉体重和体力。尽快联系医生。' },
    },
  },
  diarrhea: {
    name: '腹泻',
    byLevel: {
      1: { level: 'watch', text: '少吃粗纤维和生冷，多喝水。可以吃蒙脱石散（按说明书）。' },
      2: { level: 'ask', text: '一天好几次了，问医生要不要用止泻药。免疫治疗期间的腹泻必须报告，可能是免疫性肠炎。' },
      3: { level: 'urgent', text: '一天 6 次以上、或带血、或伴腹痛发烧，今天就要联系医生。' },
    },
  },
  constipation: {
    name: '便秘',
    byLevel: {
      1: { level: 'watch', text: '多喝水、多吃蔬菜水果，适当走动。' },
      2: { level: 'ask', text: '3 天没排便了，问医生能不能用乳果糖这类温和的通便药。' },
      3: { level: 'urgent', text: '腹胀明显、完全排不出，尽快联系医生，别自己用强力泻药。' },
    },
  },
  mouth: {
    name: '口腔溃疡',
    byLevel: {
      1: { level: 'watch', text: '用软毛牙刷，饭后用淡盐水或小苏打水漱口。避免辛辣、过烫、过酸。' },
      2: { level: 'ask', text: '疼得影响吃饭，问医生要不要用口腔凝胶或止痛漱口水。' },
      3: { level: 'urgent', text: '疼到没法进食，今天就联系医生。' },
    },
  },
  taste: {
    name: '味觉改变',
    byLevel: {
      1: { level: 'watch', text: '化疗常见，会慢慢恢复。吃不出味道时注意别因为"没味道"而吃太少。' },
      2: { level: 'watch', text: '可以试试用柠檬、醋、香草调味，或用吸管减少气味。' },
      3: { level: 'ask', text: '影响进食明显，跟医生提一下营养状况。' },
    },
  },
  fatigue: {
    name: '乏力',
    byLevel: {
      1: { level: 'watch', text: '累了就休息，但别整天躺着。每天适当走动反而有助恢复体力。' },
      2: { level: 'ask', text: '影响日常活动了。让医生查一下血红蛋白、甲功，找出乏力的原因。' },
      3: { level: 'urgent', text: '大部分时间卧床。尽快联系医生，要排除贫血、甲减、感染等原因。' },
    },
  },
  fever: {
    name: '发热',
    byLevel: {
      1: { level: 'watch', text: '先复测确认体温，多喝水，观察有没有其他症状。' },
      2: { level: 'urgent', text: '化疗期间发烧要当感染处理。联系医生，按他给的发热流程走。' },
      3: { level: 'urgent', text: '体温 ≥38.3℃ 在化疗后可能是中性粒细胞缺乏伴感染，立即联系医生或去急诊，不要等到明天。' },
    },
  },
  pain: {
    name: '疼痛',
    byLevel: {
      1: { level: 'watch', text: '记录疼痛位置和程度。可以按医嘱用止痛药，不要忍。' },
      2: { level: 'ask', text: '影响睡眠或日常活动，找医生调整止痛方案。' },
      3: { level: 'urgent', text: '疼得睡不着、止痛药不管用，尽快联系医生。突然的剧烈疼痛要立即就医。' },
    },
  },
  sleep: {
    name: '睡眠差',
    byLevel: {
      1: { level: 'watch', text: '白天别睡太久，睡前少看手机。' },
      2: { level: 'ask', text: '持续睡不好会很消耗体力，跟医生提，可以短期用药。' },
      3: { level: 'ask', text: '整夜没睡，需要处理，别硬撑。' },
    },
  },
  dizzy: {
    name: '头晕',
    byLevel: {
      1: { level: 'watch', text: '起身慢一点，避免突然站起来。多喝水。' },
      2: { level: 'ask', text: '查一下血压、血红蛋白、电解质。' },
      3: { level: 'urgent', text: '差点摔倒要立即联系医生，摔倒对病人风险很大。' },
    },
  },
  rash: {
    name: '皮疹',
    byLevel: {
      1: { level: 'watch', text: '保持皮肤清洁干燥，用温和的保湿霜。别抓，别用热水烫。' },
      2: { level: 'ask', text: '免疫治疗相关皮疹要报告医生，可能需要外用药或调整治疗。别自行涂激素药膏。' },
      3: { level: 'urgent', text: '大面积、起疱、脱皮或伴发烧，今天就要联系医生，这可能是严重皮肤反应。' },
    },
  },
  itch: {
    name: '皮肤瘙痒',
    byLevel: {
      1: { level: 'watch', text: '用温水洗澡，别用碱性肥皂。穿棉质衣服。' },
      2: { level: 'ask', text: '影响睡眠了，问医生能不能用抗过敏药。' },
      3: { level: 'urgent', text: '抓到破皮，尽快联系医生。' },
    },
  },
  handfoot: {
    name: '手足麻木',
    byLevel: {
      1: { level: 'watch', text: '注意保暖，避免接触冷水。走路小心，别穿太滑的鞋。' },
      2: { level: 'ask', text: '化疗药的神经毒性要报告医生，可能要调整剂量。' },
      3: { level: 'urgent', text: '影响拿筷子、走路，尽快联系医生。这类损伤越早处理越好。' },
    },
  },
  cough: {
    name: '咳嗽',
    byLevel: {
      1: { level: 'watch', text: '注意保暖，多喝温水。' },
      2: { level: 'ask', text: '免疫治疗期间新出现的干咳要警惕免疫性肺炎，务必告诉医生。' },
      3: { level: 'urgent', text: '持续干咳且活动后加重，今天就联系医生，要排除免疫性肺炎。' },
    },
  },
  dyspnea: {
    name: '气短',
    byLevel: {
      1: { level: 'ask', text: '免疫治疗期间出现气短必须报告医生，要排除免疫性肺炎。' },
      2: { level: 'urgent', text: '尽快联系医生。' },
      3: { level: 'urgent', text: '安静时也喘，立即就医，别等。' },
    },
  },
  palp: {
    name: '心慌',
    byLevel: {
      1: { level: 'watch', text: '静坐休息，测量脉率。避免咖啡浓茶。' },
      2: { level: 'ask', text: '查一下心电图、电解质，尤其血钾。' },
      3: { level: 'urgent', text: '心跳很快伴胸闷，尽快就医。' },
    },
  },
  edema: {
    name: '水肿',
    byLevel: {
      1: { level: 'watch', text: '抬高下肢，少吃盐。记录体重变化。' },
      2: { level: 'ask', text: '问医生查一下肾功能、白蛋白、心功能。' },
      3: { level: 'urgent', text: '脸也肿了、或呼吸费力，尽快联系医生。' },
    },
  },
  numb: {
    name: '手脚麻木',
    byLevel: {
      1: { level: 'watch', text: '注意保暖，避免烫伤（泡脚水温别太高）。' },
      2: { level: 'ask', text: '要告诉医生，神经毒性可能需要调整化疗剂量。' },
      3: { level: 'urgent', text: '拿不稳东西、走路发飘，尽快联系医生。' },
    },
  },
  memory: {
    name: '记性差',
    byLevel: {
      1: { level: 'watch', text: '用备忘录记事情。这常是"化疗脑"，多数会慢慢好转。' },
      2: { level: 'watch', text: '保证睡眠、适当活动，减少压力有帮助。' },
      3: { level: 'ask', text: '影响正常交流，跟医生提一下。' },
    },
  },
  polyuria: {
    name: '口干多尿',
    byLevel: {
      1: { level: 'urgent', text: '这可能是免疫相关性糖尿病，需要查血糖和酮体，今天就联系医生。' },
      2: { level: 'urgent', text: '尽快就医，查血糖和尿酮体。' },
      3: { level: 'urgent', text: '立即就医，警惕酮症酸中毒。' },
    },
  },
  cold: {
    name: '怕冷浮肿',
    byLevel: {
      1: { level: 'ask', text: '可能是免疫相关甲减，门诊查甲功。注意保暖。' },
      2: { level: 'ask', text: '尽快查甲功，明确后补甲状腺素就能改善。' },
      3: { level: 'ask', text: '查甲功，跟医生说明这些症状。' },
    },
  },
  mood: {
    name: '情绪低落',
    byLevel: {
      1: { level: 'watch', text: '这很正常，允许自己有情绪。多和家人说话，做点能让自己放松的事。' },
      2: { level: 'ask', text: '持续两周以上，跟医生提一下，现在有很好的干预办法。' },
      3: { level: 'ask', text: '影响生活了，请一定要说岀来，找医生或心理专科。' },
    },
  },
  skin: {
    name: '皮肤发黄',
    byLevel: {
      1: { level: 'ask', text: '查一下肝功能，看看胆红素。' },
      2: { level: 'urgent', text: '尽快联系医生检查肝胆情况。' },
      3: { level: 'urgent', text: '尽快就医。' },
    },
  },
  weight: {
    name: '体重下降',
    byLevel: {
      1: { level: 'watch', text: '每周固定时间称一次，记下来。' },
      2: { level: 'ask', text: '一个月掉 5% 要告诉医生，可能需要营养支持。' },
      3: { level: 'urgent', text: '明显消瘦，尽快联系医生评估营养状况。' },
    },
  },
  hair: {
    name: '脱发',
    byLevel: {
      1: { level: 'watch', text: '化疗常见，治疗结束后多数会重新长出来。可以剪短、用温和洗发水。' },
      2: { level: 'watch', text: '可以准备帽子或假发，注意头皮防晒和保暖。' },
      3: { level: 'watch', text: '基本掉光也只是暂时的，别太焦虑。' },
    },
  },
};

/**
 * 给一次症状记录生成整体建议
 * @param {{scores:Object, temp:number}} record
 * @returns {{items:Array, overall:string}}
 */
export function adviseSymptoms(record) {
  const items = [];
  const scores = record?.scores || {};

  for (const [id, lv] of Object.entries(scores)) {
    if (!lv || lv <= 0) continue;
    const cfg = SYMPTOM_ACTIONS[id];
    if (!cfg) continue;
    const act = cfg.byLevel?.[lv];
    if (!act) continue;
    items.push({
      id,
      name: cfg.name,
      level: lv,
      action: act.level,
      text: act.text,
    });
  }

  // 体温单独判断
  const t = Number(record?.temp);
  if (Number.isFinite(t) && t >= 37.3) {
    if (t >= 38.3) {
      items.push({
        id: 'temp', name: '体温 ' + t + '℃', level: 3, action: 'urgent',
        text: '化疗后发热可能是中性粒细胞缺乏伴感染。今天就联系医生或去急诊，不要等到明天。',
      });
    } else if (t >= 38) {
      items.push({
        id: 'temp', name: '体温 ' + t + '℃', level: 2, action: 'urgent',
        text: '复测确认。如果确实发烧，按医生给的发热处理流程联系他。',
      });
    } else {
      items.push({
        id: 'temp', name: '体温 ' + t + '℃', level: 1, action: 'watch',
        text: '低热，多喝水，注意观察有没有其他症状，持续不退要联系医生。',
      });
    }
  }

  // 排序：urgent 优先
  const order = { urgent: 0, ask: 1, watch: 2 };
  items.sort((a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9));

  let overall = 'none';
  if (items.some((x) => x.action === 'urgent')) overall = 'urgent';
  else if (items.some((x) => x.action === 'ask')) overall = 'ask';
  else if (items.length) overall = 'watch';

  return { items, overall };
}

/** 汇总当前所有建议（首页用） */
export function summarizeAdvice(labAdvices, symptomAdvice) {
  const urgent = [];
  const ask = [];
  const watch = [];

  for (const a of labAdvices) {
    if (a.action === 'urgent') urgent.push(a);
    else if (a.action === 'ask') ask.push(a);
    else if (a.action === 'watch') watch.push(a);
  }
  for (const s of symptomAdvice?.items || []) {
    if (s.action === 'urgent') urgent.push({ ...s, from: 'symptom' });
    else if (s.action === 'ask') ask.push({ ...s, from: 'symptom' });
    else if (s.action === 'watch') watch.push({ ...s, from: 'symptom' });
  }

  return { urgent, ask, watch };
}
