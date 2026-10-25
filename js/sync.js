/**
 * 共享同步：用 GitHub 仓库做免费的中转存储
 *
 * 为什么这么做
 * -----------
 * 你要的是"病人记完我能看到"，不想注册新服务。
 * 你已经有 GitHub 仓库和 token（之前配微信推送时建的），
 * 直接拿它当同步中转站，不必再引入 Supabase。
 *
 * 机制：
 *   病人手机 → 生成共享码（数据加密后写进仓库 data/sync/<码>.json）
 *   你的手机 → 输入共享码 → 随时拉最新（只读）
 *
 * 安全：
 *   - 内容是 AES-GCM 加密的，仓库里只有密文
 *   - 密钥在共享码里，只有拿到码的人能解开
 *   - 文件名用随机码，猜不到
 *
 * 局限（必须说清楚）：
 *   - 不是实时。病人点了「更新共享」才会写新的
 *   - 只读查看方不能反向写回（避免两个人同时改冲突）
 */

import { validateBundle } from './import.js';

const REPO_FILE = 'data/sync';

/* ---------- 加解密 ---------- */

function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzip(bytes) {
  if (typeof CompressionStream !== 'function') {
    throw new Error('这台设备的浏览器不支持压缩，请更新系统版本');
  }
  const cs = new CompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('这台设备的浏览器不支持解压，请更新系统版本');
  }
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encryptJSON(obj, keyBytes) {
  const json = JSON.stringify(obj);
  const gz = await gzip(new TextEncoder().encode(json));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, gz);
  const packed = new Uint8Array(12 + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), 12);
  return bytesToB64url(packed);
}

async function decryptJSON(b64, keyBytes) {
  const packed = b64urlToBytes(b64);
  if (packed.length < 13) throw new Error('数据太短，可能已损坏');
  const iv = packed.slice(0, 12);
  const cipher = packed.slice(12);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  } catch {
    throw new Error('解密失败，共享码可能不对或被改过');
  }
  const un = await gunzip(new Uint8Array(plain));
  return JSON.parse(new TextDecoder('utf-8').decode(un));
}

/* ---------- 共享码 ---------- */

/**
 * 共享码格式：<slug>.<key>
 * slug 决定仓库里的文件名，key 是解密密钥
 */
export function makeShareCode() {
  const slugBytes = crypto.getRandomValues(new Uint8Array(9));
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const slug = bytesToB64url(slugBytes);
  const key = bytesToB64url(keyBytes);
  return { slug, key, code: `${slug}.${key}`, keyBytes };
}

export function parseShareCode(input) {
  let s = String(input || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
  if (!s) return null;
  // 兼容带前缀的写法
  s = s.replace(/^share[:=]/i, '');
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return null;
  const slug = s.slice(0, dot).replace(/[^A-Za-z0-9_-]/g, '');
  const key = s.slice(dot + 1).replace(/[^A-Za-z0-9_-]/g, '');
  if (slug.length < 6 || key.length < 40) return null;
  return { slug, key, code: `${slug}.${key}` };
}

/* ---------- GitHub 读写 ---------- */

async function ghGetSha(repo, path, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });
  if (res.status === 404) return { sha: null, content: null };
  if (!res.ok) throw new Error(`读取失败（${res.status}）`);
  const j = await res.json();
  // content 是 base64，带换行
  const raw = j.content ? j.content.replace(/\n/g, '') : '';
  return { sha: j.sha, content: raw ? atob(raw) : null };
}

async function ghPut(repo, path, token, text, message) {
  const existing = await ghGetSha(repo, path, token);
  const body = {
    message: message || '更新共享数据',
    content: btoa(unescape(encodeURIComponent(text))),
    branch: 'main',
  };
  if (existing.sha) body.sha = existing.sha;

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`写入失败（${res.status}）：${t.slice(0, 100)}`);
  }
  return true;
}

/* ---------- 对外接口 ---------- */

/**
 * 把当前所有数据推到云端，返回共享码
 * @param {object} snapshot 由调用方传完整的 {profile, labs, appointments, docs, symptoms}
 * @param {{token:string, repo:string}} cfg
 * @param {string} code 已有的共享码（续用同一个），没有就新生成
 */
export async function pushShared(snapshot, cfg, code) {
  if (!cfg?.token || !cfg?.repo) throw new Error('还没配置 GitHub Token 和仓库');

  let parsed = code ? parseShareCode(code) : null;
  let keyBytes;

  if (parsed) {
    keyBytes = b64urlToBytes(parsed.key);
    if (keyBytes.length !== 32) throw new Error('共享码里的密钥不对');
  } else {
    const made = makeShareCode();
    parsed = made;
    keyBytes = made.keyBytes;
  }

  const b64 = await encryptJSON(snapshot, keyBytes);
  const path = `${REPO_FILE}/${parsed.slug}.json`;
  await ghPut(cfg.repo, path, cfg.token, b64, '更新治疗数据共享');

  return {
    code: parsed.code,
    updatedAt: new Date().toISOString(),
    bytes: b64.length,
  };
}

/**
 * 用共享码拉取数据（只读）
 */
export async function pullShared(code, cfg) {
  const parsed = parseShareCode(code);
  if (!parsed) throw new Error('共享码格式不对，应该像 xxxxxx.yyyyyy 这样');

  const keyBytes = b64urlToBytes(parsed.key);
  if (keyBytes.length !== 32) throw new Error('共享码里的密钥不对');

  const path = `${REPO_FILE}/${parsed.slug}.json`;
  const got = await ghGetSha(cfg.repo, path, cfg.token);
  if (!got.content) throw new Error('没找到这个共享码对应的数据，可能还没上传过');

  const bundle = await decryptJSON(got.content.trim(), keyBytes);
  const checked = validateBundle(bundle);
  if (!checked.ok) throw new Error('数据格式校验失败：' + checked.errors.join('；'));
  return checked.data;
}
