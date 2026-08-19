---
title: 部署 GitHub Pages：推送即发布的全自动流水线
description: GitHub Actions 自动构建部署、Pagefind 站内搜索、giscus 评论系统 —— 写完 md 推一下，网站自己更新。
date: 2026-08-20
tags: [Astro, GitHub Actions, 部署]
series: 从零搭建一个高性能博客
seriesSlug: build-high-perf-blog
seriesOrder: 3
---

设计讲完了，最后把网站送上线。目标：**`git push` 之后什么都不用管**。

## 部署流水线

GitHub 官方的 Pages 部署动作，一个 workflow 文件搞定：

```yaml
on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build   # astro build && pagefind --site dist
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

推送 `main` 分支 → 装依赖 → 构建 → 生成搜索索引 → 部署，一气呵成。

## 站内搜索：Pagefind

[Pagefind](https://pagefind.app) 在**构建后**对静态 HTML 建索引，按需懒加载、支持中文分词。本站的做法：

1. 正文容器标上 `data-pagefind-body`（导航、页脚不会被索引）
2. `npm run build` 末尾追加 `pagefind --site dist`
3. 搜索框首次打开时才 `import('/pagefind/pagefind.js')`

索引切成小分块，博客几百篇也毫不费力。

## 评论：giscus

评论系统选 [giscus](https://giscus.app/zh-CN)：**数据存在 GitHub Discussions 里**，访客用 GitHub 账号登录评论，无广告、无追踪、可迁移。

启用三步：

1. 仓库开启 Discussions
2. 安装 giscus GitHub App
3. 把生成的 `repo-id` / `category-id` 填进站点配置

评论 iframe 用 `IntersectionObserver` 懒加载 —— 滚到评论区才请求，首屏性能不受影响。深浅主题切换时还会 `postMessage` 通知 iframe 同步换肤。

## SEO 三件套

- `@astrojs/sitemap` 自动生成 `sitemap-index.xml`
- 每页独立 `<title>` / `description` / canonical / Open Graph
- 文章页带 JSON-LD 结构化数据（`BlogPosting`），配合 `robots.txt` 指向站点地图

## 写作的完整闭环

```
写文章：src/content/posts/my-post.md
  ↓ git push
GitHub Actions 自动构建
  ↓
网站更新 + 搜索索引更新 + RSS 更新
```

从 `.md` 文件到被搜索引擎收录的页面，中间没有任何手动步骤。系列完结，欢迎去评论区（用你的 GitHub 账号）留个脚印。
