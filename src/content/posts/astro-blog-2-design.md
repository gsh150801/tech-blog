---
title: 纸墨与朱砂：本站的设计与动效实现
description: 宣纸暖白与深墨黑的双主题、宋体标题、朱砂印章，以及「性能优先」的动效清单 —— 全部 CSS 实现。
date: 2026-08-19
tags: [Astro, CSS, 设计]
series: 从零搭建一个高性能博客
seriesSlug: build-high-perf-blog
seriesOrder: 2
---

技术选好了，接着定调子。我不想要那种「一眼 AI 生成」的模板脸，于是给站点定了一个方向：**纸墨与朱砂**。

## 设计语言

- **配色**：宣纸暖白（`#f5efe2`）为底，墨色文字，朱砂红（`#b93a1a`）做唯一强调色；深色模式换成暖黑（不是常见的蓝黑），像砚台
- **字体**：标题用衬线（宋体 + Fraunces），正文用系统无衬线 —— 中文 webfont 动辄几 MB，为了性能全部用系统字体，只自托管了一个 66KB 的拉丁数字字体
- **签名元素**：朱砂印章 Logo、竖排装饰文字、大号日期数字、`· · ·` 分隔符
- **质感**：一层极淡的噪点纹理（SVG `feTurbulence` 内联 data URI），纸感就出来了

全部收敛在 CSS 变量里，切换主题只改 `data-theme`：

```css
:root {
  --bg0: #f5efe2;
  --ink: #27211a;
  --accent: #b93a1a; /* 朱砂 */
}

[data-theme='dark'] {
  --bg0: #16120d;
  --ink: #ece2cd;
  --accent: #ff7448; /* 暗夜里亮一点的朱砂 */
}
```

## 动效清单（以及为什么它们不伤性能）

原则：**只动 `transform` 和 `opacity`**，其余交给 CSS 过渡。

### 1. 入场揭示

`IntersectionObserver` 给进入视口的元素加 `.in` 类：

```css
.reveal {
  opacity: 0;
  transform: translateY(18px);
  transition: 0.7s var(--ease-out);
  transition-delay: var(--rd); /* 交错延迟 */
}

.reveal.in {
  opacity: 1;
  transform: none;
}
```

首屏元素带 `--rd: 0.08s` 递增的延迟，进来就是一组编排过的编排动画。

### 2. 主题切换的圆形扩散

用 View Transition API，从点击的按钮位置扩散出一圈新主题：

```js
const x = btn.centerX, y = btn.centerY;
const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

document.documentElement.style.setProperty('--ripple-x', x + 'px');
// --ripple-y / --ripple-r 同理

const t = document.startViewTransition(() => applyTheme(next));
```

```css
@keyframes theme-ripple-in {
  from { clip-path: circle(0% at var(--ripple-x) var(--ripple-y)); }
  to   { clip-path: circle(var(--ripple-r) at var(--ripple-x) var(--ripple-y)); }
}
```

浏览器原生截图过渡，性能由合成器保证。

### 3. Hero 的墨晕漂移

三个大半径径向渐变 + `filter: blur(70px)`，用 20 秒以上的 `transform` 循环缓慢漂移。`will-change: transform`，全程不触发重排。

### 4. 克制的地方

所有动效都包在 `prefers-reduced-motion: reduce` 的尊重逻辑里；悬停位移不超过 4px；没有一个动效超过 0.7 秒。

## 排版细节

正文字号 1.02rem、行高 1.95 —— 中文阅读需要比英文更松的行距。代码块是 Shiki 双主题：构建时同时输出明暗两套颜色到 CSS 变量，切换主题零延迟：

```css
[data-theme='dark'] .astro-code span {
  color: var(--shiki-dark) !important;
}
```

下一篇是最后一篇：部署到 GitHub Pages、接上 giscus 评论，全自动发布流水线。
