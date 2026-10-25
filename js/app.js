/**
 * 主应用：页面渲染与交互
 */

import * as db from './db.js';
import {
  el, esc, toast, today, ymd, addDays, daysBetween, fmtMD, fmtYMD, weekday,
  relDay, nowHHMM, sparkline, fmtNum, download, openSheet, closeSheet,
  initSheet, confirmAsk, pad,
} from './utils.js';
import {
  LAB_PANELS, LAB_INDEX, SYMPTOMS, SYMPTOM_INDEX, SYMPTOM_GROUPS, LEVELS,
  APPT_TYPES, APPT_TYPE_INDEX, DOC_KINDS, judge, checkRedFlags, displayValue,
} from './catalog.js';
import {
  buildCyclePlan, buildRadioPlan, mergePlan, nextAppointment, nextTest,
  typeMeta, toICS, buildReminderPayload,
} from './plan.js';
import { buildExtractPrompt, validateBundle, applyBundle } from './import.js';
import { parseImportHash, fetchEncryptedBundle } from './linkimport.js';

/* ==========================================================
   状态
   ========================================================== */

const S = {
  page: 'today',
  profile: null,
  appts: [],
  labs: [],
  syms: [],
  docs: [],
  notes: [],
};

const view = () => document.getElementById('view');

/* ==========================================================
   启动
   ========================================================== */

async function boot() {
  initSheet();
  bindTabs();
  bindFab();
  initFabAutoHide();

  S.profile = await db.getProfile();
  await reload();

  // 支持 #page 直达
  const hash = location.hash.replace('#', '');
  if (['today', 'plan', 'labs', 'syms', 'more'].includes(hash)) S.page = hash;
  render();

  window.addEventListener('hashchange', () => {
    const p = location.hash.replace('#', '');
    if (['today', 'plan', 'labs', 'syms', 'more'].includes(p) && p !== S.page) {
      S.page = p; render();
    }
  });

  registerSW();
  initPullToRefresh();

  // 链接导入：地址里带 #import= 时自动拉取并导入
  handleLinkImport();
}

/** 处理 #import=slug.key 形式的链接导入 */
async function handleLinkImport() {
  const parsed = parseImportHash(location.hash);
  if (!parsed) return;

  // 清掉 hash，避免刷新时重复导入
  history.replaceState(null, '', location.pathname + location.search);

  const body = el('div', {});
  body.append(el('div', { class: 'alert info' }, [
    el('div', { class: 't' }, '正在导入数据'),
    el('div', { class: 'tiny', style: 'margin-top:4px' }, '从链接读取并解密，大约几秒…'),
  ]));
  const status = el('div', { class: 'muted', style: 'text-align:center;padding:20px 0' }, '读取中…');
  body.append(status);
  openSheet({ title: '导入数据', body, footer: [] });

  try {
    const base = location.href.replace(/[^/]*$/, '');
    const bundle = await fetchEncryptedBundle(parsed, base);

    const counts = {
      labs: bundle.labs?.length || 0,
      appointments: bundle.appointments?.length || 0,
      docs: bundle.docs?.length || 0,
      symptoms: bundle.symptoms?.length || 0,
    };

    status.remove();
    body.append(el('div', { class: 'card plain' }, [
      el('div', { class: 'tiny', style: 'font-weight:700;margin-bottom:8px' }, '识别到'),
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, '患者'), el('span', { class: 'v' }, bundle.profile?.name || '-')]),
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, '化验单'), el('span', { class: 'v' }, counts.labs + ' 次')]),
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, '日程'), el('span', { class: 'v' }, counts.appointments + ' 条')]),
      el('div', { class: 'kv' }, [el('span', { class: 'k' }, '资料'), el('span', { class: 'v' }, counts.docs + ' 份')]),
    ]));

    body.append(el('div', { class: 'alert warn', style: 'margin-top:10px' }, [
      el('div', { class: 'tiny' }, '导入会合并到现有数据。同一天的化验会合并，不会重复。'),
    ]));

    const foot = document.getElementById('sheet-foot');
    foot.replaceChildren();
    foot.append(el('button', { class: 'btn', onclick: closeSheet }, '取消'));
    foot.append(el('button', {
      class: 'btn primary',
      onclick: async () => {
        const c = await applyBundle(bundle);
        await reload();
        closeSheet();
        render();
        toast(`导入完成：${c.labs} 次化验、${c.appointments} 条日程、${c.docs} 份资料`, 3500);
      },
    }, '确认导入'));
  } catch (e) {
    status.remove();
    body.append(el('div', { class: 'alert bad' }, [
      el('div', { class: 't' }, '导入失败'),
      el('div', { class: 'tiny', style: 'margin-top:4px;line-height:1.6' }, e.message),
    ]));
    body.append(el('div', { class: 'tiny muted', style: 'margin-top:8px' },
      '也可以手动导入：更多 → 批量导入资料，把 JSON 内容粘贴进去。'));
    const foot = document.getElementById('sheet-foot');
    foot.replaceChildren();
    foot.append(el('button', { class: 'btn', onclick: closeSheet }, '关闭'));
  }
}

async function reload() {
  [S.appts, S.labs, S.syms, S.docs, S.notes] = await Promise.all([
    db.allByDate('appointments'),
    db.allByDate('labs'),
    db.allByDate('symptoms'),
    db.allByDate('docs'),
    db.allByDate('notes'),
  ]);
  S.profile = await db.getProfile();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('./sw.js').catch(() => {});

  // 新版本就绪时，提示用户
  navigator.serviceWorker.addEventListener('message', (ev) => {
    const d = ev.data || {};
    if (d.type === 'UPDATE_STATUS' && d.hasUpdate) {
      showUpdateBanner();
    }
    if (d.type === 'CACHE_CLEARED') {
      location.reload();
    }
  });

  // 首次注册时如果已有 waiting，也提示
  navigator.serviceWorker.ready.then((reg) => {
    if (reg.waiting) showUpdateBanner();
  });
}

/* ---------- 刷新与更新 ---------- */

let _refreshing = false;

/** 重新从本地库读取并重绘（不重新加载页面） */
async function refreshData(silent = false) {
  if (_refreshing) return;
  _refreshing = true;
  try {
    await reload();
    render();
    if (!silent) toast('已刷新');
  } catch (e) {
    if (!silent) toast('刷新失败：' + e.message);
  } finally {
    _refreshing = false;
  }
}

/** 强制拉取最新版本并重载页面 */
async function forceUpdate() {
  toast('正在更新…');
  try {
    // 关键顺序：先注销 Service Worker，再清缓存，否则运行中的
    // SW 会在删除的同时又把响应写回缓存，导致清不掉。
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      await reg.unregister();
    }

    // 清空所有缓存
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));

    // 绕过 HTTP 缓存重新加载
    const url = new URL(location.href);
    url.searchParams.set('_u', Date.now().toString(36));
    location.replace(url.toString());
  } catch (e) {
    // 兜底：至少做一次硬刷新
    location.reload();
  }
}

/** 顶部更新提示条 */
function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  const bar = el('div', { id: 'update-banner' });
  bar.append(el('span', { class: 'txt' }, '有新版本'));
  bar.append(el('button', { onclick: forceUpdate }, '更新'));
  bar.append(el('button', {
    class: 'x', 'aria-label': '关闭',
    onclick: () => bar.remove(),
  }, '×'));
  document.body.append(bar);
}

/**
 * 下拉刷新
 *
 * PWA 独立模式和安卓 Chrome 里，页面滚到顶部再往下拉，触发刷新。
 * iOS 的 Safari 不支持下拉刷新 PWA，所以这个手势自己实现。
 */
function initPullToRefresh() {
  const THRESHOLD = 70;      // 拉过这个距离才触发
  const MAX_PULL = 110;      // 最多能拉这么远

  let startY = 0;
  let pulling = false;
  let pullDist = 0;

  const indicator = el('div', { id: 'ptr' });
  indicator.append(el('div', { class: 'spin' }, '↓'));
  document.body.append(indicator);

  const setIndicator = (dist) => {
    if (dist <= 0) {
      indicator.style.transform = 'translate(-50%, -48px)';
      indicator.style.opacity = '0';
      return;
    }
    const capped = Math.min(dist, MAX_PULL);
    indicator.style.transform = `translate(-50%, ${Math.min(capped, 48) - 48}px)`;
    indicator.style.opacity = String(Math.min(1, capped / 50));
    indicator.classList.toggle('ready', capped >= THRESHOLD);
    indicator.firstChild.textContent = capped >= THRESHOLD ? '↑' : '↓';
    indicator.firstChild.style.transform = `rotate(${capped >= THRESHOLD ? 180 : 0}deg)`;
  };

  const onStart = (y) => {
    // 只有滚动在顶部才能下拉
    if (window.scrollY > 2) return;
    if (document.getElementById('mask')?.classList.contains('on')) return;
    startY = y;
    pulling = true;
    pullDist = 0;
  };

  const onMove = (y, ev) => {
    if (!pulling) return;
    const dist = y - startY;
    if (dist <= 0) {
      if (pullDist > 0) { pullDist = 0; setIndicator(0); }
      return;
    }
    // 阻尼：越拉越费劲
    pullDist = dist * 0.5;
    if (pullDist > 3) {
      setIndicator(pullDist);
      // 阻止页面橡皮筋，让手势可控
      if (ev.cancelable && pullDist > 6) ev.preventDefault();
    }
  };

  const onEnd = async () => {
    if (!pulling) return;
    pulling = false;
    const shouldRefresh = pullDist >= THRESHOLD;
    if (shouldRefresh) {
      indicator.classList.add('loading');
      indicator.firstChild.textContent = '↻';
      indicator.style.transform = 'translate(-50%, 8px)';
      indicator.style.opacity = '1';
    } else {
      setIndicator(0);
    }
    const d = pullDist;
    pullDist = 0;
    if (shouldRefresh) {
      await refreshData(true);
      toast('已刷新');
      indicator.classList.remove('loading');
      setIndicator(0);
    } else if (d > 0) {
      setIndicator(0);
    }
  };

  // 触摸
  window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    onStart(e.touches[0].clientY);
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    onMove(e.touches[0].clientY, e);
  }, { passive: false });

  window.addEventListener('touchend', () => onEnd(), { passive: true });
  window.addEventListener('touchcancel', () => onEnd(), { passive: true });

  // 鼠标（桌面调试用）
  let mouseDown = false;
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    mouseDown = true;
    onStart(e.clientY);
  });
  window.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;
    onMove(e.clientY, e);
  });
  window.addEventListener('mouseup', () => {
    if (!mouseDown) return;
    mouseDown = false;
    onEnd();
  });
}

/** 悬浮按钮已弃用，此函数保留为空操作以兼容旧调用 */
function initFabAutoHide() {
  // 悬浮按钮会遮挡窄屏正文，已改为页面内顶部操作按钮。
}

/* ==========================================================
   导航
   ========================================================== */

function bindTabs() {
  document.getElementById('tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-page]');
    if (!b) return;
    S.page = b.dataset.page;
    location.hash = S.page;
    render();
    window.scrollTo({ top: 0 });
  });
}

function bindFab() {
  // 悬浮按钮已弃用（窄屏会遮挡内容），改为各页顶部的内联操作按钮。
  // 这里保留绑定以兼容，但元素已由 CSS 隐藏。
  const fab = document.getElementById('fab');
  if (fab) fab.addEventListener('click', () => primaryAction());
}

/** 当前页面的主要新增动作 */
function primaryAction() {
  const map = {
    today: openApptSheet,
    plan: openApptSheet,
    labs: openLabSheet,
    syms: openSymSheet,
    more: openApptSheet,
  };
  (map[S.page] || openApptSheet)();
}

/** 在页面顶部渲染操作按钮行 */
function pageActions(items) {
  const row = el('div', { class: 'page-actions' });
  for (const it of items) {
    row.append(el('button', {
      class: 'btn' + (it.primary ? ' primary' : ''),
      onclick: it.fn,
    }, it.label));
  }
  return row;
}

function render() {
  document.querySelectorAll('#tabbar button').forEach((b) => {
    if (b.dataset.page === S.page) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  const fab = document.getElementById('fab');
  if (fab) fab.style.display = 'none';

  const p = S.profile;  document.getElementById('hd-who').textContent = p.name ? `${p.name} · 治疗跟进` : '治疗跟进';
  const d = new Date();
  document.getElementById('hd-date').textContent = `${d.getMonth() + 1}/${d.getDate()} 周${weekday(today())}`;

  const titles = {
    today: '今天该做什么',
    plan: '治疗日程',
    labs: '检查指标',
    syms: '每日记录',
    more: '更多',
  };
  document.getElementById('hd-sub').textContent = titles[S.page] || '';

  const fn = { today: pageToday, plan: pagePlan, labs: pageLabs, syms: pageSyms, more: pageMore }[S.page];
  view().replaceChildren();
  fn();
}

/* ==========================================================
   页面一：今天
   ========================================================== */

function pageToday() {
  const t = today();
  const v = view();

  // 未填患者信息时引导
  if (!S.profile.name) {
    v.append(el('div', { class: 'alert info' }, [
      el('div', { class: 't' }, '先花两分钟填一下基本信息'),
      el('div', {}, '填完之后，日程可以自动往后排，指标也能按他的情况提示异常。'),
    ]));
    v.append(el('button', { class: 'btn primary block', onclick: openProfileSheet }, '去填基本信息'));
    v.append(monthlySummary());
    return;
  }

  v.append(pageActions([
    { label: '记录今天', fn: () => openSymSheet(), primary: true },
    { label: '加日程', fn: () => openApptSheet() },
  ]));

  // 红线提示：最近 3 天的记录
  // 设计：默认折成一行紧凑条，点开才展开详情 —— 避免首屏被红框吃掉
  const recent = S.syms.filter((r) => daysBetween(r.date, t) <= 3 && daysBetween(r.date, t) >= 0);
  const flags = [];
  for (const r of recent) {
    for (const m of checkRedFlags(r)) if (!flags.includes(m)) flags.push(m);
  }
  if (flags.length) {
    const bar = el('button', {
      class: 'alert bad compact',
      style: 'width:100%;text-align:left;font-family:inherit;cursor:pointer;border-width:1px',
      onclick: () => {
        const box = el('div', {});
        box.append(el('div', { class: 'alert bad', style: 'margin-bottom:12px' }, [
          el('div', { class: 't' }, '这几条建议今天就联系医生'),
          ...flags.map((m) => el('div', { text: '· ' + m })),
        ]));
        box.append(el('p', { class: 'muted tiny' },
          '这些提示来自你最近记录的体温和症状。它不替代医生判断，但这类情况通常不建议拖到下次门诊。'));
        openSheet({
          title: '需要留意',
          body: box,
          footer: [
            el('button', { class: 'btn', onclick: closeSheet }, '知道了'),
            el('button', {
              class: 'btn primary',
              onclick: () => {
                closeSheet();
                if (S.profile.doctorPhone) location.href = 'tel:' + S.profile.doctorPhone;
                else toast('还没填医生电话，可以去「更多 → 患者信息」补上');
              },
            }, S.profile.doctorPhone ? '拨打医生电话' : '联系医生'),
          ],
        });
      },
    });
    bar.append(el('span', { class: 'ico' }, '⚠'));
    bar.append(el('span', { class: 'txt' }, flags.length === 1 ? '有一条需要今天联系医生' : `${flags.length} 条需要今天联系医生`));
    bar.append(el('span', { class: 'chev', style: 'color:#a8322a;flex-shrink:0;font-size:15px' }, '›'));
    v.append(bar);
  }

  // 今天 / 最近日程
  const todays = S.appts.filter((a) => a.date === t);
  const next = nextAppointment(S.appts);

  const hero = el('div', { class: 'hero' });
  if (todays.length) {
    hero.append(el('div', { class: 'hero-label' }, '今天'));
    hero.append(el('div', { class: 'bigline' }, todays.length === 1 ? todays[0].title : `今天有 ${todays.length} 件事`));
    if (todays.length > 1) {
      hero.append(el('div', { class: 'subline' }, todays.map((a) => a.title).join('、')));
    } else {
      const sub = [typeMeta(todays[0].type).name];
      if (todays[0].time) sub.push(todays[0].time);
      if (todays[0].place) sub.push(todays[0].place);
      hero.append(el('div', { class: 'subline' }, sub.join(' · ')));
    }
  } else if (next) {
    const dd = daysBetween(t, next.date);
    hero.append(el('div', { class: 'hero-label' }, '下一次'));
    hero.append(el('div', { class: 'bigline' }, next.title));
    const cd = el('div', { class: 'countdown' });
    cd.append(el('span', { class: 'num' }, String(dd)));
    cd.append(el('span', { class: 'unit' }, `天后 · ${fmtMD(next.date)} 周${weekday(next.date)}${next.time ? ' ' + next.time : ''}`));
    hero.append(cd);
    if (next.place) hero.append(el('div', { class: 'subline', style: 'margin-top:4px' }, next.place));
  } else {
    hero.append(el('div', { class: 'bigline' }, '暂时没有安排下一次'));
    hero.append(el('div', { class: 'subline' }, '在「日程」里加一条，或者用治疗方案自动排期'));
  }

  // 周期进度条：让「治到哪一步了」一眼可见
  const doneChemo = S.appts.filter((a) => a.type === 'chemo' && a.done).length;
  const totalChemo = S.appts.filter((a) => a.type === 'chemo').length;
  if (totalChemo > 0) {
    const pct = Math.round((doneChemo / totalChemo) * 100);
    const pg = el('div', { class: 'progress' });
    const bar2 = el('div', { class: 'progress-bar' });
    bar2.append(el('div', { class: 'progress-fill', style: `width:${pct}%` }));
    pg.append(bar2);
    pg.append(el('div', { class: 'progress-text' }, `化疗进度 ${doneChemo}/${totalChemo} 周期`));
    hero.append(pg);
  }
  v.append(hero);

  // 今天要做的清单
  if (todays.length) {
    const c = el('div', { class: 'card' });
    c.append(el('div', { class: 'card-head' }, [
      el('h2', {}, '今天要做'),
      el('span', { class: 'hint' }, '做完点一下'),
    ]));
    for (const a of todays) {
      const done = !!a.done;
      const b = el('button', {
        class: 'checkbtn',
        'aria-pressed': done ? 'true' : 'false',
        onclick: async () => {
          a.done = !a.done;
          a.doneAt = a.done ? new Date().toISOString() : null;
          await db.put('appointments', a);
          await reload();
          render();
          if (a.done) toast('已标记完成');
        },
      });
      b.append(el('span', { class: 'box' }, done ? '✓' : ''));
      const meta = el('span', { class: 'body', style: 'flex:1;min-width:0' });
      meta.append(el('div', { class: 'lbl' }, a.title));
      const sub = [typeMeta(a.type).name];
      if (a.time) sub.push(a.time);
      if (a.place) sub.push(a.place);
      meta.append(el('div', { class: 'sm' }, sub.join(' · ')));
      b.append(meta);
      c.append(b);
    }
    v.append(c);
  }

  // 今天记录了吗
  const hasToday = S.syms.some((r) => r.date === t);
  const recCard = el('div', { class: 'card' });
  recCard.append(el('div', { class: 'card-head' }, [
    el('h2', {}, '今天的记录'),
    el('span', { class: 'hint' }, hasToday ? '已记录，可继续修改' : '花 30 秒'),
  ]));
  if (hasToday) {
    const r = S.syms.filter((x) => x.date === t).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    recCard.append(symSummaryLine(r));
    recCard.append(el('button', { class: 'btn block', style: 'margin-top:6px', onclick: () => openSymSheet(r) }, '修改今天的记录'));
  } else {
    recCard.append(el('div', { class: 'muted', style: 'margin-bottom:10px' },
      '今天胃口、精神、有没有哪里不舒服，随手点几下就行。医生复诊时问起来，这个比回忆靠谱。'));
    recCard.append(el('button', { class: 'btn primary block', onclick: () => openSymSheet() }, '开始记录'));
  }
  v.append(recCard);

  // 最近指标异常
  const abnormal = latestAbnormal();
  if (abnormal.length) {
    const c = el('div', { class: 'card' });
    c.append(el('div', { class: 'card-head' }, [
      el('h2', {}, '最近化验有异常'),
      el('span', { class: 'hint' }, abnormal[0].date ? fmtMD(abnormal[0].date) : ''),
    ]));
    for (const a of abnormal.slice(0, 6)) {
      const row = el('div', { class: 'labrow' });
      row.append(el('div', {}, [
        el('div', { class: 'nm' }, a.name),
        el('div', { class: 'rf' }, `参考 ${fmtNum(a.lo)}–${fmtNum(a.hi)}`),
      ]));
      row.append(el('div', { class: 'val ' + a.flag }, [
        document.createTextNode(fmtNum(a.value)),
        el('span', { class: 'u' }, a.unit || ''),
      ]));
      row.append(el('div', { class: 'arrow' }, a.flag === 'high' ? '偏高' : '偏低'));
      c.append(row);
    }
    c.append(el('button', { class: 'btn block', style: 'margin-top:8px', onclick: () => { S.page = 'labs'; location.hash = 'labs'; render(); } }, '看完整趋势'));
    v.append(c);
  }

  v.append(monthlySummary());
}

function symSummaryLine(r) {
  const bad = Object.entries(r.scores || {})
    .filter(([, v]) => v >= 2)
    .map(([k, v]) => `${SYMPTOM_INDEX.get(k)?.name || k} ${LEVELS[v]}`)
    .slice(0, 4);
  const wrap = el('div', {});
  if (r.temp) wrap.append(el('div', { class: 'kv' }, [
    el('span', { class: 'k' }, '体温'),
    el('span', { class: 'v', style: r.temp >= 38.3 ? 'color:#e0534a' : '' }, `${r.temp}℃`),
  ]));
  const any = Object.values(r.scores || {}).filter((x) => x > 0).length;
  wrap.append(el('div', { class: 'kv' }, [
    el('span', { class: 'k' }, '不舒服的项'),
    el('span', { class: 'v' }, any ? `${any} 项` : '都没有'),
  ]));
  if (bad.length) {
    wrap.append(el('div', { class: 'tiny', style: 'margin-top:6px;color:#b5691a' }, '需要留意：' + bad.join('、')));
  } else if (r.note) {
    wrap.append(el('div', { class: 'tiny muted', style: 'margin-top:6px' }, r.note));
  }
  return wrap;
}

function latestAbnormal() {
  if (!S.labs.length) return [];
  // 每个 code 取最新一次
  const lastByCode = new Map();
  for (const row of S.labs) {
    for (const [code, val] of Object.entries(row.values || {})) {
      if (val === '' || val == null) continue;
      const prev = lastByCode.get(code);
      if (!prev || row.date > prev.date) {
        lastByCode.set(code, { code, value: Number(val), date: row.date });
      }
    }
  }
  const out = [];
  for (const [code, rec] of lastByCode) {
    const it = LAB_INDEX.get(code);
    if (!it) continue;
    const flag = judge(code, rec.value);
    if (flag === 'ok') continue;
    const dv = displayValue(code, rec.value);
    out.push({
      code, name: it.name, unit: dv.unit, lo: dv.lo, hi: dv.hi,
      flag, value: dv.value, raw: rec.value, date: rec.date,
    });
  }
  out.sort((a, b) => {
    const sa = LAB_INDEX.get(a.code)?.star ? 0 : 1;
    const sb = LAB_INDEX.get(b.code)?.star ? 0 : 1;
    return sa - sb || b.date.localeCompare(a.date);
  });
  return out;
}

function monthlySummary() {
  const t = today();
  const from = addDays(t, -30);
  const nSym = S.syms.filter((r) => r.date >= from).length;
  const nLab = S.labs.filter((r) => r.date >= from).length;
  const c = el('div', { class: 'card plain' });
  c.append(el('div', { class: 'card-head' }, [el('h2', {}, '近 30 天')]));
  const row = el('div', { style: 'display:flex;gap:8px' });
  const cell = (label, val) => {
    const d = el('div', { style: 'flex:1;text-align:center' });
    d.append(el('div', {
      style: 'font-size:var(--fs-lg);font-weight:800;color:var(--ink-1);font-variant-numeric:tabular-nums;line-height:1.2',
    }, String(val)));
    d.append(el('div', { style: 'font-size:var(--fs-2xs);color:var(--ink-3);margin-top:2px' }, label));
    return d;
  };
  row.append(cell('症状记录', nSym + ' 天'));
  row.append(cell('化验单', nLab + ' 次'));
  row.append(cell('完成日程', S.appts.filter((a) => a.done && a.date >= from).length + ' 项'));
  c.append(row);
  return c;
}

/* ==========================================================
   页面二：日程
   ========================================================== */

function pagePlan() {
  const v = view();
  const t = today();

  const upcoming = S.appts.filter((a) => a.date >= t).sort((a, b) => a.date.localeCompare(b.date));
  const past = S.appts.filter((a) => a.date < t).sort((a, b) => b.date.localeCompare(a.date));

  if (!S.appts.length) {
    v.append(el('div', { class: 'card' }, [
      el('div', { class: 'empty' }, [
        el('div', { class: 'big' }, '▤'),
        el('div', {}, '还没有日程'),
        el('div', { class: 'tiny', style: 'margin-top:8px' },
          '可以手动加一条，也可以告诉我化疗周期天数，我一次把 6 个周期全排出来。'),
      ]),
      el('button', { class: 'btn primary block', onclick: openCycleSheet }, '按治疗方案自动排期'),
      el('button', { class: 'btn block', style: 'margin-top:8px', onclick: () => openApptSheet() }, '手动加一条'),
    ]));
    return;
  }

  // 顶部操作
  v.append(pageActions([
    { label: '自动排期', fn: openCycleSheet, primary: true },
    { label: '排放疗', fn: openRadioSheet },
    { label: '存日历', fn: openICS },
  ]));

  if (upcoming.length) {
    v.append(el('div', { class: 'section-title' }, '接下来的'));
    v.append(apptList(upcoming, false));
  }
  if (past.length) {
    v.append(el('div', { class: 'section-title' }, '已经过去的'));
    v.append(apptList(past.slice(0, 30), true));
  }
}

function apptList(list, isPast) {
  const wrap = el('div', { class: 'card' });
  let lastDate = null;
  for (const a of list) {
    if (a.date !== lastDate) {
      lastDate = a.date;
      const dRow = el('div', {
        class: 'tiny',
        style: 'font-weight:700;color:#4a5f73;margin:10px 0 2px;padding-top:6px',
      }, `${fmtYMD(a.date)} 周${weekday(a.date)} · ${relDay(a.date)}`);
      if (wrap.childElementCount === 0) dRow.style.marginTop = '0';
      wrap.append(dRow);
    }
    const meta = typeMeta(a.type);
    const item = el('div', { class: 'item', onclick: () => openApptSheet(a) });
    const body = el('div', { class: 'body' });
    const titleRow = el('div', { class: 'title' });
    titleRow.append(el('span', { class: 'tag', style: `background:${hexSoft(meta.color)};color:${meta.color}` }, meta.name));
    titleRow.append(document.createTextNode(' ' + a.title));
    body.append(titleRow);
    const bits = [];
    if (a.time) bits.push(a.time);
    if (a.place) bits.push(a.place);
    if (a.note) bits.push(a.note);
    if (bits.length) body.append(el('div', { class: 'meta' }, bits.join(' · ')));
    item.append(body);

    const tail = el('div', { class: 'tail' });
    if (a.done) {
      tail.append(el('span', { class: 'tag ok' }, '已完成'));
    } else if (isPast) {
      tail.append(el('span', { class: 'tag grey' }, '未标记'));
    }
    item.append(tail);
    wrap.append(item);
  }
  return wrap;
}

function hexSoft(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c + (255 - c) * 0.86);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/* ---------- 日程编辑 ---------- */

function openApptSheet(existing) {
  const a = existing || { date: today(), time: '', type: 'chemo', title: '', place: S.profile.hospital || '', note: '', done: false };
  const body = el('div', {});

  const fDate = el('input', { type: 'date', value: a.date });
  body.append(field('日期', fDate));
  const fTime = el('input', { type: 'time', value: a.time || '' });
  body.append(field('时间（可不填）', fTime));

  const typeSeg = el('div', { class: 'seg' });
  for (const t of APPT_TYPES) {
    const b = el('button', { type: 'button', 'aria-pressed': a.type === t.id ? 'true' : 'false' }, t.name);
    b.addEventListener('click', () => {
      typeSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      a.type = t.id;
      if (!fTitle.value || APPT_TYPE_INDEX.get(a._lastType || '')?.name === fTitle.value) {
        // 只在标题为空时自动填，避免覆盖用户输入
        if (!fTitle.value) fTitle.value = t.name;
      }
    });
    typeSeg.append(b);
  }
  body.append(field('类型', typeSeg));

  const fTitle = el('input', { type: 'text', value: a.title || '', placeholder: '例如：化疗 第 3 周期 D1' });
  if (!fTitle.value) fTitle.value = typeMeta(a.type).name;
  body.append(field('名称', fTitle));

  const fPlace = el('input', { type: 'text', value: a.place || '', placeholder: '例如：肿瘤内科门诊 3 楼' });
  body.append(field('地点', fPlace));

  const fNote = el('textarea', { placeholder: '要带的东西、空腹要求、找哪个医生…' });
  fNote.value = a.note || '';
  body.append(field('备注', fNote));

  const foot = [
    el('button', { class: 'btn', onclick: closeSheet }, '取消'),
    el('button', {
      class: 'btn primary',
      onclick: async () => {
        if (!fTitle.value.trim()) { toast('给这件事起个名字'); return; }
        const rec = existing ? { ...existing } : { id: db.uid() };
        Object.assign(rec, {
          date: fDate.value,
          time: fTime.value,
          type: a.type,
          title: fTitle.value.trim(),
          place: fPlace.value.trim(),
          note: fNote.value.trim(),
        });
        await db.put('appointments', rec);
        await reload();
        closeSheet();
        render();
        toast(existing ? '已保存' : '已添加');
      },
    }, '保存'),
  ];

  if (existing) {
    foot.unshift(el('button', {
      class: 'btn danger',
      onclick: async () => {
        if (await confirmAsk('删掉这条日程？')) {
          await db.del('appointments', existing.id);
          await reload(); render(); toast('已删除');
        }
      },
    }, '删除'));
  }

  openSheet({ title: existing ? '修改日程' : '新增日程', body, footer: foot });
}

function field(labelText, input, help) {
  const f = el('div', { class: 'field' });
  f.append(el('label', { text: labelText }));
  f.append(input);
  if (help) f.append(el('div', { class: 'help', text: help }));
  return f;
}

/* ---------- 自动排期 ---------- */

function openCycleSheet() {
  const p = S.profile;
  const body = el('div', {});
  body.append(el('p', { class: 'muted' },
    '填一次，我把往后几个周期的给药、查血、疗效评估都排出来。生成后可以逐条改。'));

  const fAnchor = el('input', { type: 'date', value: p.startedAt || today() });
  body.append(field('本轮化疗第 1 天', fAnchor, '通常是打化疗药那天'));

  const fCycle = el('input', { type: 'number', value: p.chemoCycleDays || 21, min: '7', max: '42' });
  body.append(field('化疗周期天数', fCycle, '常见 21 天或 14 天，按医生方案'));

  const fImm = el('input', { type: 'number', value: p.immunoCycleDays || 21, min: '0', max: '42' });
  body.append(field('免疫治疗间隔天数', fImm, '填 0 表示这次不排免疫治疗'));

  const fN = el('input', { type: 'number', value: 4, min: '1', max: '12' });
  body.append(field('往后排几个周期', fN));

  openSheet({
    title: '按方案自动排期',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '取消'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          const conf = { ...p, chemoCycleDays: Number(fCycle.value), immunoCycleDays: Number(fImm.value), startedAt: fAnchor.value };
          const drafts = buildCyclePlan(conf, fAnchor.value, Number(fN.value) || 4);
          const add = mergePlan(S.appts, drafts);
          if (!add.length) { toast('这些日程已经都有了'); return; }
          for (const d of add) await db.put('appointments', { ...d, id: db.uid() });
          await db.saveProfile({ chemoCycleDays: conf.chemoCycleDays, immunoCycleDays: conf.immunoCycleDays, startedAt: fAnchor.value });
          await reload();
          closeSheet();
          render();
          toast(`排好了 ${add.length} 条，可以逐条调整`);
        },
      }, '生成'),
    ],
  });
}

function openRadioSheet() {
  const p = S.profile;
  const body = el('div', {});
  body.append(el('p', { class: 'muted' }, '按每周一到五排，跳过周末。法定节假日需要你手动挪。'));

  const fStart = el('input', { type: 'date', value: p.startedAt || today() });
  body.append(field('放疗开始日', fStart));
  const fTotal = el('input', { type: 'number', value: p.radioTotal || 30, min: '1', max: '60' });
  body.append(field('总次数', fTotal, '常见 25-33 次，问放疗科医生'));
  const fPlace = el('input', { type: 'text', value: p.hospital || '', placeholder: '放疗中心' });
  body.append(field('地点', fPlace));

  openSheet({
    title: '排放疗日程',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '取消'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          const drafts = buildRadioPlan(fStart.value, Number(fTotal.value), fPlace.value);
          const add = mergePlan(S.appts, drafts);
          if (!add.length) { toast('这些日程已经都有了'); return; }
          for (const d of add) await db.put('appointments', { ...d, id: db.uid() });
          await db.saveProfile({ radioTotal: Number(fTotal.value) });
          await reload(); closeSheet(); render();
          toast(`排好了 ${add.length} 次放疗`);
        },
      }, '生成'),
    ],
  });
}

function openICS() {
  const upcoming = S.appts.filter((a) => a.date >= addDays(today(), -1) && !a.done);
  if (!upcoming.length) { toast('还没有未完成的日程'); return; }
  const ics = toICS(upcoming, `${S.profile.name || '治疗'}日程`);
  download(`治疗日程-${today()}.ics`, ics, 'text/calendar;charset=utf-8');
  toast('已下载，用手机打开这个文件即可导入日历');
}

/* ==========================================================
   页面三：指标
   ========================================================== */

function pageLabs() {
  const v = view();

  v.append(pageActions([
    { label: '录入化验单', fn: () => openLabSheet(), primary: true },
    { label: '批量粘贴', fn: openLabPaste },
  ]));

  if (!S.labs.length) {
    v.append(el('div', { class: 'card' }, [
      el('div', { class: 'empty' }, [
        el('div', { class: 'big' }, '◔'),
        el('div', {}, '还没有化验记录'),
        el('div', { class: 'tiny', style: 'margin-top:8px' },
          '录入一次之后，这里会按指标画出趋势线，一眼看出这次比上次好还是差。'),
      ]),
    ]));
    return;
  }

  // 重点指标（star）趋势
  const starItems = [];
  for (const p of LAB_PANELS) for (const it of p.items) if (it.star && !p.textOnly) starItems.push({ ...it, panelId: p.id, panelName: p.name });

  for (const it of starItems) {
    const series = labSeries(it.code);
    if (!series.length) continue;
    v.append(labCard(it, series));
  }

  // 其他面板折叠展示
  const others = LAB_PANELS.filter((p) => !p.textOnly && !p.items.some((i) => i.star && labSeries(i.code).length));
  for (const p of others) {
    const rows = p.items.map((i) => ({ it: i, series: labSeries(i.code) })).filter((x) => x.series.length);
    if (!rows.length) continue;
    const c = el('div', { class: 'card' });
    c.append(el('div', { class: 'card-head' }, [el('h2', {}, p.name)]));
    for (const { it, series } of rows) {
      const last = series[series.length - 1];
      const flag = judge(it.code, last.y);
      const dv = displayValue(it.code, last.y);
      const row = el('div', { class: 'labrow', style: 'cursor:pointer', onclick: () => openLabDetail(it.code) });
      row.append(el('div', {}, [
        el('div', { class: 'nm' }, it.name),
        el('div', { class: 'rf' }, `参考 ${fmtNum(dv.lo)}–${fmtNum(dv.hi)} ${dv.unit}`),
      ]));
      row.append(el('div', { class: 'val ' + (flag || '') }, [
        document.createTextNode(fmtNum(dv.value)),
        el('span', { class: 'u' }, dv.unit),
      ]));
      row.append(el('div', { class: 'arrow' }, trendArrow(series)));
      c.append(row);
    }
    v.append(c);
  }
}

function labSeries(code) {
  const out = [];
  for (const row of S.labs) {
    const val = row.values?.[code];
    if (val === '' || val == null || Number.isNaN(Number(val))) continue;
    out.push({ x: row.date, y: Number(val) });
  }
  return out.sort((a, b) => a.x.localeCompare(b.x));
}

function trendArrow(series) {
  if (series.length < 2) return '';
  const a = series[series.length - 2].y, b = series[series.length - 1].y;
  if (a === 0) return '';
  const pct = ((b - a) / Math.abs(a)) * 100;
  if (Math.abs(pct) < 5) return '持平';
  return (pct > 0 ? '↑' : '↓') + Math.abs(pct).toFixed(0) + '%';
}

function labCard(it, series) {
  const last = series[series.length - 1];
  const flag = judge(it.code, last.y);
  const c = el('div', { class: 'card' });
  const head = el('div', { class: 'card-head' });
  head.append(el('h2', {}, it.name));
  const badge = el('span', {
    class: 'tag ' + (flag === 'ok' ? 'ok' : flag ? 'bad' : 'grey'),
  }, flag === 'high' ? '偏高' : flag === 'low' ? '偏低' : '正常');
  head.append(badge);
  c.append(head);

  const cur = el('div', { style: 'display:flex;align-items:baseline;gap:8px;margin-bottom:2px' });
  cur.append(el('span', { style: 'font-size:1.6rem;font-weight:800;font-variant-numeric:tabular-nums' }, fmtNum(last.y)));
  cur.append(el('span', { class: 'muted tiny' }, it.unit));
  cur.append(el('span', { class: 'muted tiny', style: 'margin-left:auto' }, `${fmtMD(last.x)} · ${trendArrow(series)}`));
  c.append(cur);

  const chart = el('div', { class: 'chart-wrap', html: sparkline(series, { lo: it.lo, hi: it.hi, unit: it.unit }) });
  c.append(chart);

  const legend = el('div', { class: 'legend' });
  legend.append(el('span', {}, [el('i', { style: 'background:#12a150;opacity:.3' }), `正常范围 ${fmtNum(it.lo)}–${fmtNum(it.hi)}`]));
  if (it.note) legend.append(el('span', {}, it.note));
  c.append(legend);

  c.addEventListener('click', () => openLabDetail(it.code));
  c.style.cursor = 'pointer';
  return c;
}

function openLabDetail(code) {
  const it = LAB_INDEX.get(code);
  const series = labSeries(code);
  if (!it) return;
  const body = el('div', {});
  body.append(el('div', { class: 'chart-wrap', html: sparkline(series, { lo: it.lo, hi: it.hi, w: 360, h: 150 }) }));
  if (it.note) body.append(el('div', { class: 'alert info', style: 'margin-top:10px' }, it.note));

  body.append(el('div', { class: 'section-title' }, '所有记录'));
  for (const p of [...series].reverse()) {
    const flag = judge(code, p.y);
    const row = el('div', { class: 'kv' });
    row.append(el('span', { class: 'k' }, fmtYMD(p.x)));
    row.append(el('span', { class: 'v', style: flag !== 'ok' ? 'color:#e0534a' : '' }, `${fmtNum(p.y)} ${it.unit}`));
    body.append(row);
  }
  openSheet({ title: it.name, body, footer: [el('button', { class: 'btn', onclick: closeSheet }, '关闭')] });
}

/* ---------- 化验录入 ---------- */

function openLabSheet() {
  const body = el('div', {});
  const fDate = el('input', { type: 'date', value: today() });
  body.append(field('化验日期', fDate));

  const panelSel = el('select', {});
  panelSel.append(el('option', { value: 'all' }, '常用项目（推荐）'));
  for (const p of LAB_PANELS) panelSel.append(el('option', { value: p.id }, p.name));
  body.append(field('显示哪些项目', panelSel));

  const inputs = new Map();
  const listWrap = el('div', {});

  function buildList() {
    listWrap.replaceChildren();
    const panels = panelSel.value === 'all'
      ? LAB_PANELS.filter((p) => ['cbc', 'liver', 'renal'].includes(p.id))
      : LAB_PANELS.filter((p) => p.id === panelSel.value);

    for (const p of panels) {
      listWrap.append(el('div', { class: 'section-title' }, p.name));
      for (const it of p.items) {
        const f = el('div', { class: 'field' });
        const lab = el('label', {}, [
          el('span', { text: it.name + ' ' }),
          el('span', { class: 'tiny muted', text: `${it.unit}（${fmtNum(it.lo)}–${fmtNum(it.hi)}）` }),
        ]);
        f.append(lab);
        const inp = el('input', {
          type: 'number', inputmode: 'decimal', step: 'any',
          placeholder: '正常就不填',
          value: '',
        });
        inputs.set(it.code, inp);
        f.append(inp);
        listWrap.append(f);
      }
    }
  }

  panelSel.addEventListener('change', buildList);
  buildList();
  body.append(listWrap);

  const fNote = el('textarea', { placeholder: '比如：第 3 周期后、医生说要减量' });
  body.append(field('备注（可写化疗到第几次）', fNote));

  openSheet({
    title: '录入化验单',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '取消'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          const values = {};
          let n = 0;
          for (const [code, inp] of inputs) {
            if (inp.value !== '') { values[code] = Number(inp.value); n++; }
          }
          if (!n) { toast('至少填一项'); return; }
          await db.put('labs', {
            id: db.uid(),
            date: fDate.value,
            values,
            note: fNote.value.trim(),
          });
          await reload(); closeSheet(); render();
          toast(`已保存 ${n} 项`);
        },
      }, '保存'),
    ],
  });
}

/** 批量粘贴：从医院 App 复制的文本里抽取指标 */
function openLabPaste() {
  const body = el('div', {});
  body.append(el('p', { class: 'muted' },
    '把医院 App / 公众号里的化验结果整段复制过来，我按项目名自动认。认不出的会列出来让你手动补。'));

  const fDate = el('input', { type: 'date', value: today() });
  body.append(field('化验日期', fDate));

  const ta = el('textarea', {
    placeholder: '白细胞 3.2 ×10⁹/L\n中性粒细胞 1.4\n血红蛋白 108 g/L\nALT 45 U/L',
    style: 'min-height:180px;font-family:ui-monospace,monospace;font-size:.86rem',
  });
  body.append(field('粘贴化验结果', ta));

  const preview = el('div', {});
  body.append(preview);

  const parseBtn = el('button', { class: 'btn block sm', type: 'button' }, '识别一下');
  parseBtn.addEventListener('click', () => {
    const found = parseLabText(ta.value);
    preview.replaceChildren();
    if (!found.length) {
      preview.append(el('div', { class: 'alert warn' }, '没认出任何已知指标，检查一下文字里是否有项目名'));
      return;
    }
    preview.append(el('div', { class: 'alert info' }, `认出 ${found.length} 项，确认后保存`));
    for (const f of found) {
      const it = LAB_INDEX.get(f.code);
      const row = el('div', { class: 'kv' });
      row.append(el('span', { class: 'k' }, it.name));
      row.append(el('span', { class: 'v' }, `${fmtNum(f.value)} ${it.unit}`));
      preview.append(row);
    }
    preview.dataset.json = JSON.stringify(found);
  });
  body.append(parseBtn);

  openSheet({
    title: '批量粘贴化验结果',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '取消'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          const raw = preview.dataset.json;
          if (!raw) { toast('先点「识别一下」'); return; }
          const found = JSON.parse(raw);
          const values = {};
          for (const f of found) values[f.code] = f.value;
          await db.put('labs', {
            id: db.uid(), date: fDate.value, values, note: '粘贴导入',
          });
          await reload(); closeSheet(); render();
          toast(`已保存 ${found.length} 项`);
        },
      }, '保存'),
    ],
  });
}

/** 从自由文本里抽指标：支持「白细胞 3.2」「WBC:3.2」「白细胞计数3.2×10^9」 */
function parseLabText(text) {
  const out = [];
  const seen = new Set();
  const flat = [];
  for (const p of LAB_PANELS) for (const it of p.items) flat.push(it);

  for (const it of flat) {
    if (seen.has(it.code)) continue;
    // 用名称或英文缩写匹配，后面跟可选单位，再跟数字
    const names = [it.name, it.code];
    for (const nm of names) {
      const esc$ = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(esc$ + '[^0-9\\-\\n]{0,18}?(-?\\d+(?:\\.\\d+)?)', 'i');
      const m = text.match(re);
      if (m) {
        const v = Number(m[1]);
        if (Number.isFinite(v)) {
          out.push({ code: it.code, value: v });
          seen.add(it.code);
          break;
        }
      }
    }
  }
  return out;
}

/* ==========================================================
   页面四：每日记录
   ========================================================== */

function pageSyms() {
  const v = view();
  const t = today();

  v.append(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('h2', {}, '记录今天的感觉')]),
    el('div', { class: 'muted', style: 'margin-bottom:10px' },
      '点格子选程度。0 无、1 轻、2 中、3 重。复诊时医生问「这周怎么样」，翻这个就行。'),
    el('button', { class: 'btn primary block', onclick: () => openSymSheet() }, '开始今天的记录'),
  ]));

  // 最近 14 天症状热力条
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(t, -i));
  const heat = el('div', { class: 'card' });
  heat.append(el('div', { class: 'card-head' }, [el('h2', {}, '近 14 天负担')]));
  const bars = el('div', { style: 'display:flex;gap:4px;align-items:flex-end;height:70px' });
  for (const d of days) {
    const rec = S.syms.filter((r) => r.date === d).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    let score = 0;
    if (rec) {
      for (const val of Object.values(rec.scores || {})) score += val;
      if (rec.temp >= 38.3) score += 5;
      else if (rec.temp >= 37.5) score += 2;
    }
    const h = Math.min(64, 6 + score * 4);
    const col = score === 0 ? '#dbe8ee' : score < 4 ? '#7fd4b5' : score < 9 ? '#f0b429' : '#ef7a56';
    const bar = el('div', {
      style: `flex:1;height:${h}px;background:${col};border-radius:4px 4px 2px 2px`,
      title: `${fmtMD(d)} 负担 ${score}`,
    });
    bars.append(bar);
  }
  heat.append(bars);
  heat.append(el('div', { class: 'tiny muted', style: 'margin-top:6px' }, '柱子越高表示那天不舒服的项目越多越重'));
  v.append(heat);

  // 历史记录列表
  if (S.syms.length) {
    v.append(el('div', { class: 'section-title' }, '历史记录'));
    const c = el('div', { class: 'card' });
    for (const r of [...S.syms].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40)) {
      const item = el('div', { class: 'item', style: 'cursor:pointer', onclick: () => openSymSheet(r) });
      const body = el('div', { class: 'body' });
      body.append(el('div', { class: 'title' }, `${fmtMD(r.date)} 周${weekday(r.date)}`));
      const bits = [];
      if (r.temp) bits.push(`体温 ${r.temp}℃`);
      const bad = Object.entries(r.scores || {}).filter(([, x]) => x > 0)
        .map(([k, x]) => `${SYMPTOM_INDEX.get(k)?.name || k}${x >= 2 ? '(' + LEVELS[x] + ')' : ''}`).slice(0, 4);
      if (bad.length) bits.push(bad.join('、'));
      if (r.weight) bits.push(`体重 ${r.weight}kg`);
      body.append(el('div', { class: 'meta' }, bits.join(' · ') || '无明显不适'));
      item.append(body);
      c.append(item);
    }
    v.append(c);
  }
}

function openSymSheet(existing) {
  const rec = existing ? { ...existing } : { date: today(), scores: {}, temp: '', weight: '', note: '' };
  const body = el('div', {});

  const fDate = el('input', { type: 'date', value: rec.date, disabled: !!existing });
  body.append(field('日期', fDate));

  // 体温体重
  const g = el('div', { class: 'grid2' });
  const fTemp = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', value: rec.temp || '', placeholder: '36.8' });
  const fWeight = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', value: rec.weight || '', placeholder: '可不填' });
  g.append(field('体温 ℃', fTemp));
  g.append(field('体重 kg', fWeight));
  body.append(g);

  // 症状分组
  const scores = { ...(rec.scores || {}) };
  for (const grp of SYMPTOM_GROUPS) {
    const items = SYMPTOMS.filter((s) => s.group === grp);
    if (!items.length) continue;
    body.append(el('div', { class: 'section-title' }, grp));
    for (const s of items) {
      const wrap = el('div', { style: 'margin-bottom:14px' });
      const label = el('div', {
        style: 'font-size:var(--fs-sm);font-weight:600;margin-bottom:7px;line-height:1.35;display:flex;align-items:center;gap:6px;flex-wrap:wrap',
      }, s.name);
      if (s.ireae) label.append(el('span', { class: 'tag warn', style: 'font-size:var(--fs-2xs)' }, '免疫相关'));
      wrap.append(label);

      const seg = el('div', { class: 'seg lvl' });
      for (let v = 0; v <= 3; v++) {
        const cur = scores[s.id] ?? 0;
        const b = el('button', {
          type: 'button', 'data-v': v,
          'aria-pressed': cur === v ? 'true' : 'false',
        }, v === 0 ? '无' : LEVELS[v]);
        b.addEventListener('click', () => {
          scores[s.id] = v;
          seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          if (v >= 2 && s.severe) {
            toast(`注意：${s.severe}`, 3500);
          }
          updateFlagPreview();
        });
        seg.append(b);
      }
      wrap.append(seg);
      body.append(wrap);
    }
  }

  // 备注
  const fNote = el('textarea', { placeholder: '今天有什么特别的事：吃了什么药、哪里疼、睡得怎么样…' });
  fNote.value = rec.note || '';
  body.append(field('备注', fNote));

  // 预警预览
  const flagBox = el('div', {});
  body.append(flagBox);
  function updateFlagPreview() {
    const draft = {
      scores,
      temp: Number(fTemp.value) || null,
    };
    const flags = checkRedFlags(draft);
    flagBox.replaceChildren();
    if (flags.length) {
      const box = el('div', { class: 'alert bad' }, [el('div', { class: 't' }, '需要联系医生的情况')]);
      for (const m of flags) box.append(el('div', { text: '· ' + m }));
      flagBox.append(box);
    }
  }
  fTemp.addEventListener('input', updateFlagPreview);
  updateFlagPreview();

  openSheet({
    title: existing ? '修改记录' : '今天的记录',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '取消'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          const out = {
            id: rec.id || db.uid(),
            date: fDate.value,
            scores,
            temp: fTemp.value ? Number(fTemp.value) : null,
            weight: fWeight.value ? Number(fWeight.value) : null,
            note: fNote.value.trim(),
          };
          await db.put('symptoms', out);
          await reload(); closeSheet(); render();
          toast('已保存');
        },
      }, '保存'),
    ],
  });
}

/* ==========================================================
   页面五：更多
   ========================================================== */

function pageMore() {
  const v = view();

  const groups = [
    {
      title: '资料与导入',
      items: [
        { icon: '📥', name: '批量导入资料', desc: '把病历、化验单照片交给 AI 整理成数据', fn: openImportSheet, tone: 'blue' },
        { icon: '📁', name: '就诊资料库', desc: `${S.docs.length} 份 · 报告单、出院小结、发票`, fn: openDocsPage },
        { icon: '📝', name: '就诊备忘', desc: '下次要问医生的问题、他说的要点', fn: openNotesPage },
      ],
    },
    {
      title: '设置',
      items: [
        {
          icon: '👤', name: '患者信息与方案',
          desc: S.profile.name ? `${S.profile.name}${S.profile.diagnosis ? ' · ' + S.profile.diagnosis : ''}` : '还没填，先填这个',
          fn: openProfileSheet,
        },
        { icon: '🔔', name: '微信提醒推送', desc: S.profile.serverchanKey ? '已配置' : '未配置', fn: openPushSheet, tone: 'warn' },
        { icon: '📅', name: '导出到手机日历', desc: '生成 ics 文件导入系统日历', fn: openICS },
      ],
    },
    {
      title: '数据安全',
      items: [
        { icon: '💾', name: '备份全部数据', desc: '导出一个文件，存到网盘或发给自己', fn: doBackup },
        { icon: '🔃', name: '从备份恢复', desc: '换手机时用', fn: doRestore },
        { icon: '🖨', name: '生成就诊一页纸', desc: '复诊时给医生看的汇总', fn: openPrintSheet },
      ],
    },
    {
      title: '页面与更新',
      items: [
        { icon: '↻', name: '刷新数据', desc: '重新读取本地数据并重画界面', fn: () => refreshData() },
        { icon: '⬇', name: '检查更新', desc: '拉取最新版本（改了代码后用）', fn: showUpdateSheet },
      ],
    },
  ];

  for (const g of groups) {
    v.append(el('div', { class: 'section-title' }, g.title));
    const c = el('div', { class: 'card list' });
    for (const it of g.items) {
      const row = el('div', { class: 'nav-item', onclick: it.fn });
      const box = el('div', { class: 'ico-box' + (it.tone ? ' ' + it.tone : '') }, it.icon);
      row.append(box);
      const txt = el('div', { class: 'txt' });
      txt.append(el('div', { class: 'nm' }, it.name));
      txt.append(el('div', { class: 'ds' }, it.desc));
      row.append(txt);
      row.append(el('div', { class: 'chev' }, '›'));
      c.append(row);
    }
    v.append(c);
  }

  v.append(el('div', {
    class: 'tiny muted',
    style: 'text-align:center;padding:18px 16px 4px;line-height:1.6',
  }, '数据只存在这台手机的浏览器里。换手机、清缓存前记得先备份。'));
  v.append(el('div', {
    class: 'tiny',
    style: 'text-align:center;padding:0 16px 14px;line-height:1.6;color:var(--ink-4)',
  }, '这个工具帮记录和提醒，不替代医生判断。'));
}

/* ---------- 批量导入 ---------- */

function openImportSheet() {
  const body = el('div', {});

  // 说明
  body.append(el('div', { class: 'alert info' }, [
    el('div', { class: 't' }, '怎么用'),
    el('div', {}, '把病历、化验单、出院小结的照片交给 AI 识别，它会整理成结构化数据，你确认后一键导入。'),
  ]));

  // 第一步：复制提示词
  body.append(el('div', { class: 'section-title' }, '第 1 步 · 复制这段指令'));
  body.append(el('p', { class: 'muted tiny', style: 'margin-bottom:8px' },
    '连同照片一起发给 AI（DeepSeek / Claude / 豆包都行），它就会按格式输出数据。'));

  const prompt = buildExtractPrompt();
  const copyBtn = el('button', { class: 'btn block primary', type: 'button' }, '复制提取指令');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast('已复制，去发给 AI 吧');
      copyBtn.textContent = '已复制 ✓';
      setTimeout(() => { copyBtn.textContent = '复制提取指令'; }, 2500);
    } catch {
      // 剪贴板不可用时，退回到弹窗让人手动复制
      openSheet({
        title: '手动复制',
        body: el('textarea', { style: 'min-height:300px;font-size:12px', readonly: true }, prompt),
        footer: [el('button', { class: 'btn', onclick: openImportSheet }, '返回')],
      });
    }
  });
  body.append(copyBtn);

  // 第二步：粘贴结果
  body.append(el('div', { class: 'section-title' }, '第 2 步 · 把 AI 给出的结果粘回来'));

  body.append(el('div', { class: 'alert warn compact' }, [
    el('span', { class: 'ico' }, '✂'),
    el('span', { class: 'txt' }, '长内容在手机上可能复制不全。如果报错说不完整，先粘到备忘录里再复制过来会更稳。'),
  ]));

  let parsed = null;
  const ta = el('textarea', {
    placeholder: '把 AI 返回的内容整段粘贴到这里。带不带 ``` 包裹都行，前后有说明文字也能自动清理。',
    style: 'min-height:150px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px',
  });
  body.append(field('AI 返回的内容', ta));

  const preview = el('div', {});
  body.append(preview);

  const parseBtn = el('button', { class: 'btn block', type: 'button' }, '检查一下能导入什么');
  parseBtn.addEventListener('click', () => {
    preview.replaceChildren();
    const res = validateBundle(ta.value);
    parsed = res.ok ? res.data : null;

    // 修复过的，先醒目提示
    if (res.ok && res.warnings.some((w) => w.includes('已自动修复'))) {
      preview.append(el('div', { class: 'alert warn' }, [
        el('div', { class: 't' }, '内容不完整，已自动修复'),
        el('div', { class: 'tiny', style: 'margin-top:4px' },
          '识别到的部分已经抢救出来了，但可能漏了后半段。请对照原单核对下面的明细，确认无误再导入。'),
      ]));
    }

    if (res.errors.length) {
      const box = el('div', { class: 'alert bad' }, [el('div', { class: 't' }, '这段内容读不了')]);
      for (const e of res.errors) {
        box.append(el('div', { class: 'tiny', style: 'margin-top:4px;line-height:1.6', text: e }));
      }
      preview.append(box);

      // 给一个直接可用的补救入口
      const fix = el('div', { class: 'card plain', style: 'margin-top:10px' });
      fix.append(el('div', { class: 'tiny', style: 'font-weight:700;margin-bottom:6px' }, '还可以这样'));
      fix.append(el('button', {
        class: 'btn block sm', style: 'margin-bottom:8px',
        onclick: () => {
          const txt = ta.value;
          const cut = txt.slice(0, 300);
          // 帮用户把已有内容清空重来
          ta.value = '';
          toast('已清空，可以重新粘贴了');
          ta.focus();
        },
      }, '清空重新粘贴'));
      fix.append(el('div', { class: 'tiny muted' },
        '或者让 AI 少输出一点：跟它说「分两段发，先发基本情况和化验单」。'));
      preview.append(fix);
      return;
    }

    // 摘要
    const d = res.data;
    const rows = [];
    if (Object.keys(d.profile).length) {
      rows.push(['基本情况', Object.entries(d.profile)
        .map(([k, v]) => `${PROFILE_LABEL[k] || k}: ${v}`).join('，')]);
    }
    if (d.labs.length) rows.push(['化验单', `${d.labs.length} 张`]);
    if (d.appointments.length) rows.push(['日程', `${d.appointments.length} 条`]);
    if (d.docs.length) rows.push(['资料', `${d.docs.length} 份`]);
    if (d.symptoms.length) rows.push(['症状记录', `${d.symptoms.length} 天`]);

    const box = el('div', { class: 'alert info' }, [
      el('div', { class: 't' }, '识别到以下内容，确认没问题再导入'),
    ]);
    for (const [k, v] of rows) {
      const row = el('div', { style: 'display:flex;gap:8px;padding:3px 0;font-size:var(--fs-xs)' });
      row.append(el('span', { style: 'color:var(--ink-3);flex-shrink:0' }, k));
      row.append(el('span', { style: 'font-weight:600;overflow-wrap:break-word;min-width:0' }, String(v)));
      box.append(row);
    }
    preview.append(box);

    // 明细：化验项目逐条列出，方便核对关键数值
    if (d.labs.length) {
      const det = el('div', { class: 'card', style: 'padding:12px 14px' });
      det.append(el('div', { class: 'tiny', style: 'font-weight:700;color:var(--ink-2);margin-bottom:6px' }, '化验明细（重点核对）'));
      for (const lab of d.labs) {
        const head = el('div', { class: 'tiny', style: 'font-weight:700;margin:8px 0 3px;color:var(--ink-2)' },
          fmtYMD(lab.date) + (lab.note ? ' · ' + lab.note : ''));
        det.append(head);
        for (const [code, v] of Object.entries(lab.values)) {
          const it = LAB_INDEX.get(code);
          const flag = judge(code, v);
          const row = el('div', { style: 'display:flex;justify-content:space-between;gap:8px;padding:2px 0;font-size:var(--fs-xs)' });
          row.append(el('span', { style: 'color:var(--ink-2);min-width:0;overflow-wrap:break-word' }, it?.name || code));
          row.append(el('span', {
            style: `font-weight:600;font-variant-numeric:tabular-nums;flex-shrink:0;${flag !== 'ok' ? 'color:var(--bad)' : ''}`,
          }, `${fmtNum(v)} ${it?.unit || ''}`));
          det.append(row);
        }
      }
      preview.append(det);
    }

    // 警告
    if (res.warnings.length) {
      const w = el('div', { class: 'alert warn' }, [
        el('div', { class: 't' }, `${res.warnings.length} 项被跳过或修正`),
        ...res.warnings.slice(0, 8).map((x) => el('div', { class: 'tiny', text: '· ' + x })),
        ...(res.warnings.length > 8 ? [el('div', { class: 'tiny', text: `…还有 ${res.warnings.length - 8} 条` })] : []),
      ]);
      preview.append(w);
    }
  });
  body.append(parseBtn);

  openSheet({
    title: '批量导入资料',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '关闭'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          if (!parsed) { toast('先点「检查一下能导入什么」'); return; }
          const c = await applyBundle(parsed);
          await reload();
          closeSheet();
          S.page = 'today';
          location.hash = 'today';
          render();
          toast(`导入完成：${c.labs} 张化验、${c.appointments} 条日程、${c.docs} 份资料`, 3200);
        },
      }, '确认导入'),
    ],
  });
}

const PROFILE_LABEL = {
  name: '姓名', sex: '性别', birth: '出生', diagnosis: '诊断', stage: '分期',
  hospital: '医院', dept: '科室', doctor: '医生',
  chemoCycleDays: '化疗周期', immunoCycleDays: '免疫间隔', radioTotal: '放疗次数',
};

/* ---------- 更新与刷新 ---------- */

function showUpdateSheet() {
  const body = el('div', {});

  body.append(el('p', { class: 'muted' },
    '桌面书签打开时没有地址栏，所以刷新要靠这里的按钮。'));

  body.append(el('div', { class: 'card plain', style: 'margin-bottom:12px' }, [
    el('div', { class: 'tiny', style: 'font-weight:700;margin-bottom:6px' }, '平常这样刷新'),
    el('div', { class: 'tiny muted', style: 'line-height:1.7' },
      '在页面上往下拉一把（像刷朋友圈那样），页面到顶部后继续往下拉，看到圆形箭头松手就行。'),
  ]));

  const actions = el('div', {});
  actions.append(el('button', {
    class: 'btn block primary', style: 'margin-bottom:8px',
    onclick: async () => {
      closeSheet();
      await refreshData();
    },
  }, '刷新数据（快，不重载页面）'));

  actions.append(el('button', {
    class: 'btn block', style: 'margin-bottom:8px',
    onclick: async () => {
      closeSheet();
      await forceUpdate();
    },
  }, '强制更新到最新版本（清缓存并重载）'));

  body.append(actions);

  body.append(el('div', { class: 'alert warn', style: 'margin-top:10px' }, [
    el('div', { class: 't' }, '数据不会丢'),
    el('div', { class: 'tiny', style: 'margin-top:4px;line-height:1.6' },
      '上面两个按钮都不会删除你记录的数据。数据存在手机本地，强制更新只是重新下载程序文件。'),
  ]));

  openSheet({
    title: '刷新与更新',
    body,
    footer: [el('button', { class: 'btn', onclick: closeSheet }, '关闭')],
  });
}

/* ---------- 资料库 ---------- */

function openDocsPage() {
  const body = el('div', {});

  body.append(el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn sm primary', onclick: openDocSheet }, '添加资料'),
  ]));

  if (!S.docs.length) {
    body.append(el('div', { class: 'empty' }, [
      el('div', { class: 'big' }, '📁'),
      el('div', {}, '还没有资料'),
      el('div', { class: 'tiny', style: 'margin-top:8px' }, '拍张照或者填一下报告结论，以后不用翻箱倒柜'),
    ]));
  } else {
    const c = el('div', {});
    for (const d of [...S.docs].sort((a, b) => b.date.localeCompare(a.date))) {
      const item = el('div', { class: 'item', style: 'cursor:pointer', onclick: () => openDocDetail(d) });
      const b2 = el('div', { class: 'body' });
      b2.append(el('div', { class: 'title' }, `${d.kind ? '[' + d.kind + '] ' : ''}${d.title || '未命名'}`));
      const bits = [fmtYMD(d.date)];
      if (d.hospital) bits.push(d.hospital);
      if (d.summary) bits.push(d.summary);
      b2.append(el('div', { class: 'meta' }, bits.join(' · ')));
      item.append(b2);
      if (d.photo) item.append(el('div', { class: 'tail' }, el('img', {
        src: d.photo, style: 'width:42px;height:42px;object-fit:cover;border-radius:8px', alt: '',
      })));
      c.append(item);
    }
    body.append(c);
  }

  openSheet({ title: '就诊资料库', body, footer: [el('button', { class: 'btn', onclick: closeSheet }, '关闭')] });
}

function openDocSheet(existing) {
  const d = existing || { date: today(), kind: '化验单', title: '', hospital: S.profile.hospital || '', summary: '', photo: '' };
  let photoData = d.photo || '';

  const body = el('div', {});
  const fDate = el('input', { type: 'date', value: d.date });
  body.append(field('日期', fDate));

  const sel = el('select', {});
  for (const k of DOC_KINDS) sel.append(el('option', { value: k, selected: k === d.kind ? true : null }, k));
  body.append(field('类型', sel));

  const fTitle = el('input', { type: 'text', value: d.title || '', placeholder: '例如：第 3 周期后 胸腹部 CT' });
  body.append(field('名称', fTitle));

  const fHosp = el('input', { type: 'text', value: d.hospital || '' });
  body.append(field('医院/科室', fHosp));

  const fSum = el('textarea', { placeholder: '结论、关键数值、医生说了什么' });
  fSum.value = d.summary || '';
  body.append(field('结论摘要', fSum));

  // 拍照
  const preview = el('div', {});
  const renderPreview = () => {
    preview.replaceChildren();
    if (photoData) {
      preview.append(el('img', {
        src: photoData, style: 'width:100%;max-height:220px;object-fit:contain;border-radius:10px;border:1px solid #e2ecf0;margin-top:6px',
      }));
    }
  };
  renderPreview();

  const file = el('input', {
    type: 'file', accept: 'image/*', capture: 'environment',
    style: 'display:none',
  });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    photoData = await shrinkImage(f, 1000, 0.72);
    renderPreview();
    toast('照片已压缩，保存后生效');
  });

  const shootBtn = el('button', { class: 'btn block', type: 'button' }, '拍照或选照片');
  shootBtn.addEventListener('click', () => file.click());

  body.append(field('照片（可选，压缩后存本地）', el('div', {}, [shootBtn, file, preview])));

  openSheet({
    title: existing ? '修改资料' : '添加资料',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '取消'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          const out = {
            id: d.id || db.uid(),
            date: fDate.value, kind: sel.value,
            title: fTitle.value.trim() || sel.value,
            hospital: fHosp.value.trim(),
            summary: fSum.value.trim(),
            photo: photoData,
          };
          await db.put('docs', out);
          await reload(); closeSheet(); render();
          toast('已保存');
        },
      }, '保存'),
    ],
  });
}

function openDocDetail(d) {
  const body = el('div', {});
  body.append(el('div', { class: 'kv' }, [el('span', { class: 'k' }, '日期'), el('span', { class: 'v' }, fmtYMD(d.date))]));
  body.append(el('div', { class: 'kv' }, [el('span', { class: 'k' }, '类型'), el('span', { class: 'v' }, d.kind || '-')]));
  if (d.hospital) body.append(el('div', { class: 'kv' }, [el('span', { class: 'k' }, '医院'), el('span', { class: 'v' }, d.hospital)]));
  if (d.summary) {
    body.append(el('div', { class: 'section-title' }, '摘要'));
    body.append(el('div', { style: 'white-space:pre-wrap;font-size:.9rem' }, d.summary));
  }
  if (d.photo) {
    body.append(el('img', { src: d.photo, style: 'width:100%;border-radius:12px;margin-top:10px;border:1px solid #e2ecf0' }));
  }
  openSheet({
    title: d.title || '资料',
    body,
    footer: [
      el('button', { class: 'btn', onclick: () => openDocSheet(d) }, '修改'),
      el('button', {
        class: 'btn danger', onclick: async () => {
          if (await confirmAsk('删掉这条资料？')) { await db.del('docs', d.id); await reload(); render(); toast('已删除'); }
        },
      }, '删除'),
    ],
  });
}

/** 把图片压到指定最大边长，避免撑爆本地存储 */
function shrinkImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- 就诊备忘 ---------- */

function openNotesPage() {
  const body = el('div', {});
  body.append(el('button', { class: 'btn sm primary', style: 'margin-bottom:10px', onclick: openNoteSheet }, '写一条'));

  if (!S.notes.length) {
    body.append(el('div', { class: 'empty' }, [
      el('div', { class: 'big' }, '📝'),
      el('div', {}, '还没有备忘'),
      el('div', { class: 'tiny', style: 'margin-top:8px' },
        '下次复诊前把想问的问题写这儿。进了诊室容易忘，写下来就不会。'),
    ]));
  } else {
    for (const n of [...S.notes].sort((a, b) => b.date.localeCompare(a.date))) {
      const item = el('div', { class: 'item', style: 'cursor:pointer', onclick: () => openNoteSheet(n) });
      const b2 = el('div', { class: 'body' });
      b2.append(el('div', { class: 'title' }, n.title || '备忘'));
      b2.append(el('div', { class: 'meta' }, `${fmtYMD(n.date)}${n.body ? ' · ' + n.body.slice(0, 40) : ''}`));
      item.append(b2);
      body.append(item);
    }
  }

  openSheet({ title: '就诊备忘', body, footer: [el('button', { class: 'btn', onclick: closeSheet }, '关闭')] });
}

function openNoteSheet(existing) {
  const n = existing || { date: today(), title: '', body: '' };
  const body = el('div', {});
  const fDate = el('input', { type: 'date', value: n.date });
  body.append(field('日期', fDate));
  const fTitle = el('input', { type: 'text', value: n.title || '', placeholder: '例如：下次复诊要问的问题' });
  body.append(field('标题', fTitle));
  const fBody = el('textarea', { placeholder: '1. 白细胞偏低要不要打针？\n2. 这个恶心药能不能换？' });
  fBody.value = n.body || '';
  body.append(field('内容', fBody));

  const foot = [
    el('button', { class: 'btn', onclick: closeSheet }, '取消'),
    el('button', {
      class: 'btn primary',
      onclick: async () => {
        await db.put('notes', {
          id: n.id || db.uid(), date: fDate.value,
          title: fTitle.value.trim() || '备忘', body: fBody.value.trim(),
        });
        await reload(); closeSheet(); render(); toast('已保存');
      },
    }, '保存'),
  ];
  if (existing) {
    foot.unshift(el('button', {
      class: 'btn danger',
      onclick: async () => {
        if (await confirmAsk('删掉这条备忘？')) { await db.del('notes', n.id); await reload(); render(); toast('已删除'); }
      },
    }, '删除'));
  }

  openSheet({ title: existing ? '修改备忘' : '写备忘', body, footer: foot });
}

/* ---------- 患者信息 ---------- */

function openProfileSheet() {
  const p = S.profile;
  const body = el('div', {});

  const fName = el('input', { type: 'text', value: p.name || '', placeholder: '称呼即可' });
  body.append(field('患者称呼', fName));

  const g = el('div', { class: 'grid2' });
  const fSex = el('select', {});
  for (const s of ['', '男', '女']) fSex.append(el('option', { value: s, selected: p.sex === s ? true : null }, s || '不填'));
  g.append(field('性别', fSex));
  const fBirth = el('input', { type: 'date', value: p.birth || '' });
  g.append(field('出生日期', fBirth));
  body.append(g);

  const fDiag = el('input', { type: 'text', value: p.diagnosis || '', placeholder: '例如：肺腺癌' });
  body.append(field('诊断', fDiag));

  const fStage = el('input', { type: 'text', value: p.stage || '', placeholder: '例如：IIIB / IV 期' });
  body.append(field('分期', fStage));

  const fHosp = el('input', { type: 'text', value: p.hospital || '', placeholder: '主要就诊医院' });
  body.append(field('医院', fHosp));

  const fDept = el('input', { type: 'text', value: p.dept || '', placeholder: '肿瘤内科' });
  body.append(field('科室', fDept));

  const fDoc = el('input', { type: 'text', value: p.doctor || '', placeholder: '主治医生' });
  body.append(field('主治医生', fDoc));

  const g2 = el('div', { class: 'grid2' });
  const fPhone = el('input', { type: 'tel', value: p.doctorPhone || '', placeholder: '医生/科室电话' });
  g2.append(field('医生电话', fPhone));
  const fNurse = el('input', { type: 'tel', value: p.nursePhone || '', placeholder: '护士站电话' });
  g2.append(field('护士站', fNurse));
  body.append(g2);

  body.append(el('div', { class: 'section-title' }, '治疗方案参数'));
  const g3 = el('div', { class: 'grid3' });
  const fCycle = el('input', { type: 'number', value: p.chemoCycleDays || 21 });
  g3.append(field('化疗周期', fCycle));
  const fImm = el('input', { type: 'number', value: p.immunoCycleDays || 21 });
  g3.append(field('免疫间隔', fImm));
  const fRadio = el('input', { type: 'number', value: p.radioTotal || 0 });
  g3.append(field('放疗总次数', fRadio));
  body.append(g3);
  body.append(el('div', { class: 'tiny muted' }, '这些数字只影响自动排期，随时可以改。'));

  openSheet({
    title: '患者信息',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '取消'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          await db.saveProfile({
            name: fName.value.trim(), sex: fSex.value, birth: fBirth.value,
            diagnosis: fDiag.value.trim(), stage: fStage.value.trim(),
            hospital: fHosp.value.trim(), dept: fDept.value.trim(),
            doctor: fDoc.value.trim(), doctorPhone: fPhone.value.trim(),
            nursePhone: fNurse.value.trim(),
            chemoCycleDays: Number(fCycle.value) || 21,
            immunoCycleDays: Number(fImm.value) || 0,
            radioTotal: Number(fRadio.value) || 0,
          });
          await reload(); closeSheet(); render();
          toast('已保存');
        },
      }, '保存'),
    ],
  });
}

/* ---------- 推送配置 ---------- */

function openPushSheet() {
  const p = S.profile;
  const body = el('div', {});

  body.append(el('div', { class: 'alert info' }, [
    el('div', { class: 't' }, '为什么要两步'),
    el('div', {}, '网页关掉后没法主动弹消息，所以提醒靠云端定时任务发。你只要填好下面两项，点「同步日程」，之后每天中午会自动检查并推送。'),
  ]));

  body.append(el('div', { class: 'section-title' }, '第一步：Server酱 的 SendKey'));
  const fKey = el('input', { type: 'password', value: p.serverchanKey || '', placeholder: 'SCT...' });
  body.append(field('SendKey', fKey, '去 sct.ftqq.com 用微信扫码登录，复制 SendKey；顺手关注它的公众号才能收到消息'));
  body.append(el('div', { class: 'tiny muted', style: 'margin:-6px 0 10px' },
    '同时要把它填到 GitHub 仓库的 Secret 里（名字 SERVERCHAN_KEY），云端定时任务用它发消息。'));

  body.append(el('div', { class: 'section-title' }, '第二步：GitHub 仓库'));
  const fToken = el('input', { type: 'password', value: p.ghToken || '', placeholder: 'ghp_... 或 github_pat_...' });
  body.append(field('GitHub Token', fToken, '去 GitHub → Settings → Developer settings → Personal access tokens 建一个，勾 repo 权限'));
  const fRepo = el('input', { type: 'text', value: p.ghRepo || '', placeholder: '你的用户名/treatment-tracker' });
  body.append(field('仓库', fRepo));

  body.append(el('button', {
    class: 'btn block sm', style: 'margin-bottom:10px',
    onclick: async () => {
      await db.saveProfile({ serverchanKey: fKey.value.trim(), ghToken: fToken.value.trim(), ghRepo: fRepo.value.trim() });
      S.profile = await db.getProfile();
      toast('已保存配置');
    },
  }, '保存配置'));

  body.append(el('div', { class: 'section-title' }, '第三步：同步日程到云端'));
  body.append(el('p', { class: 'muted tiny' },
    '把未来 14 天的日程推到仓库里的 data/upcoming.json，云端每天读这个文件决定发不发提醒。改了日程就再点一次。'));
  body.append(el('button', {
    class: 'btn primary block',
    onclick: async () => {
      const payload = buildReminderPayload(S.appts, S.profile, 14);
      try {
        await pushToGitHub(payload);
        toast('已同步到云端');
      } catch (e) {
        toast('同步失败：' + e.message, 4000);
      }
    },
  }, '同步日程到云端'));

  openSheet({ title: '微信提醒', body, footer: [el('button', { class: 'btn', onclick: closeSheet }, '关闭')] });
}

async function pushToGitHub(payload) {
  const p = S.profile;
  if (!p.ghToken || !p.ghRepo) throw new Error('先填 Token 和仓库');
  const path = 'data/upcoming.json';
  const api = `https://api.github.com/repos/${p.ghRepo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${p.ghToken}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // 取现有 sha（有则更新，无则新建）
  let sha = null;
  const r = await fetch(api, { headers });
  if (r.ok) { const j = await r.json(); sha = j.sha; }

  // base64 编码 UTF-8
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
  const body = { message: `更新日程 ${new Date().toISOString()}`, content };
  if (sha) body.sha = sha;

  const w = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!w.ok) {
    const t = await w.text();
    throw new Error(`${w.status} ${t.slice(0, 120)}`);
  }
  await db.saveProfile({ lastSync: new Date().toISOString() });
  return true;
}

/* ---------- 备份 / 恢复 / 打印 ---------- */

async function doBackup() {
  const data = await db.exportAll();
  const name = `治疗跟进备份-${today()}.json`;
  download(name, JSON.stringify(data, null, 2), 'application/json');
  toast('已导出，建议存到网盘或发给家人');
}

function doRestore() {
  const body = el('div', {});
  body.append(el('div', { class: 'alert warn' }, '恢复会合并数据。同名 id 的记录会被备份文件覆盖。'));

  let parsed = null;
  const file = el('input', { type: 'file', accept: '.json,application/json' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      parsed = JSON.parse(await f.text());
      const counts = Object.entries(parsed.data || {}).map(([k, v]) => `${k}: ${v.length}`).join('，');
      body.append(el('div', { class: 'alert info' }, `读到数据 → ${counts}`));
    } catch (e) {
      parsed = null;
      body.append(el('div', { class: 'alert bad' }, '文件读不出来，可能不是这个工具导出的备份'));
    }
  });
  body.append(field('选择备份文件', file));

  openSheet({
    title: '从备份恢复',
    body,
    footer: [
      el('button', { class: 'btn', onclick: closeSheet }, '取消'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          if (!parsed) { toast('先选一个备份文件'); return; }
          await db.importAll(parsed, { merge: true });
          await reload(); closeSheet(); render();
          toast('恢复完成');
        },
      }, '恢复'),
    ],
  });
}

function openPrintSheet() {
  const p = S.profile;
  const body = el('div', { class: 'print-area' });

  const h = el('div', {});
  h.append(el('h2', { style: 'margin-bottom:8px' }, `${p.name || '患者'} · 治疗情况汇总`));
  const info = [
    ['诊断', [p.diagnosis, p.stage].filter(Boolean).join(' ')],
    ['医院科室', [p.hospital, p.dept].filter(Boolean).join(' ')],
    ['主治医生', p.doctor],
    ['生成日期', fmtYMD(today())],
  ];
  for (const [k, val] of info) {
    if (!val) continue;
    const row = el('div', { class: 'kv' });
    row.append(el('span', { class: 'k' }, k));
    row.append(el('span', { class: 'v' }, val));
    h.append(row);
  }
  body.append(h);

  // 最近化验异常
  const ab = latestAbnormal();
  if (ab.length) {
    body.append(el('div', { class: 'section-title' }, '最近化验异常项'));
    for (const a of ab.slice(0, 12)) {
      const row = el('div', { class: 'kv' });
      row.append(el('span', { class: 'k' }, `${a.name}（${fmtMD(a.date)}）`));
      row.append(el('span', { class: 'v', style: 'color:#e0534a' }, `${fmtNum(a.value)} ${a.unit} ${a.flag === 'high' ? '↑' : '↓'}`));
      body.append(row);
    }
  }

  // 近 14 天症状
  const recent = S.syms.filter((r) => daysBetween(r.date, today()) <= 14).sort((a, b) => a.date.localeCompare(b.date));
  if (recent.length) {
    body.append(el('div', { class: 'section-title' }, '近 14 天不适情况'));
    for (const r of recent) {
      const bad = Object.entries(r.scores || {}).filter(([, v]) => v > 0)
        .map(([k, v]) => `${SYMPTOM_INDEX.get(k)?.name || k}${LEVELS[v]}`).join('、');
      body.append(el('div', { style: 'font-size:.84rem;padding:4px 0;border-bottom:1px solid #eee' },
        `${fmtMD(r.date)}${r.temp ? ` 体温${r.temp}℃` : ''} ${bad || '无不适'}`));
    }
  }

  // 治疗进度
  const done = S.appts.filter((a) => a.done).length;
  body.append(el('div', { class: 'section-title' }, '治疗进度'));
  body.append(el('div', { class: 'kv' }, [el('span', { class: 'k' }, '已完成日程'), el('span', { class: 'v' }, `${done} 项`)]));
  const nx = nextAppointment(S.appts);
  if (nx) body.append(el('div', { class: 'kv' }, [el('span', { class: 'k' }, '下次安排'), el('span', { class: 'v' }, `${fmtYMD(nx.date)} ${nx.title}`)]));

  openSheet({
    title: '就诊一页纸',
    body,
    footer: [
      el('button', { class: 'btn', onclick: () => window.print() }, '打印/存 PDF'),
      el('button', { class: 'btn', onclick: closeSheet }, '关闭'),
    ],
  });
}

/* ==========================================================
   启动
   ========================================================== */

boot().catch((e) => {
  console.error(e);
  view().innerHTML = `<div class="card"><h2>启动失败</h2><p class="muted">${esc(e.message)}</p>
    <p class="tiny muted">如果用 file:// 直接打开的，浏览器会拦截本地数据库。需要用 http 访问，或部署到静态托管。</p></div>`;
});
