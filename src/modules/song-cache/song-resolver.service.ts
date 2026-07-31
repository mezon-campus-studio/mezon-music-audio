import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
    extractYoutubeVideoId,
    formatDuration,
    getYoutubeTrackInfo,
    isYoutubeUrl,
    MAX_AUDIO_SIZE_BYTES,
    MAX_SONG_DURATION_SECONDS,
    normalizeUrl,
    TrackInfo,
} from '@/utils/youtube.util';
import { AudioProcessingService } from './audio-processing.service';
import { CloudinaryStorageService } from './cloudinary-storage.service';
import { SongCacheService } from './song-cache.service';

export interface ResolvedSong {
    cachedSongId: string;
    trackInfo: TrackInfo;
    youtubeUrl: string;
    youtubeVideoId: string;
    playableUrl: string;
    fromCache: boolean;
}

export interface ResolveHooks {
    onFetching?: () => Promise<void>;
    onQueued?: (position: number) => Promise<void>;
    onDownloading?: (trackName: string) => Promise<void>;
    onConverting?: (trackName: string) => Promise<void>;
    onUploading?: (trackName: string) => Promise<void>;
}

export interface ResolveOptions {
    useConcurrencyLimit?: boolean;
}

const MAX_CONCURRENT_RESOLVES = 10;

@Injectable()
export class SongResolverService {
    private readonly logger = new Logger(SongResolverService.name);
    private readonly resolveLocks = new Map<string, Promise<ResolvedSong>>();
    private activeResolveCount = 0;
    private readonly resolveWaitQueue: Array<{ grant: () => void }> = [];

    constructor(
        private readonly songCacheService: SongCacheService,
        private readonly audioProcessingService: AudioProcessingService,
        private readonly cloudinaryStorageService: CloudinaryStorageService,
    ) {}

    async validateBeforeResolve(youtubeUrl: string, trackInfo: TrackInfo): Promise<void> {
        const normalizedUrl = normalizeUrl(youtubeUrl);
        const youtubeVideoId = extractYoutubeVideoId(normalizedUrl);
        if (!youtubeVideoId) {
            return;
        }

        const cachedByVideoId = await this.songCacheService.findByYoutubeVideoId(youtubeVideoId);
        if (cachedByVideoId?.oggUrl) {
            return;
        }

        const cachedByTitle = await this.songCacheService.findByTitle(trackInfo.trackName);
        if (cachedByTitle?.oggUrl) {
            return;
        }

        const metadata = await this.audioProcessingService.getYoutubeAudioMetadata(youtubeVideoId);
        const durationSeconds = trackInfo.durationSeconds ?? metadata.durationSeconds;

        if (durationSeconds && durationSeconds > MAX_SONG_DURATION_SECONDS) {
            throw new BadRequestException(
                `❌ Bài hát quá dài (${formatDuration(durationSeconds)})\n\n💡 Chỉ hỗ trợ bài tối đa **10 phút** nha.`,
            );
        }

        if (metadata.fileSizeBytes && metadata.fileSizeBytes > MAX_AUDIO_SIZE_BYTES) {
            const sizeMb = (metadata.fileSizeBytes / (1024 * 1024)).toFixed(1);
            throw new BadRequestException(
                `❌ File audio quá lớn (~${sizeMb} MB)\n\n💡 Chỉ hỗ trợ file tối đa **10 MB** nha.`,
            );
        }
    }

    async resolve(
        youtubeUrl: string,
        hooks?: ResolveHooks,
        options?: ResolveOptions,
    ): Promise<ResolvedSong> {
        const normalizedUrl = normalizeUrl(youtubeUrl);

        if (!isYoutubeUrl(normalizedUrl)) {
            throw new BadRequestException(
                '❌ Chỉ hỗ trợ link YouTube\n\n💡 Hãy gửi link YouTube hợp lệ nha.',
            );
        }

        const youtubeVideoId = extractYoutubeVideoId(normalizedUrl);
        if (!youtubeVideoId) {
            throw new BadRequestException(
                '❌ Không đọc được link YouTube\n\n💡 Hãy kiểm tra lại link và thử lại nha.',
            );
        }

        const existingLock = this.resolveLocks.get(youtubeVideoId);
        if (existingLock) {
            return existingLock;
        }

        const resolvePromise = this.resolveInternal(normalizedUrl, youtubeVideoId, hooks, options);
        this.resolveLocks.set(youtubeVideoId, resolvePromise);

        try {
            return await resolvePromise;
        } finally {
            this.resolveLocks.delete(youtubeVideoId);
        }
    }

    private async acquireResolveSlot(
        onQueued?: (position: number) => Promise<void>,
    ): Promise<() => void> {
        if (this.activeResolveCount < MAX_CONCURRENT_RESOLVES) {
            this.activeResolveCount++;
            return () => this.releaseResolveSlot();
        }

        return new Promise((resolve) => {
            const position = this.resolveWaitQueue.length + 1;
            this.resolveWaitQueue.push({
                grant: () => {
                    resolve(() => this.releaseResolveSlot());
                },
            });
            void onQueued?.(position);
        });
    }

    private releaseResolveSlot() {
        const next = this.resolveWaitQueue.shift();
        if (next) {
            next.grant();
            return;
        }

        this.activeResolveCount = Math.max(0, this.activeResolveCount - 1);
    }

    private async resolveInternal(
        youtubeUrl: string,
        youtubeVideoId: string,
        hooks?: ResolveHooks,
        options?: ResolveOptions,
    ): Promise<ResolvedSong> {
        await hooks?.onFetching?.();

        const trackInfo = await getYoutubeTrackInfo(youtubeUrl);
        if (!trackInfo) {
            throw new BadRequestException(
                '❌ Không tìm thấy bài hát\n\n💡 Hãy thử nhập tên khác hoặc gửi link YouTube.',
            );
        }

        const cachedByVideoId = await this.songCacheService.findByYoutubeVideoId(youtubeVideoId);
        if (cachedByVideoId?.oggUrl) {
            this.logger.log(`Cache hit by video ID: ${youtubeVideoId}`);
            return this.toResolvedSong(cachedByVideoId, trackInfo, youtubeUrl, true);
        }

        const cachedByTitle = await this.songCacheService.findByTitle(trackInfo.trackName);
        if (cachedByTitle?.oggUrl) {
            this.logger.log(`Cache hit by title: ${trackInfo.trackName}`);
            return this.toResolvedSong(cachedByTitle, trackInfo, youtubeUrl, true);
        }

        const releaseResolveSlot = options?.useConcurrencyLimit
            ? await this.acquireResolveSlot(hooks?.onQueued)
            : undefined;

        try {
            await hooks?.onDownloading?.(trackInfo.trackName);

            const processedAudio = await this.audioProcessingService.downloadAndConvertToOgg(
                youtubeUrl,
                youtubeVideoId,
                async () => {
                    await hooks?.onConverting?.(trackInfo.trackName);
                },
            );

            const resolvedTrackInfo: TrackInfo = {
                ...trackInfo,
                durationSeconds: processedAudio.durationSeconds ?? trackInfo.durationSeconds,
            };
            const filename = `${youtubeVideoId}.ogg`;

            await hooks?.onUploading?.(trackInfo.trackName);

            const uploaded = await this.cloudinaryStorageService.uploadOgg(
                processedAudio.oggPath,
                filename,
            );

            const cachedSong = await this.songCacheService.upsert({
                id: `song-${youtubeVideoId}`,
                title: resolvedTrackInfo.trackName,
                youtubeUrl,
                youtubeVideoId,
                oggUrl: uploaded.url,
                trackInfo: resolvedTrackInfo,
            });

            this.logger.log(
                `Cached new song → title="${trackInfo.trackName}", oggUrl=${cachedSong.oggUrl}`,
            );

            return {
                cachedSongId: cachedSong.id,
                trackInfo: resolvedTrackInfo,
                youtubeUrl,
                youtubeVideoId,
                playableUrl: cachedSong.oggUrl,
                fromCache: false,
            };
        } finally {
            releaseResolveSlot?.();
            await this.audioProcessingService.cleanup(youtubeVideoId);
        }
    }

    private toResolvedSong(
        cachedSong: {
            id: string;
            oggUrl: string;
            title: string;
            thumbnailUrl?: string | null;
            authorName?: string | null;
            authorUrl?: string | null;
            providerName?: string | null;
            durationSeconds?: number | null;
        },
        fetchedTrackInfo: TrackInfo,
        youtubeUrl: string,
        fromCache: boolean,
    ): ResolvedSong {
        const trackInfo: TrackInfo = {
            trackName: cachedSong.title,
            thumbnailUrl: cachedSong.thumbnailUrl ?? fetchedTrackInfo.thumbnailUrl,
            authorName: cachedSong.authorName ?? fetchedTrackInfo.authorName,
            authorUrl: cachedSong.authorUrl ?? fetchedTrackInfo.authorUrl,
            providerName: cachedSong.providerName ?? fetchedTrackInfo.providerName,
            durationSeconds: cachedSong.durationSeconds ?? fetchedTrackInfo.durationSeconds,
        };

        return {
            cachedSongId: cachedSong.id,
            trackInfo,
            youtubeUrl,
            youtubeVideoId: extractYoutubeVideoId(youtubeUrl) ?? '',
            playableUrl: cachedSong.oggUrl,
            fromCache,
        };
    }
}
