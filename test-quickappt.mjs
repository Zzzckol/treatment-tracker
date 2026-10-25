/** 极简日程录入测试：中文日期解析、类型推断、时间提取 */
import { parseDateFromText, guessType, parseTimeFromText } from './js/quickappt.js';

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const hit = JSON.stringify(g) === JSON.stringify(w);
  console.log(`  ${hit ? '✓' : '✗'} ${l}${hit ? '' : `\n     得到 ${JSON.stringify(g)}\n     期望 ${JSON.stringify(w)}`}`);
  hit ? pass++ : fail++;
};

// 基准日：2026-10-25 是周日
const BASE = '2026-10-25';

console.log('（基准日 2026-10-25 周日）\n');

console.log('[1] 相对日期');
eq('今天', parseDateFromText('今天查血', BASE), '2026-10-25');
eq('明天', parseDateFromText('明天复查', BASE), '2026-10-26');
eq('后天', parseDateFromText('后天去华西', BASE), '2026-10-27');
eq('大后天', parseDateFromText('大后天', BASE), '2026-10-28');

console.log('\n[2] 下周X（用户实际用到的）');
eq('下周三', parseDateFromText('下周三查血', BASE), '2026-10-28');
eq('下周一', parseDateFromText('下周一', BASE), '2026-10-26');
eq('下周五', parseDateFromText('下周五', BASE), '2026-10-30');
eq('下周日', parseDateFromText('下周日', BASE), '2026-11-01');

console.log('\n[3] 本周X');
eq('本周三', parseDateFromText('本周三', BASE), '2026-10-21');
eq('这周三', parseDateFromText('这周三', BASE), '2026-10-21');

console.log('\n[4] 只说周X（取未来最近）');
eq('周三（今天是周日，应为 10-28）', parseDateFromText('周三', BASE), '2026-10-28');
eq('周一（明天）', parseDateFromText('周一', BASE), '2026-10-26');
eq('周日（今天）', parseDateFromText('周日', BASE), '2026-10-25');

console.log('\n[5] 具体日期');
eq('10月28日', parseDateFromText('10月28日查血', BASE), '2026-10-28');
eq('10-28', parseDateFromText('10-28 查血', BASE), '2026-10-28');
eq('10/28', parseDateFromText('10/28', BASE), '2026-10-28');
eq('2026-11-12', parseDateFromText('2026-11-12 化疗', BASE), '2026-11-12');
eq('11月12日', parseDateFromText('11月12日第2周期', BASE), '2026-11-12');
eq('28号', parseDateFromText('28号去查血', BASE), '2026-10-28');

console.log('\n[6] 跨年处理');
// 12-20 看的"1月5日"应理解为明年
eq('12月30日的「1月5日」应推明年', parseDateFromText('1月5日', '2026-12-30'), '2027-01-05');

console.log('\n[7] 认不出就返回 null');
eq('纯文字', parseDateFromText('去华西医院', BASE), null);
eq('空字符串', parseDateFromText('', BASE), null);
eq('无日期', parseDateFromText('拿报告', BASE), null);

console.log('\n[8] 类型推断');
eq('化疗', guessType('下周三化疗'), 'chemo');
eq('放疗', guessType('放疗第10次'), 'radio');
eq('免疫治疗', guessType('免疫治疗第3次'), 'immuno');
eq('查血', guessType('下周三查血常规'), 'test');
eq('化验', guessType('去化验肝功'), 'test');
eq('CT', guessType('做CT复查'), 'test');
eq('住院', guessType('下周一住院'), 'visit');
eq('门诊', guessType('门诊复诊'), 'visit');
eq('升白针', guessType('打升白针'), 'shot');
eq('其他', guessType('和老王吃饭'), 'other');

console.log('\n[9] 时间提取');
eq('具体时间 9:30', parseTimeFromText('9:30去抽血'), '09:30');
eq('中文冒号', parseTimeFromText('14：00 门诊'), '14:00');
eq('上午9点', parseTimeFromText('上午9点去'), '09:00');
eq('下午2点', parseTimeFromText('下午2点复查'), '14:00');
eq('下午2点半', parseTimeFromText('下午2点半'), '14:30');
eq('晚上7点', parseTimeFromText('晚上7点'), '19:00');
eq('没时间', parseTimeFromText('下周三查血'), null);

console.log('\n[10] 组合场景（用户真实输入）');
const cases = [
  '下周三查血',
  '10月28日上午9点去华西查血常规和肝肾功',
  '11月12日第2周期化疗',
  '28号去拿报告',
];
for (const t of cases) {
  const d = parseDateFromText(t, BASE);
  const tm = parseTimeFromText(t);
  const ty = guessType(t);
  console.log(`  「${t}」`);
  console.log(`    日期 ${d || '未识别'}  时间 ${tm || '未填'}  类型 ${ty}`);
  if (!d) { console.log('    ✗ 应该识别出日期'); fail++; } else pass++;
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
