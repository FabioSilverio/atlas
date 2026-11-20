import type { NextConfig } from "next";

// Static export: the whole site is prebuilt HTML/JSON (GitHub Actions rebuilds it
// every hour from the database), so serving it costs no server functions.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
