import { getCollection, type CollectionEntry } from 'astro:content';
import { withBase } from './path';
import seriesRegistry from '../data/series.json';

export type Post = CollectionEntry<'posts'>;

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 合集注册表（src/data/series.json），管理台在线编辑的就是这个文件 */
export interface SeriesDef {
  name: string;
  slug: string;
  description?: string;
}

export interface SeriesEntry {
  name: string;
  slug: string;
  description?: string;
  /** 是否在注册表中定义（false = 仅由文章 frontmatter 携带） */
  registered: boolean;
  posts: Post[];
}

export function getSeriesRegistry(): SeriesDef[] {
  return (seriesRegistry as SeriesDef[]).filter((s) => s && s.name);
}

/**
 * 控制草稿（draft: true）是否参与构建并出现在公开站点上。
 * - 公开站点（含 Pages CI 构建）下，草稿一律隐藏，避免误发
 * - 想看草稿？本地运行 `INCLUDE_DRAFTS=1 npm run build` 即可临时编入
 */
const INCLUDE_DRAFTS =
  // 仅在 CI 显式注入或本地开发构建时包含草稿
  process.env.INCLUDE_DRAFTS === '1' || process.env.NODE_ENV === 'development';

/** 获取全部文章；默认过滤草稿 */
export async function getAllPosts(): Promise<Post[]> {
  const posts = await getCollection('posts');
  const filtered = INCLUDE_DRAFTS ? posts : posts.filter(({ data }) => !data.draft);
  return filtered.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** 取草稿（仅在 include drafts 时返回，否则空） */
export async function getDrafts(): Promise<Post[]> {
  if (!INCLUDE_DRAFTS) return [];
  const posts = await getCollection('posts', ({ data }) => data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** 文章链接 */
export function postUrl(post: Post): string {
  return withBase(`/posts/${post.id}/`);
}

/** 阅读时长（分钟）：中文按 350 字/分钟，英文按 220 词/分钟 */
export function readingTime(post: Post): number {
  const text = post.body ?? '';
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const words = text
    .replace(/[\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(cjk / 350 + words / 220));
}

/** 标签 -> 文章数（按文章数降序） */
export function getAllTags(posts: Post[]): [tag: string, count: number][] {
  const map = new Map<string, number>();
  for (const p of posts) for (const t of p.data.tags) map.set(t, (map.get(t) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
}

/** 合集 -> 文章列表（合集内按 seriesOrder 升序，缺省按日期正序）；旧接口，见 resolveSeries */
export function getSeries(posts: Post[]): Map<string, Post[]> {
  const map = new Map<string, Post[]>();
  for (const p of posts) {
    if (!p.data.series) continue;
    const list = map.get(p.data.series) ?? [];
    list.push(p);
    map.set(p.data.series, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => {
      const oa = a.data.seriesOrder ?? Number.MAX_SAFE_INTEGER;
      const ob = b.data.seriesOrder ?? Number.MAX_SAFE_INTEGER;
      return oa !== ob ? oa - ob : a.data.date.valueOf() - b.data.date.valueOf();
    });
  }
  return map;
}

function sortSeriesPosts(list: Post[]) {
  list.sort((a, b) => {
    const oa = a.data.seriesOrder ?? Number.MAX_SAFE_INTEGER;
    const ob = b.data.seriesOrder ?? Number.MAX_SAFE_INTEGER;
    return oa !== ob ? oa - ob : a.data.date.valueOf() - b.data.date.valueOf();
  });
}

/**
 * 合集全量解析：注册表定义 ∪ 文章 frontmatter 携带的 series 取并集。
 * slug 优先级：注册表 > 文章 seriesSlug > 合集名编码。
 * 有文章的合集按最新文章日期倒序，空合集（先建卷后写作）排最后。
 */
export function resolveSeries(posts: Post[]): SeriesEntry[] {
  const registry = getSeriesRegistry();
  const byName = new Map<string, Post[]>();
  for (const p of posts) {
    if (!p.data.series) continue;
    const list = byName.get(p.data.series) ?? [];
    list.push(p);
    byName.set(p.data.series, list);
  }

  const names = new Set<string>([...registry.map((r) => r.name), ...byName.keys()]);
  const entries: SeriesEntry[] = [];
  for (const name of names) {
    const reg = registry.find((r) => r.name === name);
    const list = byName.get(name) ?? [];
    sortSeriesPosts(list);
    const slug =
      reg?.slug ??
      list.find((p) => p.data.seriesSlug)?.data.seriesSlug ??
      encodeURIComponent(name);
    entries.push({
      name,
      slug,
      description: reg?.description,
      registered: !!reg,
      posts: list,
    });
  }

  entries.sort((a, b) => {
    const ta = a.posts.length ? Math.max(...a.posts.map((p) => p.data.date.valueOf())) : 0;
    const tb = b.posts.length ? Math.max(...b.posts.map((p) => p.data.date.valueOf())) : 0;
    if (ta !== tb) return tb - ta;
    if (!!a.posts.length !== !!b.posts.length) return a.posts.length ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh');
  });
  return entries;
}

/** 合集在系列页的 slug：
 *  1) 优先用系列文章 frontmatter 里的 seriesSlug 字段（ASCII 安全路径，避开 Pages 404）
 *  2) 缺省回退到 %xx 编码
 */
export function seriesSlug(name: string, explicit?: string): string {
  return explicit || encodeURIComponent(name);
}

/** 第 n 个合集的中文卷号（卷一、卷二……） */
export function cnVolume(n: number): string {
  if (n <= 0) return CN_NUM[0];
  if (n < CN_NUM.length) return CN_NUM[n];
  return String(n);
}

/** 格式化日期为中文 */
export function formatDate(d: Date, withYear = true): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return withYear ? `${y} 年 ${m} 月 ${day} 日` : `${m} 月 ${day} 日`;
}
