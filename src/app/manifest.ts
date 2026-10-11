import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pushup Tracker',
    short_name: 'Pushup',
    description: 'Трекер отжиманий и тренировок с друзьями: баллы, цель дня, серия, лига недели',
    lang: 'ru',
    categories: ['health', 'fitness', 'sports'],
    orientation: 'portrait',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#0b0b0b',
    theme_color: '#0b0b0b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-256.png', sizes: '256x256', type: 'image/png' },
      { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
