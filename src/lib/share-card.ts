/**
 * The share link's preview card (Phase U3, `app/j/[slug]/opengraph-image.tsx`, design/share.html 13–14). ImageResponse
 * draws without CSS variables, so the Direction B light tokens it uses are written out here, once. The card is always
 * light: LinkedIn and X draw it on their own backgrounds.
 */

export const CARD = {
  background: "#f6f4ef",
  text: "#1a1814",
  muted: "#77726a",
  chip: "#eeebe4",
  line: "rgba(26, 24, 20, 0.22)",
  tile: "#1a1814",
  tileText: "#f6f4ef",
  primary: "#c2410c",
  onPrimary: "#fffaf5",
  white: "#fffefc",
} as const;

type Font = { name: string; data: ArrayBuffer; weight: 500 | 600; style: "normal" };

// Google Fonts answers a client that does not ask for woff2 with TTF files, the format ImageResponse reads.
const CSS_URL = "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@500;600";
let fonts: Promise<Font[]> | null = null;

async function fetchFonts(): Promise<Font[]> {
  const css = await (await fetch(CSS_URL, { signal: AbortSignal.timeout(4000) })).text();
  const faces = [...css.matchAll(/font-weight:\s*(\d+);[^}]*?src:\s*url\((https:[^)]+\.ttf)\)/g)];
  const loaded = await Promise.all(
    faces.map(async ([, weight, url]) => ({
      name: "Schibsted Grotesk",
      data: await (await fetch(url, { signal: AbortSignal.timeout(4000) })).arrayBuffer(),
      weight: Number(weight) === 600 ? (600 as const) : (500 as const),
      style: "normal" as const,
    })),
  );
  if (loaded.length === 0) throw new Error("no font faces");
  return loaded;
}

/** Schibsted Grotesk 500 and 600, fetched once per process; an empty list (ImageResponse's own font) when offline. */
export function cardFonts(): Promise<Font[]> {
  fonts ??= fetchFonts().catch(() => {
    fonts = null;
    return [];
  });
  return fonts;
}

/** The company logo as a data URL ImageResponse can draw (PNG, JPEG, SVG), or null: the tile then shows initials. */
export async function cardLogo(url: string | null): Promise<string | null> {
  if (!url?.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { accept: "image/png,image/jpeg,image/svg+xml" } });
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!response.ok || !["image/png", "image/jpeg", "image/svg+xml"].includes(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 400_000) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
