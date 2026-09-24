import type { NextConfig } from "next";

// Set when this app is reverse-proxied under portfolio-site at /contract-value,
// so its own asset/page URLs are already prefixed and the shell's
// /contract-value/:path* rewrite can route them back here. Leave unset to
// run this app standalone at its own root (e.g. its own Vercel domain).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
};

export default nextConfig;
