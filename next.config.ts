import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Hosts permitted to load dev-server resources cross-origin.
   *
   * Development only — Next.js ignores this in production builds. It exists so
   * the app can be opened from another device on the LAN (a phone, for testing
   * the responsive layout) without the JS chunks being blocked, which silently
   * prevents hydration rather than failing loudly.
   *
   * Private ranges only. Never add a public host here.
   */
  allowedDevOrigins: ['192.168.100.131', '127.0.0.1', '192.168.*.*', '10.*.*.*'],

  // Route hrefs are type-checked against the actual route tree, so a typo in a
  // link becomes a compile error rather than a 404 someone finds later.
  typedRoutes: true,
};

export default nextConfig;
