/**
 * Storyblok focal point ("focus") lookup.
 *
 * The Content API only returns asset filenames, so the focal point is read
 * from the Management API and cached for the whole build. Without
 * STORYBLOK_PERSONAL_TOKEN / STORYBLOK_SPACE_ID this silently disables the
 * feature (images keep the previous centred crop).
 *
 * `focus` looks like "481x379:482x380": the focal rectangle in original
 * pixels. We return its centre as a percentage of the image dimensions,
 * ready for `object-position`.
 */
const TOKEN = import.meta.env.STORYBLOK_PERSONAL_TOKEN;
const SPACE = import.meta.env.STORYBLOK_SPACE_ID;

export interface AssetFocus {
  x: number;
  y: number;
}

const normalized = (url: string) =>
  url.replace(/^https?:/, "").replace(/^\/\//, "");

const dimsOf = (url: string): { w: number; h: number } | null => {
  const m = /\/f\/\d+\/(\d+)x(\d+)\//.exec(url);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
};

const parseFocus = (focus: unknown, url: string): AssetFocus | null => {
  if (typeof focus !== "string") return null;
  const m = /^(\d+)x(\d+):(\d+)x(\d+)$/.exec(focus.trim());
  const dims = dimsOf(url);
  if (!m || !dims) return null;
  const cx = (Number(m[1]) + Number(m[3])) / 2;
  const cy = (Number(m[2]) + Number(m[4])) / 2;
  const x = Math.min(100, Math.max(0, (cx / dims.w) * 100));
  const y = Math.min(100, Math.max(0, (cy / dims.h) * 100));
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
};

let cache: Promise<Map<string, AssetFocus>> | null = null;

async function loadFocusMap(): Promise<Map<string, AssetFocus>> {
  const map = new Map<string, AssetFocus>();
  if (!TOKEN || !SPACE) return map;

  for (let page = 1; page < 20; page += 1) {
    let data: { assets?: Record<string, any>[] };
    try {
      const res = await fetch(
        `https://mapi.storyblok.com/v1/spaces/${SPACE}/assets?per_page=100&page=${page}`,
        { headers: { Authorization: TOKEN } },
      );
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break;
    }
    const assets = data.assets ?? [];
    for (const a of assets) {
      if (typeof a.filename !== "string" || !a.focus) continue;
      const focus = parseFocus(a.focus, a.filename);
      if (focus) map.set(normalized(a.filename), focus);
    }
    if (assets.length < 100) break;
  }
  return map;
}

export function getAssetFocus(
  filename: string | undefined | null,
): Promise<AssetFocus | null> {
  if (!filename || !filename.includes("storyblok.com")) return Promise.resolve(null);
  cache ??= loadFocusMap();
  return cache.then((map) => map.get(normalized(filename)) ?? null);
}
