---
title: 为什么选 Astro：静态博客的性能与自由
description: 想要「页面精美动态，但性能很好」的博客，为什么最后选了 Astro 而不是 Hugo / Hexo / Next.js。
date: 2026-08-18
tags: [Astro, 建站]
series: 从零搭建一个高性能博客
seriesSlug: build-high-perf-blog
seriesOrder: 1
---

这个系列记录本站从零到上线的全过程。第一篇先回答选型问题 —— 我的需求很明确：**页面精美、有动态感，但性能必须好**。

## 候选者们

静态博客生成器的主流选项：

| 方案 | 优点 | 对我来说的问题 |
| ---- | ---- | ---- |
| Hugo | 极快、资历老 | 模板语言 Go template 写起来费劲，定制设计成本高 |
| Hexo | 中文生态大 | Node 老链路，主题改起来像考古 |
| Next.js | 生态最强 | 为博客引入 React 运行时，杀鸡用牛刀 |
| Astro | 默认零 JS、组件自由 | 需要自己动手的地方多一点 |

## Astro 赢在哪里

### 1. 默认零 JavaScript

Astro 输出纯静态 HTML，**页面默认不携带任何客户端框架运行时**。需要交互的地方用「岛屿」按需水合 —— 比如本站的搜索框，只有在你真的按 `⌘K` 时才会加载搜索索引。

结果就是 Lighthouse 五项满分的基本盘，Core Web Vitals 全绿。

### 2. 组件即 HTML

`.astro` 组件就是「模板 + 少量逻辑」，没有虚拟 DOM，没有 hooks 规则。写一个文章卡片：

```astro
---
const { title, date } = Astro.props;
---
<article class="card">
  <h3>{title}</h3>
  <time>{date}</time>
</article>

<style>
  .card { border: 1px solid #eee; }
</style>
```

样式默认**作用域隔离**，永远不会互相污染。

### 3. 内容集合（Content Collections）

文章即文件，但有一套带类型校验的规范：

```ts
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    series: z.string().optional(),
  }),
});
```

frontmatter 写错字段名，构建直接报错 —— 比上线后发现文章消失体面得多。

### 4. 视图过渡：MPA 的身板，SPA 的皮

```astro
import { ClientRouter } from 'astro:transitions';
```

一行引入视图过渡，页面切换有了淡入动画，主题切换做出了圆形扩散效果 —— 下一篇会讲怎么实现。关键是它本质上还是多页应用（MPA），没有 SPA 那些路由状态泥潭。

## 结论

> Astro 的哲学是「默认什么都不发往浏览器」，
> 动态效果是 CSS 和少量原生 JS 堆出来的，而不是框架运行时。

下一篇讲本站的设计与实现：纸墨配色、宋体标题、朱砂印章，以及那些克制的动效。
