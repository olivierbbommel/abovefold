import type { NextConfig } from "next";

/*
 * IMPORTANT: with `output: "standalone"`, rewrites are evaluated at BUILD time
 * and baked into .next/routes-manifest.json. Reading process.env here does NOT
 * make the destination runtime-configurable, whatever the builder stage sees is
 * what ships in the image. An agent set MINIFLUX_URL to a placeholder during a
 * Docker build and shipped `localhost:8080` into the manifest, which silently
 * broke the Reader API for every native client.
 *
 * So this is deliberately a constant. `MINIFLUX_URL` still exists as an env var
 * and IS honoured at runtime by lib/miniflux.ts for REST calls, just not here.
 */
const MINIFLUX_INTERNAL = "http://miniflux:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      // The Google Reader API. Reeder, NetNewsWire and Unread authenticate to
      // Miniflux directly here; these paths must stay outside the session cookie.
      { source: "/v1/:path*", destination: `${MINIFLUX_INTERNAL}/v1/:path*` },
      { source: "/googlereader/:path*", destination: `${MINIFLUX_INTERNAL}/googlereader/:path*` },
      // Miniflux's media proxy serves every thumbnail; without this, no images.
      { source: "/proxy/:path*", destination: `${MINIFLUX_INTERNAL}/proxy/:path*` },
    ];
  },
};

export default nextConfig;
