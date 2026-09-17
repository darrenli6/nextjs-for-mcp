import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Turbopack scoped to this application directory.
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Enable Next.js' built-in MCP endpoint at /_next/mcp.
    mcpServer: true,
  },
};

export default nextConfig;
