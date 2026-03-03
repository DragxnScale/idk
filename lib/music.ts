export interface MusicTrack {
  url: string;
  title: string;
}

const PLAYLIST_KEY = "bowlbeacon-music-playlist";
const OLD_URL_KEY = "bowlbeacon-music-url";

export function loadPlaylist(): MusicTrack[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PLAYLIST_KEY);
    if (raw) return JSON.parse(raw) as MusicTrack[];
  } catch {}

  // Migrate old single-URL key
  const old = localStorage.getItem(OLD_URL_KEY);
  if (old) {
    const track: MusicTrack = { url: old, title: titleFromUrl(old) };
    savePlaylist([track]);
    localStorage.removeItem(OLD_URL_KEY);
    return [track];
  }
  return [];
}

export function savePlaylist(tracks: MusicTrack[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLAYLIST_KEY, JSON.stringify(tracks));
}

export function parseYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/
  );
  return m ? m[1] : null;
}

export function isYouTubeUrl(url: string): boolean {
  return parseYouTubeId(url) !== null;
}

function titleFromUrl(url: string): string {
  const id = parseYouTubeId(url);
  if (id) return `YouTube – ${id}`;
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

/** Fetch the real YouTube video title via oEmbed. Returns null if it fails. */
export async function resolveYouTubeTitle(url: string): Promise<string | null> {
  const id = parseYouTubeId(url);
  if (!id) return null;
  try {
    const canonical = `https://www.youtube.com/watch?v=${id}`;
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.title ?? null;
  } catch {
    return null;
  }
}

/** Returns true if the title looks like a raw URL or placeholder (not a real title). */
export function isTitlePlaceholder(title: string): boolean {
  return (
    title.startsWith("http://") ||
    title.startsWith("https://") ||
    title.startsWith("YouTube – ")
  );
}
