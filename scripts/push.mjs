/**
 * 云端定时推送：读 data/upcoming.json，判断今天该提醒什么，发给 Server酱
 *
 * 在 GitHub Actions 里运行，环境变量：
 *   SERVERCHAN_KEY  Server酱 SendKey
 *   FORCE           设为 1 时跳过「今天没内容就不发」的限制（手动测试用）
 *
 * 逻辑：
 *   - 今天的日程 → 早上发「今天要做 X」
 *   - 明天有日程 → 发「明天要做 X，记得准备」
 *   - 3 天内有抽血/复查 → 提前提醒
 *   - 超过 14 天没有同步 → 提醒用户去同步（避免日程过期后静默失效）
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEY = process.env.SERVERCHAN_KEY || '';
const FORCE = process.env.FORCE === '1';
// 脚本在 scripts/ 下，数据在仓库根的 data/ 下
const FILE = fileURLToPath(new URL('../data/upcoming.json', import.meta.url));

const TYPE_NAME = {
  chemo: '化疗', radio: '放疗', immuno: '免疫治疗',
  test: '抽血/复查', shot: '打针', visit: '门诊', other: '其他',
};

function ymd(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return ymd(dt);
}

function diffDays(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

function line(item) {
  const t = TYPE_NAME[item.type] || '安排';
  const time = item.time ? ` ${item.time}` : '';
  const place = item.place ? `（${item.place}）` : '';
  return `· ${t}${time} ${item.title}${place}`;
}

async function main() {
  const today = ymd();

  if (!existsSync(FILE)) {
    console.log('[skip] 还没有 data/upcoming.json，先在网页里点「同步日程到云端」');
    return;
  }

  const raw = await readFile(FILE, 'utf8');
  // 容忍 Windows 编辑器写入的 BOM
  const payload = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const items = Array.isArray(payload.items) ? payload.items : [];

  // 判断数据是否过期
  const generated = payload.generatedAt ? ymd(new Date(payload.generatedAt)) : null;
  const staleDays = generated ? diffDays(generated, today) : 999;

  const todayItems = items.filter((i) => i.date === today);
  const tomorrowItems = items.filter((i) => i.date === addDays(today, 1));
  const soonTests = items.filter((i) => {
    const dd = diffDays(today, i.date);
    return i.type === 'test' && dd >= 2 && dd <= 3;
  });

  // 近 3 天内还有没有事；以及窗口外最近一条（预告用）
  const soonAnything = items.filter((i) => {
    const dd = diffDays(today, i.date);
    return dd >= 0 && dd <= 3;
  });
  const nextBeyond = payload.nextBeyond || null;

  // 组装消息
  const sections = [];

  if (todayItems.length) {
    sections.push(['今天', todayItems.map(line).join('\n')]);
  }
  if (tomorrowItems.length) {
    sections.push(['明天', tomorrowItems.map(line).join('\n')]);
  }
  if (soonTests.length) {
    sections.push(['过两天要检查', soonTests.map((i) => `· ${i.date.slice(5)} ${i.title}`).join('\n')]);
  }

  // 近 3 天都没安排，但有更远的日程 → 给一条预告，让推送不至于完全空白
  if (!soonAnything.length && nextBeyond) {
    sections.push(['接下来的安排',
      `· ${nextBeyond.date.slice(5)} ${nextBeyond.title}（还有 ${nextBeyond.daysLeft} 天）`]);
  }

  if (staleDays > 21) {
    sections.push(['⚠️ 日程很久没更新了',
      `上次同步是 ${generated || '从没同步过'}。打开网页点一次「同步日程到云端」，否则提醒会按旧数据发。`]);
  }

  if (!sections.length) {
    if (FORCE) {
      await send('治疗跟进 · 测试消息',
        `推送链路正常。\n\n今天（${today}）没有需要提醒的日程。\n当前云端有 ${items.length} 条待办日程。`);
      console.log('[forced] 已发送测试消息');
    } else {
      console.log(`[skip] ${today} 没有需要推送的内容`);
    }
    return;
  }

  const name = payload.patient ? `${payload.patient} · ` : '';
  // 标题优先点出今天的事，微信通知栏一眼能看懂
  const title = todayItems.length
    ? `${name}今天有 ${todayItems.length} 件事`
    : tomorrowItems.length
      ? `${name}明天有 ${tomorrowItems.length} 件事`
      : soonAnything.length
        ? `${name}近期有安排`
        : nextBeyond
          ? `${name}下次在 ${nextBeyond.daysLeft} 天后`
          : `${name}治疗提醒`;

  const body = sections
    .map(([h, c]) => `## ${h}\n${c}`)
    .join('\n\n') + `\n\n---\n数据同步于 ${generated || '未知'}`;

  await send(title, body);
  console.log('[sent]', title);
}

async function send(title, desp) {
  if (!KEY) {
    console.error('[error] 没有配置 SERVERCHAN_KEY');
    process.exit(1);
  }
  const url = `https://sctapi.ftqq.com/${KEY}.send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, desp }),
  });
  const text = await res.text();
  console.log('Server酱 响应:', text.slice(0, 300));

  let ok = res.ok;
  try {
    const j = JSON.parse(text);
    // Server酱 成功时 code 为 0
    if (typeof j.code === 'number' && j.code !== 0) ok = false;
  } catch { /* 非 JSON 就用 HTTP 状态判断 */ }

  if (!ok) {
    console.error('[error] 推送失败');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
