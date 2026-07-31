const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
]);

const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; PeonyyMusicBot/1.0)',
};

export const MAX_SONG_DURATION_SECONDS = 600;
export const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024;

export interface TrackInfo {
    trackName: string;
    thumbnailUrl?: string;
    authorName?: string;
    authorUrl?: string;
    providerName?: string;
    durationSeconds?: number;
}

export function normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    return `https://${trimmed}`;
}

export function extractYoutubeVideoId(url: string): string | null {
    const normalizedUrl = normalizeUrl(url);

    try {
        const parsed = new URL(normalizedUrl);
        const hostname = parsed.hostname.replace(/^www\./, '');

        if (hostname === 'youtu.be') {
            const videoId = parsed.pathname.slice(1).split('/')[0];
            return videoId || null;
        }

        if (hostname.endsWith('youtube.com')) {
            const videoId = parsed.searchParams.get('v');
            if (videoId) {
                return videoId;
            }

            const embedMatch = parsed.pathname.match(/\/(?:embed|shorts|live)\/([^/?]+)/);
            return embedMatch?.[1] ?? null;
        }
    } catch {
        return null;
    }

    return null;
}

export function isYoutubeUrl(url: string): boolean {
    try {
        const { hostname } = new URL(normalizeUrl(url));
        return YOUTUBE_HOSTS.has(hostname) || hostname.endsWith('.youtube.com');
    } catch {
        return false;
    }
}

export function formatDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function getYoutubeDurationSeconds(url: string): Promise<number | undefined> {
    try {
        const response = await fetch(normalizeUrl(url), { headers: FETCH_HEADERS });
        if (!response.ok) {
            return undefined;
        }

        const html = await response.text();
        const match = html.match(/"lengthSeconds":"(\d+)"/);
        return match ? Number.parseInt(match[1], 10) : undefined;
    } catch {
        return undefined;
    }
}

async function getYoutubeOembedInfo(url: string): Promise<Omit<TrackInfo, 'durationSeconds'> | null> {
    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizeUrl(url))}&format=json`;
        const response = await fetch(oembedUrl, { headers: FETCH_HEADERS });

        if (!response.ok) {
            return null;
        }

        const data = (await response.json()) as {
            title?: string;
            thumbnail_url?: string;
            author_name?: string;
            author_url?: string;
            provider_name?: string;
        };

        const trackName = data.title?.trim();
        if (!trackName) {
            return null;
        }

        return {
            trackName,
            thumbnailUrl: data.thumbnail_url,
            authorName: data.author_name,
            authorUrl: data.author_url,
            providerName: data.provider_name,
        };
    } catch {
        return null;
    }
}

export async function getYoutubeTrackInfo(url: string): Promise<TrackInfo | null> {
    const normalizedUrl = normalizeUrl(url);

    if (!isYoutubeUrl(normalizedUrl)) {
        return null;
    }

    const [oembedInfo, durationSeconds] = await Promise.all([
        getYoutubeOembedInfo(normalizedUrl),
        getYoutubeDurationSeconds(normalizedUrl),
    ]);

    if (!oembedInfo) {
        return null;
    }

    return {
        ...oembedInfo,
        durationSeconds,
    };
}

export async function resolveTrackInfo(url: string, fallback = 'Now Playing'): Promise<TrackInfo> {
    const info = await getYoutubeTrackInfo(url);
    return info ?? { trackName: fallback };
}

export async function resolveTrackName(url: string, fallback = 'Now Playing'): Promise<string> {
    const info = await resolveTrackInfo(url, fallback);
    return info.trackName;
}
