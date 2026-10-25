/** 建议引擎测试：验证分级是否合理、边界是否正确 */
import { adviseLab, adviseSymptoms, summarizeAdvice, LEVEL_META } from './js/advice.js';

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const hit = JSON.stringify(g) === JSON.stringify(w);
  console.log(`  ${hit ? '✓' : '✗'} ${l}${hit ? '' : `\n     得到 ${JSON.stringify(g)}\n     期望 ${JSON.stringify(w)}`}`);
  hit ? pass++ : fail++;
};
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };

console.log('\n[1] 骨髓抑制分级（化疗最关键的）');
// 用郑武的真实数据
eq('中性粒 3.86 正常 → 无建议', adviseLab('NEUT', 3.86, { lo: 1.8, hi: 6.3 }), null);
let r = adviseLab('NEUT', 1.4, { lo: 1.8, hi: 6.3 });
eq('中性粒 1.4 → 问医生', r?.level, 'ask');
r = adviseLab('NEUT', 0.9, { lo: 1.8, hi: 6.3 });
eq('中性粒 0.9 → 今天就联系', r?.level, 'urgent');
r = adviseLab('NEUT', 0.4, { lo: 1.8, hi: 6.3 });
eq('中性粒 0.4 → 今天就联系', r?.level, 'urgent');
ok('粒细胞缺乏提到戴口罩', r?.text.includes('口罩') || r?.text.includes('感染'));

// 血小板：郑武 123，刚过下限
r = adviseLab('PLT', 123, { lo: 125, hi: 350 });
eq('血小板 123 → 观察', r?.level, 'watch');
r = adviseLab('PLT', 80, { lo: 125, hi: 350 });
eq('血小板 80 → 问医生', r?.level, 'ask');
r = adviseLab('PLT', 45, { lo: 125, hi: 350 });
eq('血小板 45 → 紧急', r?.level, 'urgent');
ok('血小板低提到出血', r?.text.includes('出血'));
r = adviseLab('PLT', 15, { lo: 125, hi: 350 });
eq('血小板 15 → 紧急', r?.level, 'urgent');

// 血红蛋白：郑武 156 正常
eq('血红蛋白 156 → 无建议', adviseLab('HGB', 156, { lo: 130, hi: 175 }), null);
r = adviseLab('HGB', 95, { lo: 130, hi: 175 });
eq('血红蛋白 95 → 问医生', r?.level, 'ask');
r = adviseLab('HGB', 70, { lo: 130, hi: 175 });
eq('血红蛋白 70 → 紧急', r?.level, 'urgent');

console.log('\n[2] 肝功能（郑武 ALT 110，上限 50）');
r = adviseLab('ALT', 110, { lo: 9, hi: 50 });
eq('ALT 110（2.2倍）→ 问医生', r?.level, 'ask');
ok('ALT 提到不要喝酒', r?.text.includes('酒'));
r = adviseLab('ALT', 300, { lo: 9, hi: 50 });
eq('ALT 300（6倍）→ 紧急', r?.level, 'urgent');
r = adviseLab('ALT', 60, { lo: 9, hi: 50 });
eq('ALT 60（1.2倍）→ 观察', r?.level, 'watch');
eq('ALT 45 正常 → 无建议', adviseLab('ALT', 45, { lo: 9, hi: 50 }), null);

console.log('\n[3] 血脂（郑武 TG 1.76 / TC 5.71 / LDL 3.87）');
// 血脂没配建议，应返回 null（避免给出不可靠的饮食指导）
eq('甘油三酯无专门建议', adviseLab('TG', 1.76, { lo: 0, hi: 1.7 }), null);

console.log('\n[4] 肿瘤标志物：只讲趋势');
// 郑武 CYFRA 从 2.9 升到 5.57
r = adviseLab('CYFRA', 5.57, { lo: 0, hi: 3.3 }, 2.9);
eq('CYFRA 升高 → 问医生', r?.level, 'ask');
ok('说明单次升高不等于恶化', r?.text.includes('不等于恶化') || r?.text.includes('单次'));
r = adviseLab('CYFRA', 2.9, { lo: 0, hi: 3.3 });
eq('首次测量 → 基线提示', r?.level, 'marker');
ok('解释了基线意义', r?.text.includes('基线'));
r = adviseLab('CEA', 3.0, { lo: 0, hi: 5 }, 4.2);
eq('CEA 下降 → 好信号', r?.level, 'marker');
ok('提到下降是好信号', r?.text.includes('好信号') || r?.text.includes('低'));
r = adviseLab('CEA', 4.3, { lo: 0, hi: 5 }, 4.2);
ok('变化小于10%视为持平', r?.text.includes('持平'));

console.log('\n[5] 血糖与甲状腺（免疫治疗相关）');
r = adviseLab('GLU', 12, { lo: 3.9, hi: 6.1 });
eq('血糖 12 → 紧急', r?.level, 'urgent');
ok('提到免疫相关性糖尿病', r?.text.includes('免疫'));
ok('提到酮体', r?.text.includes('酮体'));
r = adviseLab('TSH', 8, { lo: 0.27, hi: 4.2 });
eq('TSH 8 → 问医生', r?.level, 'ask');
ok('提到甲减症状', r?.text.includes('怕冷') || r?.text.includes('甲减'));

console.log('\n[6] 症状建议');
let adv = adviseSymptoms({ scores: { nausea: 1 }, temp: null });
eq('轻度恶心 → 观察', adv.overall, 'watch');
ok('给了饮食建议', adv.items[0].text.includes('少量多餐') || adv.items[0].text.includes('油腻'));

adv = adviseSymptoms({ scores: { nausea: 2 }, temp: null });
eq('中度恶心 → 问医生', adv.overall, 'ask');

adv = adviseSymptoms({ scores: { diarrhea: 2 }, temp: null });
eq('中度腹泻 → 问医生', adv.overall, 'ask');
ok('免疫治疗腹泻要报告', adv.items[0].text.includes('免疫'));

adv = adviseSymptoms({ scores: {}, temp: 38.5 });
eq('体温 38.5 → 紧急', adv.overall, 'urgent');
ok('提到中性粒细胞缺乏', adv.items[0].text.includes('中性粒细胞') || adv.items[0].text.includes('感染'));
ok('说不要等到明天', adv.items[0].text.includes('不要等') || adv.items[0].text.includes('今天'));

adv = adviseSymptoms({ scores: {}, temp: 37.5 });
eq('体温 37.5 → 观察', adv.overall, 'watch');

adv = adviseSymptoms({ scores: { dyspnea: 1 }, temp: null });
eq('轻度气短 → 问医生（免疫性肺炎）', adv.overall, 'ask');
ok('提到免疫性肺炎', adv.items[0].text.includes('肺炎'));

adv = adviseSymptoms({ scores: { polyuria: 1 }, temp: null });
eq('口干多尿 → 紧急（免疫性糖尿病）', adv.overall, 'urgent');

console.log('\n[7] 排序：紧急优先');
adv = adviseSymptoms({ scores: { nausea: 1, fatigue: 3, mouth: 2 }, temp: null });
eq('最严重的排第一', adv.items[0].action, 'urgent');
eq('整体判定为紧急', adv.overall, 'urgent');
ok('共 3 条建议', adv.items.length === 3, String(adv.items.length));

console.log('\n[8] 空输入与容错');
eq('无记录', adviseSymptoms({ scores: {}, temp: null }).items.length, 0);
eq('空对象不崩', adviseSymptoms({}).items.length, 0);
eq('null 不崩', adviseSymptoms(null).items.length, 0);
eq('未知症状忽略', adviseSymptoms({ scores: { nosuch: 3 } }).items.length, 0);
eq('等级0忽略', adviseSymptoms({ scores: { nausea: 0 } }).items.length, 0);
eq('未知化验项返回null', adviseLab('NOSUCH', 5, { lo: 0, hi: 1 }), null);

console.log('\n[9] 汇总功能');
const labs = [
  { code: 'ALT', name: 'ALT', value: 110, lo: 9, hi: 50, action: 'ask', advice: { level: 'ask' } },
  { code: 'PLT', name: '血小板', value: 45, lo: 125, hi: 350, action: 'urgent', advice: { level: 'urgent' } },
  { code: 'WBC', name: '白细胞', value: 3.2, lo: 3.5, hi: 9.5, action: 'watch', advice: { level: 'watch' } },
];
const sym = adviseSymptoms({ scores: { rash: 2 }, temp: null });
const s = summarizeAdvice(labs, sym);
eq('紧急 1 项', s.urgent.length, 1);
eq('问医生 2 项（ALT + 皮疹）', s.ask.length, 2);
eq('观察 1 项', s.watch.length, 1);

console.log('\n[10] 等级元数据完整');
for (const k of ['urgent', 'ask', 'watch', 'marker']) {
  ok(`LEVEL_META.${k} 有文案`, !!(LEVEL_META[k]?.label && LEVEL_META[k]?.short && LEVEL_META[k]?.cls));
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
