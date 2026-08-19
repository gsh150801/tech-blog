import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    /** 所属合集（series）名称，同名的文章会自动归为一卷 */
    series: z.string().optional(),
    /** 显式指定合集详情页的英文 URL slug；不填则用 series 名的 %xx 编码 */
    seriesSlug: z.string().optional(),
    /** 合集内排序（小的在前），缺省按日期排 */
    seriesOrder: z.number().optional(),
    /** 置顶文章（首页精选位） */
    pinned: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
