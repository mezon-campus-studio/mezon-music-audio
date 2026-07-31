import { Injectable } from '@nestjs/common';
import { BotCommand, CommandContext, CommandRole } from '../command.interface';
import { MezonClientService } from '@/libs/mezon-client/mezon-client.service';
import { MiscService } from '@/modules/misc/misc.service';
import { VoicePlaylistService } from '@/modules/voice-playlist/voice-playlist.service';
import { SongResolverService } from '@/modules/song-cache/song-resolver.service';
import { AiContentService } from '@/modules/ai/ai-content.service';
import { getSongEmbedMessage, getEmbedMessage, getRandomPastelHexColor, getYoutubeTrackInfo, extractFirstUrl, getErrorMessage } from '@/utils';

@Injectable()
export class RequestCommand implements BotCommand {
    name = 'req';
    role: CommandRole = 'public';
    description = 'Thêm bài hát vào playlist';

    constructor(
        private readonly mcService: MezonClientService,
        private readonly miscService: MiscService,
        private readonly voicePlaylistService: VoicePlaylistService,
        private readonly songResolverService: SongResolverService,
        private readonly aiContentService: AiContentService,
    ) {}

    async execute(ctx: CommandContext) {
        const { event, repliedMessage, args } = ctx;

        try {
            const songUrl = extractFirstUrl(event.content?.t as string) ?? args[0];

            if (!songUrl) {
                await this.mcService.updateMessage(
                    repliedMessage,
                    getErrorMessage(
                        'Chưa có link bài hát',
                        'Hãy gửi link YouTube. Ví dụ: `*dj req <link>`',
                    ),
                );
                return;
            }

            const clanId = event.clan_id as string;
            const requestedBy = (event.display_name || event.username || 'Unknown') as string;

            const trackInfo = await getYoutubeTrackInfo(songUrl);

            if (!trackInfo) {
                await this.mcService.updateMessage(
                    repliedMessage,
                    getErrorMessage(
                        'Không tìm thấy bài hát',
                        'Hãy kiểm tra lại link YouTube và thử lại nha.',
                    ),
                );
                return;
            }

            await this.songResolverService.validateBeforeResolve(songUrl, trackInfo);

            await this.mcService.updateMessage(
                repliedMessage,
                getEmbedMessage({
                    color: getRandomPastelHexColor(),
                    title: trackInfo.trackName,
                    description: '⏳ Đang thêm bài hát, vui lòng đợi...',
                    thumbnail: trackInfo.thumbnailUrl ? { url: trackInfo.thumbnailUrl } : undefined,
                    author: trackInfo.authorName
                        ? { name: trackInfo.authorName, url: trackInfo.authorUrl }
                        : undefined,
                }),
            );

            const resolved = await this.songResolverService.resolve(
                songUrl,
                {
                    onQueued: async (position) => {
                        await this.mcService.updateMessage(
                            repliedMessage,
                            getEmbedMessage({
                                color: getRandomPastelHexColor(),
                                title: trackInfo.trackName,
                                description: [
                                    '⏳ **Đang xếp hàng xử lý...**',
                                    '',
                                    '🚦 Hiện có **10** người đang thêm bài cùng lúc.',
                                    `📍 Bạn đang chờ — còn **${position}** người trước bạn.`,
                                ].join('\n'),
                                thumbnail: trackInfo.thumbnailUrl
                                    ? { url: trackInfo.thumbnailUrl }
                                    : undefined,
                                author: trackInfo.authorName
                                    ? { name: trackInfo.authorName, url: trackInfo.authorUrl }
                                    : undefined,
                            }),
                        );
                    },
                    onDownloading: async () => {
                        await this.mcService.updateMessage(
                            repliedMessage,
                            getEmbedMessage({
                                color: getRandomPastelHexColor(),
                                title: trackInfo.trackName,
                                description: '⏳ Đang thêm bài hát, vui lòng đợi...',
                                thumbnail: trackInfo.thumbnailUrl
                                    ? { url: trackInfo.thumbnailUrl }
                                    : undefined,
                                author: trackInfo.authorName
                                    ? { name: trackInfo.authorName, url: trackInfo.authorUrl }
                                    : undefined,
                            }),
                        );
                    },
                },
                { useConcurrencyLimit: true },
            );

            const song = await this.voicePlaylistService.addSong(
                clanId,
                resolved.cachedSongId,
                requestedBy,
            );
            const prevSong = await this.voicePlaylistService.getPreviousSongByClanId(clanId, song.order);
            const queueTotal = await this.voicePlaylistService.getUnplayedSongCount(clanId);

            const funReply = await this.aiContentService.generateSongRequestReply({
                trackName: resolved.trackInfo.trackName,
                authorName: resolved.trackInfo.authorName,
                requestedBy,
                queuePosition: song.order,
                queueTotal,
                prevTrackName: prevSong?.trackName,
            });

            const queueStatus =
                song.order === 1
                    ? '🚀 Sắp lên sóng — bài đầu tiên trong hàng đợi!'
                    : song.order === queueTotal
                      ? `⏳ Xếp cuối hàng — còn ${queueTotal - 1} bài trước bạn`
                      : `🎯 Còn ${song.order - 1} bài nữa là tới lượt`;

            await this.mcService.updateMessage(
                repliedMessage,
                getSongEmbedMessage({
                    trackInfo: resolved.trackInfo,
                    description: [
                        `🎉 **ĐÃ VÀO QUEUE!**`,
                        `💬 ${funReply}`,
                        '',
                        '───────────────',
                        queueStatus,
                        `📍 Vị trí **#${song.order}**  •  📋 **${queueTotal}** bài đang chờ`,
                        prevSong ? `🎵 Trước đó: *${prevSong.trackName}*` : undefined,
                    ]
                        .filter((line): line is string => line !== undefined)
                        .join('\n'),
                    songUrl: resolved.youtubeUrl,
                    order: song.order,
                    queueTotal,
                    prevTrackName: prevSong?.trackName ?? '—',
                    requestedBy,
                }),
            );
        } catch (error) {
            console.error('❌ Lỗi khi thực hiện lệnh `add`:', error);
            await this.miscService.handleCommandError(ctx, error);
        }
    }
}
