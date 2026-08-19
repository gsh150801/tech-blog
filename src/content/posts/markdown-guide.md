---
title: 在这个博客写文章：Markdown 完全指南
description: 本站支持的所有 Markdown 写作姿势 —— 标题、代码块、表格、任务列表、脚注、折叠块，一篇看懂。
date: 2026-08-17
tags: [Markdown, 写作]
series: 写作指南
seriesSlug: writing-guide
seriesOrder: 1
---

在这站写文章，只需要会 Markdown。这篇文章把所有支持的语法演示一遍，可以当作模板来抄。

## 基础排版

**加粗**、*斜体*、~~删除线~~、`行内代码`，以及[一个链接](https://astro.build)。

> 引用块适合放金句、注意事项，
> 或者从别处摘来的话。

## 列表

无序列表：

- 第一项
- 第二项
  - 嵌套项

有序列表：

1. 克隆仓库
2. 安装依赖
3. 开始写作

任务列表（写作进度管理很好用）：

- [x] 选题
- [x] 写大纲
- [ ] 完成初稿
- [ ] 校对发布

## 代码块

代码块自带语言标签和**一键复制**按钮，深浅主题下都会自动配色：

```ts
// TypeScript
interface Post {
  title: string;
  tags: string[];
  series?: string; // 所属合集
}

export function hello(post: Post): string {
  return `《${post.title}》收录进合集「${post.series ?? '未分组'}」`;
}
```

```python
# Python：快速排序，一行流
quick = lambda a: a if len(a) <= 1 else quick([x for x in a[1:] if x < a[0]]) + [a[0]] + quick([x for x in a[1:] if x >= a[0]])
```

```bash
# 本地启动开发服务器
npm run dev
```

## 表格

| 语法 | 用途 | 备注 |
| ---- | ---- | ---- |
| `**粗体**` | 强调 | 两个星号 |
| `` `代码` `` | 行内代码 | 反引号 |
| `> 引用` | 摘录 | 一层即可 |
| `~~删除~~` | 删除线 | 波浪号 |

## 脚注

正文里加一个脚注标记[^1]，页面底部会自动出现注释区。

[^1]: 就像这样 —— 这是自动生成的脚注。

## 折叠块（原生 HTML）

Markdown 里可以直接写 HTML，比如折叠：

<details>
<summary>点开看看里面有什么</summary>

藏着被折叠的内容，适合放长代码或补充说明。

</details>

## 分隔线

---

## Frontmatter：文章的「身份证」

每篇文章顶部的一段配置就是 frontmatter：

```yaml
---
title: 文章标题（必填）
description: 一句话摘要，显示在列表和搜索引擎里
date: 2026-08-17
tags: [Markdown, 写作]
series: 写作指南        # 可选：合集名，同名自动成卷
seriesOrder: 1          # 可选：合集内排序
pinned: false           # 可选：是否置顶
draft: false            # true 则不发布
---
```

把写好的 `.md` 文件放进 `src/content/posts/`，推送到 GitHub，网站就会自动更新 —— 这就是全部流程。
