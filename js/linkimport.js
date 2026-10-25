/**
 * 通过链接导入：从 #import=slug.key 解密拉取数据
 *
 * 设计：
 * - 密文存在服务器上（随机路径）
 * - 密钥只在 URL 的 # 之后，不会发送到服务器
 * - 浏览器拿到脚本后自己拼接、下载、解密
 */

import { validateBundle } from './import.js';

/**
 * 解析 location.hash 里的导入参数
 * @returns {{slug: string, key: string}|null}
 */
export function parseImportHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h.startsWith('import=')) return null;
  const val = h.slice('import='.length);
  if (!val) return null;
  const dot = val.lastIndexOf('.');
  if (dot <= 0) return null;
  const slug = val.slice(0, dot);
  const key = val.slice(dot + 1);
  if (!slug || !key) return null;
  return { slug, key };
}

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes) {
  // 优先用原生 DecompressionStream，不支持时回退
  if (typeof DecompressionStream === 'function') {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }
  throw new Error('这台设备的浏览器不支持解压，请手动导入');
}

/**
 * 拉取并解密导入包
 * @param {{slug:string,key:string}} param0
 * @param {string} baseUrl 站点基地址，用于拼数据地址
 */
export async function fetchEncryptedBundle({ slug, key }, baseUrl) {
  // 校验 slug 和 key 格式，防止拼出奇怪路径
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) throw new Error('导入参数格式不对');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(key)) throw new Error('密钥格式不对');

  const url = `${baseUrl}data/${slug}.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(res.status === 404
      ? '数据不存在了，链接可能已过期或被清理'
      : `下载失败（${res.status}）`);
  }
  const text = (await res.text()).trim();
  if (!text) throw new Error('下载到的内容是空的');

  const packed = b64urlToBytes(text);
  if (packed.length < 13) throw new Error('数据太短，可能已损坏');

  const iv = packed.slice(0, 12);
  const cipher = packed.slice(12);

  const keyBytes = b64urlToBytes(key);
  if (keyBytes.length !== 32) throw new Error('密钥长度不对');

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );

  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher);
  } catch {
    throw new Error('解密失败，链接可能不完整或被改动过');
  }

  const unzipped = await gunzip(new Uint8Array(plain));
  const json = new TextDecoder('utf-8').decode(unzipped);

  const result = validateBundle(json);
  if (!result.ok) {
    throw new Error('数据校验失败：' + result.errors.join('；'));
  }
  return result.data;
}
