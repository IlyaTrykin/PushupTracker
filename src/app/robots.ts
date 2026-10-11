import type { MetadataRoute } from 'next';
import { publicAppUrl } from '@/lib/public-url';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const base = publicAppUrl();
  return {
    rules: { userAgent: '*', allow: ['/', '/login', '/register'], disallow: ['/api/', '/uploads/', '/admin/'] },
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
