import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The Windows installer and the macOS DMG ship this self-contained server;
  // source installs keep `next start`.
  ...(process.env.CHLOE_STANDALONE === '1' ? {
    output: 'standalone' as const,
    // cwd-relative data paths make the tracer copy the whole checkout; ship code only.
    outputFileTracingExcludes: { '/*': ['.git/**', 'data/**', 'macos/**', 'docs/**', 'script/**', 'windows/**', 'dist/**',
      'src/**', 'prisma/**', 'licenses/**', '*.md', '*.cmd', '*.command', 'eslint.config.mjs', 'tsconfig*.json', '*.tsbuildinfo', 'package-lock.json', 'next.config.ts'] },
    // Route handlers load this runtime by name at request time, which the tracer misses.
    outputFileTracingIncludes: { '/*': ['node_modules/next/dist/compiled/next-server/app-route-turbo*.runtime.prod.js'] },
  } : {}),
  cacheComponents: true,
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  // File uploads accept 50 MB plus multipart overhead. Keep the proxy buffer
  // aligned so larger valid documents are not silently truncated at 10 MB.
  experimental: { proxyClientMaxBodySize: '55mb' },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    ] }];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
