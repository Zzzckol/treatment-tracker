#!/usr/bin/env node
/**
 * 端到端验证：真实操作一遍主流程，并逐步截图。
 * 覆盖：填信息 → 自动排期 → 录入化验 → 趋势图 → 每日记录 → 红线预警 → 就诊一页纸
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:8765/index.html';
const PORT = 9334;
const OUT = 'D:\\AI\\.tmp-e2e';
const profile = 'D:\\AI\\.tmp-cdp-e2e';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=414,860',
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

let msgId = 0;
const pending = new Map();
const errors = [];

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('调试端口起不来');
}

const ws = new WebSocket(await wsUrl());
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(d.exception?.description || d.text);
  }
});
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });
}
await new Promise((r) => ws.addEventListener('open', r));

const { result: tgt } = await send('Target.createTarget', { url: 'about:blank' });
const { result: att } = await send('Target.attachToTarget', { targetId: tgt.targetId, flatten: true });
const sid = att.sessionId;
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride',
  { width: 414, height: 860, deviceScaleFactor: 2, mobile: true }, sid);

async function go(url) {
  await send('Page.navigate', { url }, sid);
  await sleep(400);
  // 同文档 hash 跳转不会重新加载，强制 reload 让应用重新从库读数据
  await send('Page.reload', { ignoreCache: false }, sid);
  await sleep(1800);
}

async function js(expression) {
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  }, sid);
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
  }
  return r.result?.result?.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
  if (r.result?.data) {
    await writeFile(`${OUT}\\${name}.png`, Buffer.from(r.result.data, 'base64'));
    console.log(`  📷 ${name}.png`);
  } else {
    console.log(`  ⚠ 截图失败 ${name}`);
  }
}

const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

console.log('\n[1] 首次打开（空数据库）');
await go(BASE);
await js(`indexedDB.deleteDatabase('tx-tracker')`);
await go(BASE);
const v1 = await js(`document.getElementById('view').textContent`);
check('显示引导填写信息', v1.includes('先花两分钟'));
check('底部导航 5 个入口', (await js(`document.querySelectorAll('#tabbar button').length`)) === 5);
await shot('01-空状态');

console.log('\n[2] 填患者信息');
await js(`
  (async () => {
    const m = await import('./js/db.js');
    await m.saveProfile({
      name: '张建国', sex: '男', diagnosis: '肺腺癌', stage: 'IIIB期',
      hospital: '省肿瘤医院', dept: '肿瘤内科', doctor: '李医生',
      chemoCycleDays: 21, immunoCycleDays: 21, radioTotal: 30,
    });
  })()
`);
await go(BASE);
const v2 = await js(`document.getElementById('view').textContent`);
check('顶栏显示患者名', (await js(`document.getElementById('hd-who').textContent`)).includes('张建国'));
check('有空日程提示', v2.includes('暂时没有安排下一次'));
await shot('02-今天页');

console.log('\n[3] 自动排期（用真实算法）');
const planInfo = await js(`
  (async () => {
    const plan = await import('./js/plan.js');
    const db = await import('./js/db.js');
    const p = await db.getProfile();
    const drafts = plan.buildCyclePlan(p, '2026-10-26', 6);
    const radio = plan.buildRadioPlan('2026-10-26', 30);
    const all = [...drafts, ...radio];
    for (const d of all) await db.put('appointments', { ...d, id: db.uid() });
    return { chemo: drafts.filter(x=>x.type==='chemo').length,
             imm: drafts.filter(x=>x.type==='immuno').length,
             test: drafts.filter(x=>x.type==='test').length,
             radio: radio.length };
  })()
`);
console.log('    排期结果:', JSON.stringify(planInfo));
check('6 个化疗周期', planInfo.chemo === 6);
check('6 次免疫治疗', planInfo.imm === 6);
check('30 次放疗', planInfo.radio === 30);
check('含查血与评估', planInfo.test >= 12);

await go(`${BASE}#plan`);
await sleep(600);
const v3 = await js(`document.getElementById('view').textContent`);
check('日程页显示自动排期按钮', v3.includes('自动排期'));
check('日程列表按日期分组', v3.includes('周'));
await shot('03-日程列表');

console.log('\n[4] 录入化验（3 次，看趋势）');
await js(`
  (async () => {
    const db = await import('./js/db.js');
    const rows = [
      { date: '2026-10-05', values: { WBC: 6.1, NEUT: 3.8, HGB: 128, PLT: 210, ALT: 32, CREA: 78, TSH: 2.1, CEA: 4.2 } },
      { date: '2026-10-19', values: { WBC: 3.2, NEUT: 1.4, HGB: 108, PLT: 156, ALT: 48, CREA: 82, TSH: 3.6, CEA: 3.1 } },
      { date: '2026-11-02', values: { WBC: 2.1, NEUT: 0.8, HGB: 96, PLT: 88, ALT: 62, CREA: 91, TSH: 5.4, CEA: 2.4 } },
    ];
    for (const r of rows) await db.put('labs', { ...r, id: db.uid() });
  })()
`);
await go(`${BASE}#labs`);
await sleep(800);
const labText = await js(`document.getElementById('view').textContent`);
check('指标页出现白细胞', labText.includes('白细胞'));
check('显示偏高/偏低标签', labText.includes('偏低'));
check('画出 SVG 趋势图', (await js(`document.querySelectorAll('#view svg').length`)) > 3,
  `svg 数量 ${await js(`document.querySelectorAll('#view svg').length`)}`);
check('趋势图含正常范围色带', (await js(`document.querySelectorAll('#view svg rect').length`)) > 0);
await shot('04-指标趋势');

console.log('\n[5] 每日记录 + 红线预警');
await js(`
  (async () => {
    const db = await import('./js/db.js');
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    const t = d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
    await db.put('symptoms', { id: db.uid(), date: t, temp: 38.5,
      scores: { nausea: 2, fatigue: 2, appetite: 1, diarrhea: 2 }, weight: 62, note: '化疗后第三天' });
  })()
`);
await go(BASE);
await sleep(900);
const v5 = await js(`document.getElementById('view').textContent`);
check('今天页出现红线预警', v5.includes('需要今天联系医生'));
// 预警详情现在收在弹层里，点开验证
await js(`
  (() => {
    const bar = document.querySelector('#view .alert.compact');
    if (bar) bar.click();
    return !!bar;
  })()
`);
await sleep(500);
const sheet5 = await js(`document.getElementById('sheet-body').textContent`);
check('弹层里能看到发热详情', sheet5.includes('38.5'), sheet5.slice(0, 40));
check('弹层里能看到腹泻提示', sheet5.includes('腹泻'));
await js(`document.getElementById('sheet-x').click()`);
await sleep(300);
await shot('05-红线预警');

console.log('\n[6] 记录页与热力条');
await go(`${BASE}#syms`);
await sleep(700);
const v6 = await js(`document.getElementById('view').textContent`);
check('近14天负担图', v6.includes('近 14 天负担'));
check('历史记录出现', v6.includes('38.5') && v6.includes('恶心'));
await shot('06-记录页');

console.log('\n[7] 生成就诊一页纸');
await go(`${BASE}#more`);
await sleep(600);
const v7 = await js(`document.getElementById('view').textContent`);
check('更多页有资料库', v7.includes('就诊资料库'));
check('更多页有备份入口', v7.includes('备份全部数据'));
check('更多页有微信提醒', v7.includes('微信提醒推送'));
await shot('07-更多页');

// 按可见文字点「生成就诊一页纸」（"更多"页已改用 nav-item 结构）
await js(`
  (() => {
    const rows = [...document.querySelectorAll('#view .nav-item, #view .item')];
    const target = rows.find(r => r.textContent.includes('生成就诊一页纸'));
    if (target) target.click();
    return target ? 'clicked' : 'not found';
  })()
`);
await sleep(900);
const sheetTxt = await js(`document.getElementById('sheet-body').textContent`);
check('一页纸含异常指标', /[↑↓]/.test(sheetTxt) || sheetTxt.includes('偏低') || sheetTxt.includes('偏高'));
check('一页纸含诊断', sheetTxt.includes('肺腺癌'));
await shot('08-就诊一页纸');

console.log('\n[8] PWA 与离线能力');
const swReady = await js(`navigator.serviceWorker.getRegistrations().then(r => r.length)`);
check('Service Worker 已注册', swReady >= 1, `注册数 ${swReady}`);
const manifestOk = await js(`fetch('./manifest.webmanifest').then(r=>r.ok)`);
check('manifest 可访问', manifestOk === true);

console.log('\n[9] 无 JS 报错');
check('运行全程无未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${process.exitCode ? '有失败项' : '全部通过'}\n`);
ws.close();
process.exit(process.exitCode || 0);
