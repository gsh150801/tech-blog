/**
 * 浏览器端 GitHub 客户端：文章管理台 / 合集管理台 / 在线编辑器共用。
 * 凭据存 localStorage（ed_repo / ed_branch / ed_token），不经过任何后端。
 */

export interface Cfg {
  repo: string;
  branch: string;
  token: string;
}

export function readCfg(): Cfg {
  return {
    repo: localStorage.getItem('ed_repo') || '',
    branch: localStorage.getItem('ed_branch') || 'main',
    token: localStorage.getItem('ed_token') || '',
  };
}

export function saveCfg(cfg: Cfg) {
  localStorage.setItem('ed_repo', cfg.repo);
  localStorage.setItem('ed_branch', cfg.branch || 'main');
  if (cfg.token) localStorage.setItem('ed_token', cfg.token);
}

export function b64e(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

export function b64d(s: string): string {
  const bin = atob(String(s).replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function gh<T = any>(path: string, init?: RequestInit): Promise<T> {
  const cfg = readCfg();
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status} · ${t.slice(0, 140)}`);
  }
  return res.status === 204 ? (null as T) : res.json();
}

/** 读取文本文件（返回内容与 sha） */
export async function getFile(path: string): Promise<{ content: string; sha: string }> {
  const cfg = readCfg();
  const j = await gh<any>(`/repos/${cfg.repo}/contents/${path}?ref=${cfg.branch}`);
  return { content: b64d(j.content), sha: j.sha };
}

/** 创建或更新文件；返回新 sha */
export async function putFile(path: string, text: string, message: string, sha?: string): Promise<string> {
  const cfg = readCfg();
  const body: any = { message, branch: cfg.branch, content: b64e(text) };
  if (sha) body.sha = sha;
  const j = await gh<any>(`/repos/${cfg.repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return j.content.sha as string;
}

/** 删除文件 */
export async function deleteFile(path: string, sha: string, message: string): Promise<void> {
  const cfg = readCfg();
  await gh(`/repos/${cfg.repo}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, branch: cfg.branch, sha }),
  });
}

// ---------------- frontmatter 工具 ----------------

export function splitFrontmatter(text: string): { fm: string; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { fm: '', body: text };
  return { fm: m[1], body: text.slice(m[0].length) };
}

export function getFmValue(content: string, key: string): string | null {
  const { fm } = splitFrontmatter(content);
  if (!fm) return null;
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!m) return null;
  const v = m[1].trim().replace(/^["']|["']$/g, '');
  return !v || v === 'null' ? null : v;
}

/** 设置（或追加）一个 frontmatter 键；value 直接作为行内容写入 */
export function setFmKey(content: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const has = new RegExp(`^${key}:.*$`, 'm');
  const open = /^---\r?\n/;
  const close = /\r?\n---(?:\s*(?:\n|$))/;

  if (!open.test(content)) return `---\n${line}\n---\n\n${content}`;
  if (has.test(content)) return content.replace(has, line);
  if (close.test(content)) return content.replace(close, `\n${line}\n---`);
  // 只有开头的异常情况：补一个闭合
  return `${content.trimEnd()}\n${line}\n---\n`;
}

/** 批量删除 frontmatter 键 */
export function removeFmKeys(content: string, keys: string[]): string {
  let out = content;
  for (const k of keys) {
    out = out.replace(new RegExp(`^${k}:.*$\\n?`, 'm'), '');
  }
  return out;
}

/**
 * 保存前清洗：删除「键: 空」的行（YAML 会解析成 null 导致构建失败，
 * 虽然 schema 已兼容，但保持文件干净）。
 */
export function cleanFrontmatter(text: string): string {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return text;
  const cleaned = m[1]
    .split('\n')
    .filter((line) => !/^[A-Za-z_][\w-]*:\s*(#.*)?$/.test(line.trimEnd()))
    .join('\n');
  return `---\n${cleaned}\n---${text.slice(m[0].length)}`;
}
