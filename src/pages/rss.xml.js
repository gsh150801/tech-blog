import rss from '@astrojs/rss';
import { SITE } from '../config';
import { getAllPosts } from '../utils/posts';
import { withBase } from '../utils/path';

export async function GET(context) {
  const posts = await getAllPosts();
  return rss({
    title: `${SITE.title} · ${SITE.tagline}`,
    description: SITE.description,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: withBase(`/posts/${post.id}/`),
      categories: post.data.tags,
    })),
    customData: '<language>zh-CN</language>',
  });
}
