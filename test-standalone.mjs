#!/usr/bin/env node
/**
 * 验证安卓 standalone（主屏幕图标）模式
 *
 * 重点：这是你爸实际使用的场景，必须确认
 * 1. 数据能正常存取
 * 2. 离线可用
 * 3. 各页面功能完整
 * 4. 刷新不丢数据
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, mkdir } from 'node:fs/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9960;
const OUT = 'D:\\AI\\.tmp-e2e';
const SITE = 'https://zzzckol.github.io/treatment-tracker/';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
await mkdir(OUT, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=D:\\AI\\.tmp-cdp-sa2', '--window-size=393,852'],
{ stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch {} });

let id = 0; const pending = new Map(); const errs = [];
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no port');
}
const ws = new WebSocket(await wsUrl());
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
});
const send = (method, params = {}, sid) => {
  const i = ++id;
  return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId: sid })); });
};
await new Promise((r) => ws.addEventListener('open', r));

const { result: t } = await send('Target.createTarget', { url: 'about:blank' });
const { result: a } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
const sid = a.sessionId;
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true }, sid);
await send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA }, sid);

const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, sid);
  if (r.result?.exceptionDetails) return '__ERR__' + (r.result.exceptionDetails.exception?.description || '');
  return r.result?.result?.value;
};

let bad = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`); if (!c) bad++; };

console.log('=== 安卓主屏幕图标（standalone）模式验证 ===\n');

await send('Page.navigate', { url: SITE }, sid);
await sleep(6000);
await js(`indexedDB.deleteDatabase('tx-tracker')`);
await sleep(600);
await send('Page.reload', {}, sid);
await sleep(4000);

// 模拟 standalone 模式（隐藏地址栏的效果由系统提供，这里主要验证逻辑）
console.log('[1] 基础环境');
ok('页面加载', (await js(`document.getElementById('view').textContent.length`)) > 20);
ok('SW 已注册', (await js(`navigator.serviceWorker.getRegistrations().then(r => r.length)`)) >= 1);

console.log('\n[2] 空状态下的记录流程');
const btns = await js(`JSON.stringify([...document.querySelectorAll('#view .btn')].map(b => b.textContent.trim()))`);
ok('有「先记一件事」', btns.includes('先记一件事') || btns.includes('不想填资料？先记一件事'), btns);

// 记一条症状（这是你爸最常做的操作）
await js(`
  (() => {
    const b = [...document.querySelectorAll('#view .btn')].find(x => x.textContent.includes('记录今天'));
    if (b) { b.click(); return 'clicked'; }
    const b2 = [...document.querySelectorAll('#view .btn')].find(x => x.textContent.includes('先记一件事'));
    if (b2) { b2.click(); return 'quick'; }
    return 'none';
  })()
`);
await sleep(1000);

// 如果在引导页，先关掉快速日程面板并走症状记录
const maskOn = await js(`document.getElementById('mask')?.classList.contains('on')`);
if (maskOn) {
  await js(`document.getElementById('sheet-x')?.click()`);
  await sleep(400);
  // 填患者名以解锁完整功能
  await js(`
    (async () => {
      const db = await import('./js/db.js');
      await db.saveProfile({ name: '测试', chemoCycleDays: 21 });
      return 'ok';
    })()
  `);
  await send('Page.reload', {}, sid);
  await sleep(3500);
}

ok('有记录今天入口', (await js(`document.getElementById('view').textContent`)).includes('记录今天'));

console.log('\n[3] 保存症状记录');
await js(`
  (() => {
    const b = [...document.querySelectorAll('#view .btn')].find(x => x.textContent.includes('记录今天') || x.textContent.includes('开始记录'));
    if (b) { b.click(); return 1; }
    return 0;
  })()
`);
await sleep(1200);

// 选中度恶心 + 体温
await js(`
  (() => {
    const segs = [...document.querySelectorAll('#sheet-body .seg.lvl')];
    if (segs[0]) {
      const b = segs[0].querySelectorAll('button')[2];
      if (b) b.click();
    }
    const t = document.querySelector('#sheet-body input[type="number"]');
    if (t) {
      t.value = '37.8';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return 'ok';
  })()
`);
await sleep(500);
await js(`(()=>{const b=[...document.querySelectorAll('#sheet-foot .btn')].find(x=>x.textContent.includes('保存'));if(b){b.click();return 1}return 0})()`);
await sleep(2200);

const savedSym = await js(`
  (async () => {
    const db = await import('./js/db.js');
    const s = await db.all('symptoms');
    return JSON.stringify({count: s.length, temp: s[0]?.temp, scores: s[0]?.scores});
  })()
`);
console.log('    ', savedSym);
let sy = {}; try { sy = JSON.parse(savedSym); } catch {}
ok('症状已保存', sy.count === 1, String(sy.count));
ok('体温正确', sy.temp === 37.8, String(sy.temp));
ok('评分已存', sy.scores && Object.keys(sy.scores).length > 0, JSON.stringify(sy.scores));

// 关闭建议弹窗
await js(`document.getElementById('sheet-x')?.click()`);
await sleep(500);

console.log('\n[4] 刷新后数据还在（最关键）');
await send('Page.reload', {}, sid);
await sleep(4000);
const afterReload = await js(`
  (async () => {
    const db = await import('./js/db.js');
    const s = await db.all('symptoms');
    return s.length;
  })()
`);
ok('刷新后数据保留', afterReload === 1, String(afterReload));

console.log('\n[5] 建议功能正常');
const advice = await js(`document.getElementById('view').textContent`);
ok('有建议提示', advice.includes('建议') || advice.includes('留意'), advice.slice(0, 60).replace(/\s+/g, ' '));

console.log('\n[6] 离线可用（SW 缓存）');
await send('Network.enable', {}, sid);
await send('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
}, sid);
await send('Page.reload', {}, sid);
await sleep(4000);
const offlineView = await js(`document.getElementById('view')?.textContent?.length || 0`);
ok('断网后仍能打开', offlineView > 20, `${offlineView} 字符`);
await send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
}, sid);

console.log('\n[7] 各页面可用');
await sleep(1000);
for (const pg of ['plan', 'labs', 'syms', 'more']) {
  await js(`document.querySelector('#tabbar button[data-page="${pg}"]')?.click()`);
  await sleep(900);
  const len = await js(`document.getElementById('view').textContent.length`);
  ok(`页面 ${pg} 正常`, len > 20, `${len} 字符`);
}

console.log('\n[8] 无 JS 错误');
ok('无异常', errs.length === 0, errs.slice(0, 2).join(' | '));

const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
if (shot.result?.data) await writeFile(`${OUT}\\android-standalone.png`, Buffer.from(shot.result.data, 'base64'));

console.log(`\n${bad ? '有失败项' : '全部通过'}\n`);
ws.close();
chrome.kill();
process.exit(bad ? 1 : 0);
