import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  experimental: { proxyClientMaxBodySize: '12mb' },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `http://127.0.0.1:${process.env.CIBO_API_PORT ?? '4000'}/api/:path*`,
      },
    ];
  },
};
export default config;
