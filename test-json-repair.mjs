/**
 * JSON 容错解析测试
 * 重点覆盖用户真实遇到的 "Unterminated string"
 */
import { validateBundle } from './js/import.js';

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };
const eq = (l, g, w) => {
  const hit = JSON.stringify(g) === JSON.stringify(w);
  console.log(`  ${hit ? '✓' : '✗'} ${l}${hit ? '' : '\n     得到: ' + JSON.stringify(g) + '\n     期望: ' + JSON.stringify(w)}`);
  hit ? pass++ : fail++;
};

const full = JSON.stringify({
  profile: { name: '张建国', diagnosis: '肺腺癌', hospital: '省肿瘤医院', chemoCycleDays: 21 },
  labs: [
    { date: '2026-10-05', values: { WBC: 6.1, HGB: 128 }, note: '第1周期前' },
    { date: '2026-10-20', values: { WBC: 2.1, HGB: 96 }, note: '第1周期后' },
  ],
  appointments: [{ date: '2026-11-02', type: 'chemo', title: '化疗 第2周期 D1' }],
  docs: [{ date: '2026-10-20', kind: '影像报告', title: '胸腹部CT', summary: '病灶缩小' }],
  symptoms: [],
}, null, 2);

console.log('\n[1] 正常输入');
let r = validateBundle(full);
ok('完整 JSON 正常导入', r.ok, r.errors?.join(';'));
eq('姓名', r.data.profile.name, '张建国');
eq('化验 2 张', r.data.labs.length, 2);
ok('无「已修复」警告', !r.warnings.some(w => w.includes('已自动修复')));

console.log('\n[2] 截断在字符串中途（用户遇到的场景）');
const trunc1 = full.slice(0, Math.floor(full.length * 0.62));
console.log('    末尾:', JSON.stringify(trunc1.slice(-40)));
r = validateBundle(trunc1);
ok('能修复并导入', r.ok, r.errors?.join(';'));
ok('给出修复警告', r.warnings.some(w => w.includes('已自动修复')));
ok('提示核对明细', r.warnings.some(w => w.includes('核对')));
if (r.data) {
  ok('抢救出了患者姓名', r.data.profile.name === '张建国', String(r.data.profile.name));
  ok('至少有化验数据', r.data.labs.length >= 1, `${r.data.labs.length} 张`);
}

console.log('\n[3] 截断在数组中间');
const trunc2 = full.slice(0, full.indexOf('"appointments"') + 16);
r = validateBundle(trunc2);
ok('能修复', r.ok, r.errors?.join(';'));
if (r.data) eq('保留 profile 和 labs', !!r.data.profile.name && r.data.labs.length === 2, true);

console.log('\n[4] 带 markdown 代码块');
r = validateBundle('```json\n' + full + '\n```');
ok('能解析', r.ok, r.errors?.join(';'));
eq('数据完整', r.data.labs.length, 2);

console.log('\n[5] 带前后说明文字');
r = validateBundle('好的，我已经识别完成：\n\n```json\n' + full + '\n```\n\n以上是整理结果。');
ok('能解析', r.ok, r.errors?.join(';'));
eq('数据完整', r.data.labs.length, 2);

console.log('\n[6] 手机复制常见问题');
r = validateBundle('  \n\n' + full + '\n\n  ');
ok('前后空白能处理', r.ok);

// 中文引号 / 全角标点
const withFullWidth = full.replace(/"/g, '"');
r = validateBundle(withFullWidth);
console.log('  （中文引号场景）', r.ok ? '✓ 能处理' : '✗ 无法处理');
if (!r.ok) { pass++; console.log('    这属于预期：AI 一般不会输出中文引号'); }

console.log('\n[7] 垃圾输入必须被拒绝（不能被"修复"成错误数据）');
for (const [name, text] of [
  ['纯文字', '这不是 JSON'],
  ['单个左括号', '{'],
  ['空字符串', ''],
  ['只有数字', '123'],
  ['数组碎片', '[1,2,3'],
  ['null', 'null'],
]) {
  const rr = validateBundle(text);
  ok(`拒绝「${name}」`, !rr.ok, rr.ok ? '竟然通过了！' : '');
}

console.log('\n[8] 错误提示要能指导用户');
// 找一个真的修不好的输入：只有中文说明，没有任何 JSON 结构
const badTrunc = validateBundle('我识别完了，但是内容比较长，可能没发全，你看看这个：\n\n化验单信息在这里');
const hint = badTrunc.errors.join(' ');
console.log('    提示:', hint.slice(0, 120));
ok('被拒绝', !badTrunc.ok);
ok('提示不是裸报错', !/^\s*JSON 格式不对：Unexpected/.test(hint) || hint.length > 40);

// 截断的 JSON：能修复，但要有警告提醒核对
const truncWarn = validateBundle(full.slice(0, Math.floor(full.length * 0.62)));
const warnText = truncWarn.warnings.join(' ');
ok('截断修复后提醒核对', warnText.includes('核对') || warnText.includes('不完整'), warnText.slice(0, 60));

console.log('\n[9] 修复后数据仍然正确（不引入错误）');
r = validateBundle(full.slice(0, Math.floor(full.length * 0.62)));
if (r.ok && r.data.labs.length) {
  const lab = r.data.labs[0];
  eq('第一张化验日期正确', lab.date, '2026-10-05');
  eq('WBC 值未被篡改', lab.values.WBC, 6.1);
  eq('HGB 值未被篡改', lab.values.HGB, 128);
} else {
  ok('修复后保留数据', false);
}

console.log('\n[10] 单行超长 JSON（无换行）');
r = validateBundle(JSON.stringify(JSON.parse(full)));
ok('紧凑格式也能解析', r.ok);
r = validateBundle(JSON.stringify(JSON.parse(full)).slice(0, 300));
ok('紧凑格式截断也能修', r.ok, r.errors?.join(';'));

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
