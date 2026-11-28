import type { NextConfig } from 'next';

const staticExport = process.env.CIBO_STATIC_EXPORT === 'true';

const config: NextConfig = {
  output: staticExport ? 'export' : 'standalone',
  poweredByHeader: false,
  devIndicators: { position: 'bottom-right' },
  experimental: { proxyClientMaxBodySize: '32mb' },
  rewrites: staticExport ? undefined : async () => {
    return [
      {
        source: '/api/:path*',
        destination: `http://127.0.0.1:${process.env.CIBO_API_PORT ?? '4000'}/api/:path*`,
      },
    ];
  },
};
export default config;
