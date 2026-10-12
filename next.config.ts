import type { NextConfig } from "next";

// Headers every response gets. A strict Content-Security-Policy is a later step: Next's dev tooling and the
// Google sign-in redirect need a tuned policy, and a wrong one breaks the app for everyone.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // pdf-parse and its canvas stay outside the bundle, as its guide says for Vercel (the parse fails bundled).
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  // The governance rules are read from disk at runtime (modules/governance/rules.ts): ship them with every server route.
  outputFileTracingIncludes: { "/**": ["./config/rules.json"] },
  poweredByHeader: false,
  experimental: {
    // Keep a page the user has just visited in the browser for a minute, so going feed → applications → feed does not
    // rebuild it on the server each time. Saves drop every kept page (lib/forget-pages.ts); the deck skips cards
    // already swiped (feed/swipe-deck.tsx); polling screens still poll.
    staleTimes: { dynamic: 60 },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
