/**
 * 推送逻辑测试：本地起一个假 Server酱 服务，验证脚本在各类场景下发了什么
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';

const NODE = process.execPath;
const ROOT = 'D:\\AI\\treatment-tracker';
const DATA_DIR = `${ROOT}\\data`;
const FILE = `${DATA_DIR}\\upcoming.json`;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const today = ymd(new Date());

// 假 Server酱
const received = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try { received.push(JSON.parse(body)); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 0, message: '', data: { pushid: '1' } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// 拦截脚本里的 Server酱 域名：把 URL 换成指向本地假服务，并让数据路径指向真实 data/
const { readFile } = await import('node:fs/promises');
const src = await readFile(`${ROOT}\\scripts\\push.mjs`, 'utf8');
const patched = src
  .replace('https://sctapi.ftqq.com', `http://127.0.0.1:${PORT}`)
  .replace("new URL('../data/upcoming.json', import.meta.url)", `new URL('./data/upcoming.json', import.meta.url)`);
if (!patched.includes(`127.0.0.1:${PORT}`)) throw new Error('替换 URL 失败');
await writeFile(`${ROOT}\\_push_test.mjs`, patched, 'utf8');

async function run(payload, { force = false } = {}) {
  received.length = 0;
  await mkdir(DATA_DIR, { recursive: true });
  if (payload) await writeFile(FILE, JSON.stringify(payload, null, 2), 'utf8');
  const r = await new Promise((resolve) => {
    const p = spawn(NODE, [`${ROOT}\\_push_test.mjs`], {
      env: { ...process.env, SERVERCHAN_KEY: 'SCTTEST', FORCE: force ? '1' : '' },
      cwd: ROOT,
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
  });
  return { ...r, sent: received.slice() };
}

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

console.log('\n[1] 今天有化疗 + 明天有复查');
let r = await run({
  generatedAt: new Date().toISOString(),
  patient: '张建国',
  items: [
    { date: today, time: '09:00', type: 'chemo', title: '化疗 第3周期 D1', place: '肿瘤内科' },
    { date: addDays(1), time: '08:00', type: 'test', title: '血常规', place: '检验科' },
  ],
});
check('脚本成功退出', r.code === 0, r.err.slice(0, 100));
check('发出了 1 条消息', r.sent.length === 1);
if (r.sent[0]) {
  check('标题含今天日程数', /今天有 1 件事/.test(r.sent[0].title), r.sent[0].title);
  check('正文含今天化疗', r.sent[0].desp.includes('化疗 第3周期'));
  check('正文含明天复查', r.sent[0].desp.includes('血常规'));
  check('含患者名', r.sent[0].title.includes('张建国'));
}

console.log('\n[2] 今天没安排，明天也没有');
r = await run({
  generatedAt: new Date().toISOString(),
  items: [{ date: addDays(10), type: 'chemo', title: '远期化疗' }],
});
check('不发消息', r.sent.length === 0);
check('输出 skip', r.out.includes('[skip]'));

console.log('\n[3] 强制测试模式');
r = await run({ generatedAt: new Date().toISOString(), items: [] }, { force: true });
check('强制时发测试消息', r.sent.length === 1);
check('测试消息说明链路正常', r.sent[0]?.desp.includes('推送链路正常'));

console.log('\n[4] 2-3 天后有检查（提前提醒）');
r = await run({
  generatedAt: new Date().toISOString(),
  items: [{ date: addDays(2), type: 'test', title: '增强CT', place: '影像科' }],
});
check('发出提前提醒', r.sent.length === 1);
check('提到过两天要检查', r.sent[0]?.desp.includes('过两天要检查'), r.sent[0]?.desp?.slice(0, 80));

console.log('\n[5] 数据过期提醒');
r = await run({
  generatedAt: (() => { const d = new Date(); d.setDate(d.getDate() - 40); return d.toISOString(); })(),
  items: [],
});
check('发出过期警告', r.sent.length === 1);
check('提示重新同步', r.sent[0]?.desp.includes('很久没更新') || r.sent[0]?.desp.includes('同步'));

console.log('\n[6] 缺少 SendKey 时的行为');
received.length = 0;
const noKey = await new Promise((resolve) => {
  const p = spawn(NODE, [`${ROOT}\\_push_test.mjs`], {
    env: { ...process.env, SERVERCHAN_KEY: '', FORCE: '1' },
    cwd: ROOT,
  });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, err }));
});
check('缺 key 时非零退出（让 Actions 报红）', noKey.code !== 0);
check('错误信息明确', noKey.err.includes('SERVERCHAN_KEY'));

console.log('\n[7] 损坏的 JSON');
await writeFile(FILE, '{ 坏的 json', 'utf8');
const bad = await new Promise((resolve) => {
  const p = spawn(NODE, [`${ROOT}\\_push_test.mjs`], {
    env: { ...process.env, SERVERCHAN_KEY: 'SCTTEST' }, cwd: ROOT,
  });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, err }));
});
check('坏 JSON 时非零退出并报错', bad.code !== 0 && bad.err.includes('fatal'));

// 清理
await rm(FILE, { force: true });
await rm(`${ROOT}\\_push_test.mjs`, { force: true });
server.close();

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
