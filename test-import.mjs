/**
 * 导入模块测试：校验逻辑、护栏、合并去重
 * 重点验证「错的数据不能被悄悄写入」
 */
import { validateBundle } from './js/import.js';
import { judge } from './js/catalog.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const eq = (label, got, want) => {
  const hit = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${hit ? '✓' : '✗'} ${label}${hit ? '' : '\n     得到: ' + JSON.stringify(got) + '\n     期望: ' + JSON.stringify(want)}`);
  hit ? pass++ : fail++;
};

console.log('\n[1] 完整数据包');
const full = {
  profile: { name: '张建国', sex: '男', diagnosis: '肺腺癌', stage: 'IIIB期', chemoCycleDays: 21 },
  labs: [
    { date: '2026-10-20', values: { WBC: 3.2, NEUT: 1.4, HGB: 108 }, note: '第3周期后' },
  ],
  appointments: [
    { date: '2026-11-02', type: 'chemo', title: '化疗 第4周期 D1', time: '09:00', place: '肿瘤内科' },
  ],
  docs: [
    { date: '2026-10-20', kind: '影像报告', title: '胸腹部CT', hospital: '省肿瘤医院', summary: '病灶缩小' },
  ],
  symptoms: [
    { date: '2026-10-20', temp: 37.2, weight: 62, scores: { nausea: 2, fatigue: 1 }, note: '' },
  ],
};
let r = validateBundle(full);
ok('校验通过', r.ok, r.errors?.join('; '));
eq('姓名', r.data.profile.name, '张建国');
eq('化疗周期转为数字', r.data.profile.chemoCycleDays, 21);
eq('化验 1 张', r.data.labs.length, 1);
eq('化验值正确', r.data.labs[0].values.WBC, 3.2);
eq('日程 1 条', r.data.appointments.length, 1);
eq('资料 1 份', r.data.docs.length, 1);
eq('症状 1 天', r.data.symptoms.length, 1);

console.log('\n[2] 日期校验');
for (const [label, d, shouldPass] of [
  ['正常日期', '2026-10-20', true],
  ['2月30日', '2026-02-30', false],
  ['13月', '2026-13-01', false],
  ['格式错误', '2026/10/20', false],
  ['缺前导零', '2026-1-5', false],
  ['空字符串', '', false],
]) {
  const rr = validateBundle({ labs: [{ date: d, values: { WBC: 5 } }] });
  const got = rr.data?.labs.length > 0;
  ok(`日期「${label}」${shouldPass ? '应接受' : '应拒绝'}`, got === shouldPass);
}

console.log('\n[3] 数字护栏（防止 OCR 错误写入）');
r = validateBundle({ labs: [{ date: '2026-10-20', values: { WBC: 1080, HGB: 'abc', PLT: -5 } }] });
eq('三项全部被拦截，整张单子跳过', r.data.labs.length, 0);
ok('给出了跳过原因', r.warnings.some((w) => w.includes('没有任何有效数值')), r.warnings.join(' / '));
ok('逐项说明了原因', r.warnings.length >= 3);

// 只拦错误的，保留正确的
r = validateBundle({ labs: [{ date: '2026-10-20', values: { WBC: 1080, HGB: 108, PLT: 200 } }] });
eq('只保留合法值', Object.keys(r.data.labs[0].values).sort(), ['HGB', 'PLT']);
ok('WBC 被拦并说明', r.warnings.some((w) => w.includes('WBC=1080')));

r = validateBundle({ labs: [{ date: '2026-10-20', values: { WBC: '3.2' } }] });
eq('字符串数字能转成数值', r.data.labs[0].values.WBC, 3.2);

r = validateBundle({ labs: [{ date: '2026-10-20', values: { NOSUCH: 5, WBC: 5 } }] });
eq('未知项目代码被忽略', Object.keys(r.data.labs[0].values), ['WBC']);

console.log('\n[4] 症状评分边界');
r = validateBundle({ symptoms: [{ date: '2026-10-20', scores: { nausea: 2, fatigue: 9, badkey: 1 } }] });
eq('超范围评分被过滤', r.data.symptoms[0].scores, { nausea: 2 });
r = validateBundle({ symptoms: [{ date: '2026-10-20', scores: { nausea: 2.7 } }] });
eq('小数四舍五入', r.data.symptoms[0].scores.nausea, 3);

console.log('\n[5] 体温体重合理性');
for (const [label, temp, want] of [
  ['正常体温', 37.2, 37.2],
  ['发烧', 38.5, 38.5],
  ['异常高', 200, null],
  ['异常低', 5, null],
  ['缺省', undefined, null],
]) {
  const rr = validateBundle({ symptoms: [{ date: '2026-10-20', temp, scores: {} }] });
  eq(`体温「${label}」`, rr.data.symptoms[0].temp, want);
}

console.log('\n[6] 无效输入');
ok('空字符串报错', !validateBundle('').ok);
ok('坏 JSON 报错', !validateBundle('{坏的').ok);
ok('非对象报错', !validateBundle('123').ok);
r = validateBundle({ profile: {} });
ok('全空时报错', !r.ok, r.errors.join(';'));

console.log('\n[7] 缺字段容错');
r = validateBundle({ labs: [{ date: '2026-10-20', values: { WBC: 5 } }] });
ok('缺 profile 不报错', r.ok);
ok('缺 appointments 不报错', r.data.appointments.length === 0);
ok('缺 docs 不报错', r.data.docs.length === 0);

console.log('\n[8] 日程类型白名单');
r = validateBundle({ appointments: [
  { date: '2026-11-01', type: 'chemo', title: 'A' },
  { date: '2026-11-02', type: '乱写', title: 'B' },
]});
eq('合法类型保留', r.data.appointments[0].type, 'chemo');
eq('非法类型归为 other', r.data.appointments[1].type, 'other');

console.log('\n[9] 时间格式');
r = validateBundle({ appointments: [
  { date: '2026-11-01', type: 'chemo', title: 'A', time: '09:30' },
  { date: '2026-11-02', type: 'chemo', title: 'B', time: '9点30' },
]});
eq('合法时间保留', r.data.appointments[0].time, '09:30');
eq('非法时间清空', r.data.appointments[1].time, '');

console.log('\n[10] 导入后指标能正确判定');
r = validateBundle({ labs: [{ date: '2026-10-20', values: { WBC: 3.2, NEUT: 0.8, HGB: 108 } }] });
const v = r.data.labs[0].values;
eq('白细胞 3.2 判为偏低', judge('WBC', v.WBC), 'low');
eq('中性粒 0.8 判为偏低', judge('NEUT', v.NEUT), 'low');
eq('血红蛋白 108 判为偏低', judge('HGB', v.HGB), 'low');

console.log('\n[11] 资料类型白名单');
r = validateBundle({ docs: [
  { date: '2026-10-20', kind: '影像报告', title: 'A' },
  { date: '2026-10-21', kind: '不存在的类型', title: 'B' },
]});
eq('合法类型保留', r.data.docs[0].kind, '影像报告');
eq('非法类型归为其他', r.data.docs[1].kind, '其他');

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
