/**
 * 核心逻辑测试（不依赖浏览器）
 * 用 node --input-type=module 运行
 */
import {
  buildCyclePlan, buildRadioPlan, mergePlan, toICS, buildReminderPayload,
  nextAppointment,
} from './js/plan.js';
import { judge, LAB_INDEX, checkRedFlags } from './js/catalog.js';
import { addDays, daysBetween, weekday } from './js/utils.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n    得到: ' + JSON.stringify(got) + '\n    期望: ' + JSON.stringify(want)); }
}
function truthy(name, v) {
  if (v) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

console.log('\n[1] 化疗排期');
const p = { chemoCycleDays: 21, immunoCycleDays: 21, hospital: '某医院' };
const plan = buildCyclePlan(p, '2026-11-02', 4);
const chemo = plan.filter((x) => x.type === 'chemo');
eq('4 个周期生成 4 条化疗', chemo.length, 4);
eq('第1周期日期', chemo[0].date, '2026-11-02');
eq('第2周期 = +21天', chemo[1].date, '2026-11-23');
eq('第4周期 = +63天', chemo[3].date, '2027-01-04');
truthy('化疗日都是周一（起始为周一）', chemo.every((c) => new Date(c.date + 'T00:00:00').getDay() === 1));

const cbc = plan.filter((x) => x.title.includes('最低点'));
eq('每个周期一条最低点查血', cbc.length, 4);
eq('最低点 = 化疗后第9天(D1+8)', cbc[0].date, '2026-11-10');

const imm = plan.filter((x) => x.type === 'immuno');
eq('免疫治疗也排 4 次', imm.length, 4);

const fu = plan.filter((x) => x.title.includes('甲功'));
truthy('有免疫随访（甲功/血糖）', fu.length >= 1);
eq('首次免疫随访在 +42 天', fu[0].date, '2026-12-14');

const evalx = plan.filter((x) => x.title.includes('疗效评估'));
truthy('有疗效评估', evalx.length >= 1);

console.log('\n[2] 放疗排期（跳周末）');
const radio = buildRadioPlan('2026-11-02', 10); // 周一开始
eq('10 次放疗生成 10 条', radio.length, 10);
const hasWeekend = radio.some((r) => {
  const d = new Date(r.date + 'T00:00:00').getDay();
  return d === 0 || d === 6;
});
eq('没有排在周末', hasWeekend, false);
eq('第1次日期', radio[0].date, '2026-11-02');
eq('第5次是周五', radio[4].date, '2026-11-06');
eq('第6次跳到下周一', radio[5].date, '2026-11-09');

console.log('\n[3] 合并去重');
const existing = [{ key: 'chemo-2026-11-02', date: '2026-11-02', type: 'chemo', title: '化疗 第1周期 D1' }];
const add = mergePlan(existing, plan);
eq('已有 key 的不重复添加', add.some((a) => a.key === 'chemo-2026-11-02'), false);
eq('总数 = 计划数 - 1', add.length, plan.length - 1);
const add2 = mergePlan([], plan);
eq('空库全部添加', add2.length, plan.length);

console.log('\n[4] 指标判定');
eq('白细胞 3.2 偏低', judge('WBC', 3.2), 'low');
eq('白细胞 5.0 正常', judge('WBC', 5.0), 'ok');
eq('白细胞 12 偏高', judge('WBC', 12), 'high');
eq('中性粒 0.8 偏低', judge('NEUT', 0.8), 'low');
eq('血红蛋白 108 偏低', judge('HGB', 108), 'low');
eq('血小板 350 正常（边界内）', judge('PLT', 350), 'ok');
eq('血小板 351 偏高', judge('PLT', 351), 'high');
eq('空值返回 null', judge('WBC', ''), null);
eq('未知项目返回 null', judge('NOPE', 5), null);
truthy('重点项目都有参考区间', ['WBC','NEUT','HGB','PLT','ALT','CREA','TSH','CEA'].every((c) => {
  const it = LAB_INDEX.get(c); return it && Number.isFinite(it.lo) && Number.isFinite(it.hi);
}));

console.log('\n[5] 红线预警');
const f1 = checkRedFlags({ temp: 38.5, scores: {} });
truthy('38.5℃ 触发发热红线', f1.some((m) => m.includes('38.5')));
const f2 = checkRedFlags({ temp: 36.5, scores: { diarrhea: 2 } });
truthy('中度腹泻触发红线', f2.some((m) => m.includes('腹泻')));
const f3 = checkRedFlags({ temp: 36.5, scores: { diarrhea: 1 } });
eq('轻度腹泻不触发', f3.length, 0);
const f4 = checkRedFlags({ scores: { dyspnea: 1 } });
truthy('气短触发红线（免疫性肺炎）', f4.some((m) => m.includes('气短')));
const f5 = checkRedFlags({});
eq('空记录不报错不误报', f5, []);

console.log('\n[6] 下一个日程');
const now = '2026-11-05';
const appts = [
  { date: '2026-11-02', type: 'chemo', title: 'A', done: true },
  { date: '2026-11-07', type: 'test', title: 'B', done: false },
  { date: '2026-11-23', type: 'chemo', title: 'C', done: false },
];
eq('取最近的未完成', nextAppointment(appts, now).title, 'B');
eq('全部完成返回 null', nextAppointment([{ date: '2026-12-01', done: true }], now), null);

console.log('\n[7] ICS 导出');
const ics = toICS([
  { id: 'x1', date: '2026-11-02', time: '09:30', title: '化疗 第1周期', place: '肿瘤内科', note: '空腹' },
  { id: 'x2', date: '2026-11-05', time: '', title: '血常规', done: false },
  { id: 'x3', date: '2026-11-06', time: '', title: '已完成项', done: true },
], '治疗日程');
truthy('有 VCALENDAR 头', ics.includes('BEGIN:VCALENDAR'));
truthy('有 VEVENT', ics.includes('BEGIN:VEVENT'));
truthy('有时间的事件用 TZID', ics.includes('DTSTART;TZID=Asia/Shanghai:20261102T093000'));
truthy('无时间的事件用全天', ics.includes('DTSTART;VALUE=DATE:20261105'));
truthy('带提醒 VALARM', ics.includes('BEGIN:VALARM'));
truthy('已完成的不导出', !ics.includes('已完成项'));
eq('VEVENT 数量正确', (ics.match(/BEGIN:VEVENT/g) || []).length, 2);
truthy('CRLF 换行', ics.includes('\r\n'));
truthy('结尾正确', ics.trimEnd().endsWith('END:VCALENDAR'));

console.log('\n[8] 推送负载');
const pl = buildReminderPayload(appts, { name: '测试' }, 14);
truthy('有 items 字段', Array.isArray(pl.items));
truthy('只含未完成', pl.items.every((i) => i.title !== 'A'));
truthy('带 daysLeft', pl.items.every((i) => Number.isInteger(i.daysLeft)));

console.log('\n[9] 日期工具');
eq('addDays 跨月', addDays('2026-11-30', 1), '2026-12-01');
eq('addDays 负数', addDays('2026-11-01', -1), '2026-10-31');
eq('daysBetween', daysBetween('2026-11-02', '2026-11-23'), 21);
eq('weekday 周一', weekday('2026-11-02'), '一');

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
