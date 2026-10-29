import type { MetadataRoute } from 'next';

// The Windows build opens Chloe as an Edge app window; Edge takes the window
// and taskbar icon from this manifest, so it matches the Start menu shortcut.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Chloe Assistant',
    short_name: 'Chloe',
    description: 'Kişisel yapay zekâ çalışma alanı',
    start_url: '/',
    display: 'standalone',
    background_color: '#090b0d',
    theme_color: '#28765c',
    icons: [
      { src: '/chloe-icon-256.png', sizes: '256x256', type: 'image/png' },
      { src: '/chloe-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
