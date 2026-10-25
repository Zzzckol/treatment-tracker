#!/usr/bin/env node
/** 测试安卓环境下的适配：UA 检测、安装引导、微信警告 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, mkdir } from 'node:fs/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9890;
const OUT = 'D:\\AI\\.tmp-e2e';
const SITE = 'http://127.0.0.1:8765/index.html';
await mkdir(OUT, { recursive: true });

const UAS = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidWeChat: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.40.2420(0x28002851) WeChat/arm64',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

let bad = 0;
const ok = (l, c, x = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`); if (!c) bad++; };

async function makeSession(port) {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    `--remote-debugging-port=${port}`, `--user-data-dir=D:\\AI\\.tmp-cdp-and-${port}`, '--window-size=393,852'],
  { stdio: 'ignore' });

  let id = 0; const pending = new Map();
  async function wsUrl() {
    for (let i = 0; i < 60; i++) {
      try {
        const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
      } catch {}
      await sleep(250);
    }
    throw new Error('no port');
  }
  const ws = new WebSocket(await wsUrl());
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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
  const js = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true }, sid);
    if (r.result?.exceptionDetails) return '__ERR__';
    return r.result?.result?.value;
  };
  return { chrome, ws, send, sid, js };
}

// ===== 安卓 Chrome =====
console.log('=== 场景1：安卓 Chrome 浏览器 ===');
let s = await makeSession(PORT);
await s.send('Emulation.setUserAgentOverride', { userAgent: UAS.androidChrome }, s.sid);
await s.send('Page.navigate', { url: SITE }, s.sid);
await sleep(3500);
await s.js(`indexedDB.deleteDatabase('tx-tracker')`);
await s.send('Page.reload', {}, s.sid);
await sleep(2800);

const env1 = await s.js(`
  (() => {
    const ua = navigator.userAgent;
    return JSON.stringify({
      isAndroid: /Android/i.test(ua),
      isWeChat: /MicroMessenger/i.test(ua),
      standalone: window.matchMedia('(display-mode: standalone)').matches
    });
  })()
`);
console.log('    环境:', env1);
let e1 = {}; try { e1 = JSON.parse(env1); } catch {}
ok('识别为安卓', e1.isAndroid === true);
ok('不在微信里', e1.isWeChat === false);

await s.js(`document.querySelector('#tabbar button[data-page="more"]').click()`);
await sleep(1200);
const more1 = await s.js(`document.getElementById('view').textContent`);
ok('更多页有「装到手机桌面」', more1.includes('装到手机桌面'));
ok('提示是安卓文案', more1.includes('安卓') || more1.includes('安装为 App'), '');
ok('没有微信警告条', !(await s.js(`!!document.querySelector('body > div[style*="8d5a10"]')`)));

await s.js(`
  (() => {
    const r = [...document.querySelectorAll('#view .nav-item')].find(x => x.textContent.includes('装到手机桌面'));
    if (r) { r.click(); return 1; }
    return 0;
  })()
`);
await sleep(900);
const sheet1 = await s.js(`document.getElementById('sheet-body').textContent`);
ok('安装面板打开', sheet1.length > 30);
ok('说明安卓能真正安装', sheet1.includes('真正装') || sheet1.includes('更好用'));
ok('有 Chrome 步骤', sheet1.includes('Chrome') || sheet1.includes('三个点'));
ok('有国产浏览器步骤', sheet1.includes('国产') || sheet1.includes('自带'));
ok('提醒数据隔离', sheet1.includes('微信') && (sheet1.includes('看不到') || sheet1.includes('重新')));

const shot1 = await s.send('Page.captureScreenshot', { format: 'png' }, s.sid);
if (shot1.result?.data) await writeFile(`${OUT}\\android-install.png`, Buffer.from(shot1.result.data, 'base64'));

s.ws.close(); s.chrome.kill();
await sleep(1000);

// ===== 安卓微信 =====
console.log('\n=== 场景2：安卓微信内置浏览器 ===');
s = await makeSession(PORT + 1);
await s.send('Emulation.setUserAgentOverride', { userAgent: UAS.androidWeChat }, s.sid);
await s.send('Page.navigate', { url: SITE }, s.sid);
await sleep(4000);

const env2 = await s.js(`
  (() => {
    const ua = navigator.userAgent;
    return JSON.stringify({ isWeChat: /MicroMessenger/i.test(ua), isAndroid: /Android/i.test(ua) });
  })()
`);
console.log('    环境:', env2);
let e2 = {}; try { e2 = JSON.parse(env2); } catch {}
ok('识别为微信内', e2.isWeChat === true);

const warn = await s.js(`
  (() => {
    const bars = [...document.querySelectorAll('body > div')];
    const warn = bars.find(b => b.textContent && b.textContent.includes('存在微信里'));
    return warn ? warn.textContent.slice(0, 80) : '';
  })()
`);
ok('出现微信警告条', warn.length > 0, warn);
ok('警告说明数据隔离', warn.includes('微信里') || warn.includes('找不到'));

const shot2 = await s.send('Page.captureScreenshot', { format: 'png' }, s.sid);
if (shot2.result?.data) await writeFile(`${OUT}\\android-wechat-warn.png`, Buffer.from(shot2.result.data, 'base64'));

// 微信里点安装应该被拦截
await s.js(`document.querySelector('#tabbar button[data-page="more"]').click()`);
await sleep(1000);
await s.js(`
  (() => {
    const r = [...document.querySelectorAll('#view .nav-item')].find(x => x.textContent.includes('装到手机桌面'));
    if (r) { r.click(); return 1; }
    return 0;
  })()
`);
await sleep(800);
const sheet2 = await s.js(`document.getElementById('sheet-body').textContent`);
ok('微信里提示装不了', sheet2.includes('装不了') || sheet2.includes('不支持'));
ok('给了复制网址的引导', sheet2.includes('复制') && sheet2.includes('浏览器'));

s.ws.close(); s.chrome.kill();
await sleep(1000);

// ===== iOS 对照 =====
console.log('\n=== 场景3：iPhone Safari（对照）===');
s = await makeSession(PORT + 2);
await s.send('Emulation.setUserAgentOverride', { userAgent: UAS.iosSafari }, s.sid);
await s.send('Page.navigate', { url: SITE }, s.sid);
await sleep(3500);

const env3 = await s.js(`
  (() => {
    const ua = navigator.userAgent;
    return JSON.stringify({ isIOS: /iPhone|iPad|iPod/.test(ua), isAndroid: /Android/i.test(ua) });
  })()
`);
console.log('    环境:', env3);
let e3 = {}; try { e3 = JSON.parse(env3); } catch {}
ok('识别为 iOS', e3.isIOS === true);
ok('不是安卓', e3.isAndroid === false);

await s.js(`document.querySelector('#tabbar button[data-page="more"]').click()`);
await sleep(1100);
const more3 = await s.js(`document.getElementById('view').textContent`);
ok('iOS 提示文案不同', more3.includes('Safari') || more3.includes('分享'), '');

s.ws.close(); s.chrome.kill();

console.log(`\n${bad ? '有失败项' : '全部通过'}`);
process.exit(bad ? 1 : 0);
