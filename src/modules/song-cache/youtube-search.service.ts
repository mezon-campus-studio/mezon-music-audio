import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getYoutubeTrackInfo } from '@/utils/youtube.util';
import { buildYtdlpCliArgs } from '@/utils/ytdlp.util';

const execFileAsync = promisify(execFile);
const YT_DLP_BIN = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const DEFAULT_YT_DLP_PATH = join(process.cwd(), 'node_modules/youtube-dl-exec/bin', YT_DLP_BIN);
const MAX_SONG_DURATION_SECONDS = 900;

export interface YoutubeSearchHit {
    videoId: string;
    url: string;
    title: string;
    artist: string;
    durationSeconds?: number;
}

interface YtdlpSearchEntry {
    id?: string;
    url?: string;
    webpage_url?: string;
    title?: string;
    duration?: number;
    channel?: string;
    uploader?: string;
}

@Injectable()
export class YoutubeSearchService implements OnModuleInit {
    private readonly logger = new Logger(YoutubeSearchService.name);
    private ytDlpPath = DEFAULT_YT_DLP_PATH;

    constructor(private readonly configService: ConfigService) {}

    async onModuleInit() {
        this.ytDlpPath = await this.resolveYtdlpPath();
    }

    async searchSong(query: string): Promise<YoutubeSearchHit | null> {
        const hits = await this.searchSongs(query, 1);
        return hits[0] ?? null;
    }

    async searchSongs(query: string, limit = 3): Promise<YoutubeSearchHit[]> {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            return [];
        }

        try {
            const { stdout } = await execFileAsync(
                this.ytDlpPath,
                [
                    ...buildYtdlpCliArgs(this.configService),
                    `ytsearch${limit}:${trimmedQuery}`,
                    '--flat-playlist',
                    '-j',
                    '--no-warnings',
                ],
                { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
            );

            const entries = stdout
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line) as YtdlpSearchEntry);

            const hits: YoutubeSearchHit[] = [];

            for (const entry of entries) {
                const hit = await this.toSearchHit(entry);
                if (hit) {
                    hits.push(hit);
                }
            }

            return hits;
        } catch (error) {
            this.logger.warn(`YouTube search failed for "${trimmedQuery}"`, error);
            return [];
        }
    }

    private async toSearchHit(entry: YtdlpSearchEntry): Promise<YoutubeSearchHit | null> {
        const videoId = entry.id?.trim();
        const url = entry.webpage_url ?? entry.url;
        if (!videoId || !url) {
            return null;
        }

        if (this.isLikelyPlaylist(entry)) {
            return null;
        }

        const trackInfo = await getYoutubeTrackInfo(url);
        if (!trackInfo) {
            return null;
        }

        if (
            trackInfo.durationSeconds &&
            trackInfo.durationSeconds > MAX_SONG_DURATION_SECONDS
        ) {
            return null;
        }

        return {
            videoId,
            url,
            title: cleanTrackTitle(trackInfo.trackName),
            artist: cleanArtistName(trackInfo.authorName ?? entry.channel ?? entry.uploader ?? 'Unknown'),
            durationSeconds: trackInfo.durationSeconds,
        };
    }

    private isLikelyPlaylist(entry: YtdlpSearchEntry): boolean {
        const title = (entry.title ?? '').toLowerCase();
        const playlistKeywords = ['playlist', 'full album', 'mix', 'nonstop', 'continuous', 'marathon'];
        const hasPlaylistKeyword = playlistKeywords.some((keyword) => title.includes(keyword));

        return hasPlaylistKeyword || (entry.duration ?? 0) > MAX_SONG_DURATION_SECONDS;
    }

    private async resolveYtdlpPath(): Promise<string> {
        const customPath = this.configService.get<string>('YT_DLP_PATH');
        const candidates = [customPath, DEFAULT_YT_DLP_PATH, YT_DLP_BIN].filter(
            (path): path is string => Boolean(path),
        );

        for (const candidate of candidates) {
            try {
                await access(candidate);
                return candidate;
            } catch {
                continue;
            }
        }

        throw new Error(
            'yt-dlp binary not found. Run `yarn postinstall` or install yt-dlp system-wide.',
        );
    }
}

function cleanTrackTitle(title: string): string {
    const firstSegment = title.split('|')[0]?.trim() ?? title;

    return firstSegment
        .replace(/\s*[\(\[]?(official\s*)?(music\s*)?(video|audio|mv|lyric(s| video)?)[\)\]]?\s*$/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function cleanArtistName(name: string): string {
    return name
        .replace(/\s*(official|vevo|topic|records?)$/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
