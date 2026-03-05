import webpack from "next/dist/compiled/webpack/webpack-lib.js";
import { execSync } from "child_process";

let commitCount = 0;
try {
  // Vercel uses shallow clones; unshallow first if possible
  try { execSync("git fetch --unshallow 2>/dev/null || true", { stdio: "ignore" }); } catch {}
  commitCount = parseInt(
    execSync("git rev-list --count HEAD").toString().trim(),
    10
  );
} catch {}

const major = 1 + Math.floor(commitCount / 100);
const minor = commitCount % 100;
const appVersion = `${major}.${String(minor).padStart(2, "0")}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  webpack: (config) => {
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^canvas$/ })
    );
    config.resolve.alias.encoding = false;
    return config;
  },
};

export default nextConfig;
