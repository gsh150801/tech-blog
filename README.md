# 拾集 · GSH 的技术博客

> 拾技术之美，集生活之思。
>
> 一个「页面精美动态，但性能很好」的个人博客 —— 用 [Astro](https://astro.build) 静态生成，
> 部署到 GitHub Pages，零服务器成本，全自动发布。

**线上地址：** <https://gsh150801.github.io/tech-blog/>

---

## 特性一览

| 你的需求 | 实现方式 |
| -------- | -------- |
| ① 教程笔记 · Markdown 语法 | `src/content/posts/*.md` 用 Markdown + frontmatter 写作，支持 GFM（表格、任务列表、脚注、折叠块） |
| ② 小作文 / 随笔 | 同上，与教程同路径，由 `pinned` / `tags` 区分即可 |
| ③ 可被检索 | Pagefind 全文搜索（构建后索引、按需懒加载、支持中文）+ sitemap + canonical + JSON-LD |
| ④ GitHub 登录评论 | [giscus](https://giscus.app)（基于 GitHub Discussions） |
| ⑤ 小红书 / GitHub 等链接 | `src/config.ts` 的 `social` 字段自动渲染图标链接 |
| ⑥ 合集（系列） | `frontmatter` 中 `series: "合集名"` 自动归卷，`seriesSlug` 自定义 URL |

---

## 技术栈

- **Astro 5** —— 默认零 JS 静态生成
- **TypeScript + 严格内容集合**（`zod` 校验 frontmatter，写错字段构建即报）
- **Pagefind** —— 构建后生成的客户端全文搜索（无需服务端）
- **Shiki** —— 构建时双主题代码高亮，零运行时
- **View Transitions** —— 浏览器原生视图过渡，主题切换的圆形扩散动画
- **GitHub Actions** —— 推送即部署，零运维

---

## 快速上手

### 本地开发

```bash
git clone https://github.com/gsh150801/tech-blog.git
cd tech-blog
npm install
npm run dev          # http://localhost:4321/tech-blog/
```

### 写一篇新文章

```bash
echo '---
title: 你的文章标题
description: 一句话摘要（会显示在搜索结果和分享卡片里）
date: 2026-08-20
tags: [标签1, 标签2]
series: 合集名
seriesSlug: ascii-url-slug        # 推荐：避开中文路径，详情见下
seriesOrder: 1                    # 合集内排序
pinned: false
draft: false
---

正文 Markdown 写在这里。
' > src/content/posts/my-new-post.md
git add src/content/posts/my-new-post.md
git commit -m "post: my new post"
git push                              # 等 ~1 分钟，网站自动更新
```

完整 Markdown 语法演示：[Markdown 完全指南](https://gsh150801.github.io/tech-blog/posts/markdown-guide/)

### 写一个合集（系列）

只要在多篇文章的 frontmatter 里写同一个 `series` 名，网站会自动把它们装订成一卷：

```yaml
---
series: 从零搭建一个高性能博客
seriesSlug: build-high-perf-blog   # 可选，但强烈建议：URL 必须是 ASCII
seriesOrder: 1                      # 合集内排序，小的在前
---
```

> ⚠️ **关于 seriesSlug：**
> GitHub Pages 对 URL 路径段里含 `%xx` 编码（中文）的请求会返回 404（即便文件实际存在），
> 所以合集页 URL 必须用 ASCII slug。 在第一篇文章里加 `seriesSlug: my-slug`，后续文章留空也能自动继承。

---

## 接上 giscus 评论

评论组件已写好，但需要去仓库里开启 Discussions 并填两个 ID 才能生效：

1. 进入 <https://github.com/gsh150801/tech-blog/settings>，开启 Discussions
2. 安装 giscus App：<https://github.com/apps/giscus>（选你的 tech-blog 仓库）
3. 打开 <https://giscus.app/zh-CN>，按提示填仓库名，把生成的 `data-repo-id` 和 `data-category-id` 复制下来
4. 编辑 `src/config.ts`：

   ```ts
   export const GISCUS = {
     enabled: true,
     repo: 'gsh150801/tech-blog',
     repoId: 'R_xxx',       // 粘贴你的 repo-id
     category: 'Announcements',
     categoryId: 'DIC_xxx', // 粘贴你的 category-id
     // …
   };
   ```

5. `git push` 重新部署。评论区会自动出现。

---

## 配置你的联系方式

`src/config.ts` 集中管理站点信息：

```ts
export const SITE = {
  title: '拾集',
  subtitle: 'GSH 的技术手记',
  tagline: '拾技术之美，集生活之思',
  repo: 'gsh150801/tech-blog',
  social: {
    github: 'https://github.com/gsh150801',
    xiaohongshu: '',           // ← 填入你的小红书主页链接即可显示
    email: '',                 // ← 填入邮箱即可
    rss: true,
  },
};
```

改完 `git push` 即可生效。

---

## 部署

- 推送 `main` 分支 → `.github/workflows/deploy.yml` 自动构建 → GitHub Pages
- 部署日志：<https://github.com/gsh150801/tech-blog/actions>
- 想换域名？仓库 Settings → Pages → Custom domain

---

## 性能要点

- 默认零 JS，只有搜索 / 主题切换 / 评论框在需要时才加载
- 自托管字体只取了 **拉丁数字子集 66KB**（中文走系统字体）
- CSS 内联构建（`build.inlineStylesheets: 'auto'`）
- 代码高亮在构建时完成，浏览器零渲染开销
- 入场动效全部走 `transform` / `opacity`，且尊重 `prefers-reduced-motion`

---

## ⚠️ 安全提醒：你的 Token

**绝对不要** 把 GitHub Personal Access Token 直接写在聊天框、issue、commit message、截图或 markdown 文档里。

### 现在立刻做的事：

1. **进入** <https://github.com/settings/tokens> 检查最近的 token，**对任何曾出现在聊天记录里的 token 立刻 Revoke（作废）**
2. **安全日志** 检查：<https://github.com/settings/security-log>
3. （建议）开启 GitHub 推送保护（Push Protection），它能阻止有人不小心把密钥提交进仓库 —— **这个仓库的这次拦截就救了你一次**

### 更安全的做法：

```bash
# 本地 ~/.zshrc 里加：
export GH_TOKEN=ghp_新token_自己申请

# 然后再执行 gh 命令
gh auth login --with-token <<<"$GH_TOKEN"
```

- 永远不要把 token 写在 markdown、issue、commit message、截图里
- 给 token 加 **最短够用的 scopes**（通常只需 `repo`；部署用 `workflow`；评论只需要 repo 读权限）
- 任何「能跑就行」的脚本里临时存的 token，**用完立刻作废重发**

> 💡 **这次踩的坑**：本次会话里我的回复为了演示，引用了你粘贴过来的真实 token 字串。
> GitHub Push Protection 立刻识别并拦截了 README 的 push —— **这正是这个机制的用武之地**。
> 请按上面的步骤 1 立即作废它，再去申请一个最小权限的新 token。

---

### 顺手帮你检查的两个旧仓库

| 仓库 | 我做了什么 |
| ---- | ---------- |
| `gsh150801.github.io` | 没动，里面是 Jekyll 旧博客（含 2017–2020 的真实文章）。想要的话可以迁到本站 |
| `blog` | 没动，**但发现里面有一个 `.env` 文件**（已提交进 git）。建议：<br>① 如果里面还有真实密钥，立刻到对应服务后台重置密钥；<br>② `git rm .env && git commit -m "remove .env" && git push` 把文件从仓库里删掉；<br>③ 同步检查是否需要清理 git history（`git filter-repo` 或 GitHub 的「Remove sensitive data」工具） |

---

## 项目结构

```
src/
├── components/          # 可复用 UI 组件
│   ├── Seal.astro         # 朱砂印章 logo
│   ├── Header.astro       # 顶栏（含搜索/主题切换/移动端菜单）
│   ├── ThemeToggle.astro  # 主题切换（View Transitions 圆形扩散）
│   ├── SearchDialog.astro# Pagefind 搜索框（懒加载索引）
│   ├── FeatureCard.astro  # 首页精选文章大卡
│   ├── PostRow.astro      # 文章列表行
│   ├── Toc.astro          # 文章目录（滚动高亮）
│   ├── SeriesBox.astro    # 合集导航（上/下篇、当前合集全部篇目）
│   └── Giscus.astro       # giscus 评论（IntersectionObserver 懒加载）
├── content/posts/       # 📝 你的所有 .md 文章
├── layouts/Base.astro    # 全站外壳（含主题初始化、SEO、脚本）
├── pages/
│   ├── index.astro       # 首页
│   ├── posts/            # 文章列表 / 详情
│   ├── series/           # 合集列表 / 详情
│   ├── tags/             # 标签云 / 单标签
│   ├── about.astro       # 关于
│   ├── 404.astro         # 404
│   └── rss.xml.js        # RSS
├── styles/
│   ├── fonts.css         # 自托管拉丁字体
│   └── global.css        # 纸墨双主题、动效、组件样式
├── utils/                # 路径、集合、文章工具函数
├── config.ts             # 站点全局配置（标题、社交、giscus 等）
└── content.config.ts     # 文章 frontmatter 类型定义

public/                   # 直接拷贝到根目录的静态资源
├── favicon.svg
├── og-banner.svg         # 分享卡片大图
└── robots.txt

.github/workflows/
└── deploy.yml            # 推 main → 构建 → 部署到 Pages
```

---

## License

MIT — 随便用、随便改，署名即可。

---

> 写于深圳 · 立秋后的第三个星期三。