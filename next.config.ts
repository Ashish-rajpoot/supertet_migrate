import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mongoose opens native sockets and must not be bundled by Turbopack/webpack.
  serverExternalPackages: ["mongoose"],
};

export default nextConfig;

