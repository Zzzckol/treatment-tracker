/**
 * 数据层：IndexedDB 封装 + 各表增删改查
 * 设计原则：所有数据都在本机，导出即备份；结构扁平，方便以后迁移。
 */

const DB_NAME = 'tx-tracker';
const DB_VER = 1;

const STORES = {
  appointments: { key: 'id', idx: [['date', 'date']] },   // 日程
  labs: { key: 'id', idx: [['date', 'date']] },           // 化验
  symptoms: { key: 'id', idx: [['date', 'date']] },       // 每日症状
  docs: { key: 'id', idx: [['date', 'date']] },           // 资料
  notes: { key: 'id', idx: [['date', 'date']] },          // 就诊问答/备忘
  settings: { key: 'k', idx: [] },
};

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const s = db.createObjectStore(name, { keyPath: cfg.key });
          for (const [n, path] of cfg.idx) s.createIndex(n, path, { unique: false });
        }
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(name, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(name, mode);
    const store = t.objectStore(name);
    let result;
    try { result = fn(store); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- 通用 CRUD ---------- */

export async function put(storeName, obj) {
  if (!obj.id) obj.id = uid();
  if (storeName !== 'settings') {
    obj.updatedAt = new Date().toISOString();
    if (!obj.createdAt) obj.createdAt = obj.updatedAt;
  }
  return tx(storeName, 'readwrite', (s) => s.put(obj));
}

export async function get(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(storeName).objectStore(storeName).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function del(storeName, id) {
  return tx(storeName, 'readwrite', (s) => s.delete(id));
}

export async function all(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(storeName).objectStore(storeName).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

/** 按日期升序取全部 */
export async function allByDate(storeName) {
  const rows = await all(storeName);
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export async function clearStore(storeName) {
  return tx(storeName, 'readwrite', (s) => s.clear());
}

/* ---------- 设置 ---------- */

const SETTINGS_CACHE = new Map();

export async function getSetting(key, fallback = null) {
  if (SETTINGS_CACHE.has(key)) return SETTINGS_CACHE.get(key);
  const row = await get('settings', key);
  const v = row ? row.v : fallback;
  SETTINGS_CACHE.set(key, v);
  return v;
}

export async function setSetting(key, v) {
  SETTINGS_CACHE.set(key, v);
  return put('settings', { k: key, v });
}

export async function getSettings() {
  const rows = await all('settings');
  const o = {};
  for (const r of rows) o[r.k] = r.v;
  return o;
}

/* ---------- 患者信息 ---------- */

export const DEFAULT_PROFILE = {
  name: '',
  sex: '',
  birth: '',
  diagnosis: '',
  stage: '',
  hospital: '',
  dept: '',
  doctor: '',
  doctorPhone: '',
  nursePhone: '',
  // 治疗周期设置
  chemoCycleDays: 21,     // 化疗周期天数
  chemoDay: 1,            // 第几天给药
  immunoCycleDays: 21,    // 免疫治疗间隔
  radioTotal: 0,          // 放疗总次数
  radioDone: 0,           // 已完成次数
  startedAt: '',
  // 推送
  serverchanKey: '',
  ghToken: '',
  ghRepo: '',
};

export async function getProfile() {
  const p = await getSetting('profile', null);
  return { ...DEFAULT_PROFILE, ...(p || {}) };
}

export async function saveProfile(patch) {
  const cur = await getProfile();
  const next = { ...cur, ...patch };
  await setSetting('profile', next);
  return next;
}

/* ---------- 备份 / 恢复 ---------- */

export async function exportAll() {
  const out = { version: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const name of Object.keys(STORES)) {
    out.data[name] = await all(name);
  }
  return out;
}

export async function importAll(payload, { merge = true } = {}) {
  if (!payload || !payload.data) throw new Error('文件格式不对，缺少 data 字段');
  const counts = {};
  for (const name of Object.keys(STORES)) {
    const rows = payload.data[name];
    if (!Array.isArray(rows)) continue;
    if (!merge) await clearStore(name);
    for (const row of rows) {
      await put(name, { ...row });
    }
    counts[name] = rows.length;
  }
  SETTINGS_CACHE.clear();
  return counts;
}

export { STORES };
