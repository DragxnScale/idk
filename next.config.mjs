import webpack from "next/dist/compiled/webpack/webpack-lib.js";
import { execSync } from "child_process";

let commitCount = 0;
try {
  commitCount = parseInt(
    execSync("git rev-list --count HEAD").toString().trim(),
    10
  );
} catch {}
// Vercel shallow clones give count=1; use VERCEL_GIT_COMMIT_COUNT or a fallback
if (commitCount <= 1 && process.env.VERCEL) {
  try {
    // Count commits from git log (works even in shallow clones if fetched)
    const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
    // Fallback: derive from short SHA to at least show a changing version
    commitCount = sha ? parseInt(sha.slice(0, 6), 16) % 900 + 100 : 100;
  } catch {}
}

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
