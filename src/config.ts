/**
 * 站点全局配置 —— 改这里就能换掉几乎所有个性化内容
 */

export const SITE = {
  /** 站点名（显示在标题栏与页脚） */
  title: '拾集',
  /** 副标题 */
  subtitle: 'GSH 的技术手记',
  /** 一句话介绍（用于首页 Hero 与 SEO 描述） */
  tagline: '拾技术之美，集生活之思',
  description:
    '拾集 —— GSH 的个人技术博客：编程教程、学习笔记、随笔小作文，按合集整理，欢迎分享交流。',
  /** 作者 */
  author: 'GSH',
  /** 语言 */
  locale: 'zh-CN',
  /** 仓库（用于「编辑本文」链接与 Issue 反馈） */
  repo: 'gsh150801/tech-blog',
  /** 每个分页显示的文章数 */
  pageSize: 10,
  /** 社交链接（留空则不显示对应图标） */
  social: {
    github: 'https://github.com/gsh150801',
    xiaohongshu: '', // 例如：https://www.xiaohongshu.com/user/profile/xxxxxxxx
    email: '', // 例如：me@example.com
    rss: true, // RSS 图标，基于 /rss.xml 自动生成
  },
} as const;

/**
 * giscus 评论配置（基于 GitHub Discussions，用 GitHub 账号登录评论）
 * 仓库启用 Discussions 并安装 giscus App 后，以下 ID 会自动填好；
 * 也可以到 https://giscus.app/zh-CN 重新生成。
 */
export const GISCUS = {
  enabled: true,
  repo: 'gsh150801/tech-blog',
  repoId: '', // 部署脚本会自动填充
  category: 'Announcements',
  categoryId: '', // 部署脚本会自动填充
  mapping: 'pathname',
  reactionsEnabled: '1',
  inputPosition: 'top',
  lang: 'zh-CN',
} as const;

/**
 * 合集的展示信息（按合集名匹配；未配置的合集会退化为仅显示名称）
 */
export const SERIES_META: Record<string, { description?: string }> = {
  从零搭建一个高性能博客: {
    description: '用一个真实站点当例子：从选型、设计到部署 GitHub Pages 的完整实录。',
  },
  写作指南: {
    description: '本站支持的所有 Markdown 写作姿势，一篇看懂。',
  },
};
