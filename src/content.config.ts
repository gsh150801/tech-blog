import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * YAML 里 `key:` 冒号后留空会解析成 null，手写时极易踩中
 * （zod 的 .optional() 只接受字段不存在）。这里统一把 null / 空串
 * 归一为 undefined，让空字段等价于「没写」。
 */
const optionalString = z.preprocess(
  (v) => (v === null || v === '' ? undefined : v),
  z.string().optional(),
);

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: optionalString,
    date: z.coerce.date(),
    updated: z.preprocess(
      (v) => (v === null || v === '' ? undefined : v),
      z.coerce.date().optional(),
    ),
    tags: z.preprocess((v) => (v == null ? [] : v), z.array(z.string()).default([])),
    /** 所属合集（series）名称，同名的文章会自动归为一卷 */
    series: optionalString,
    /** 显式指定合集详情页的英文 URL slug；不填则用 series 名的 %xx 编码 */
    seriesSlug: optionalString,
    /** 合集内排序（小的在前），缺省按日期排 */
    seriesOrder: z.preprocess(
      (v) => (v === null || v === '' ? undefined : v),
      z.coerce.number().optional(),
    ),
    /** 置顶文章（首页精选位） */
    pinned: z.preprocess((v) => (v == null ? false : v), z.boolean().default(false)),
    draft: z.preprocess((v) => (v == null ? false : v), z.boolean().default(false)),
  }),
});

export const collections = { posts };
