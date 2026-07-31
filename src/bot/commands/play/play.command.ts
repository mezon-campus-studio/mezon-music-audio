import { Injectable } from '@nestjs/common';
import { BotCommand, CommandContext, CommandRole } from '../command.interface';
import { MezonClientService } from '@/libs/mezon-client/mezon-client.service';
import { MiscService } from '@/modules/misc/misc.service';
import { VoicePlaybackService } from '@/modules/voice-playlist/voice-playback.service';
import { VoicePlaylistService } from '@/modules/voice-playlist/voice-playlist.service';
import {
    getErrorMessage,
    getInfoMessage,
    getSongEmbedMessage,
    getNowPlayingEmbedMessage,
    getEmptyPlaylistMessage,
    getNeedVoiceChannelMessage,
    resolvePlayVoiceChannel,
} from '@/utils';

@Injectable()
export class PlayCommand implements BotCommand {
    name = 'play';
    role: CommandRole = 'elevated';
    description = 'Phát playlist từ DB';

    constructor(
        private readonly mcService: MezonClientService,
        private readonly miscService: MiscService,
        private readonly voicePlaylistService: VoicePlaylistService,
        private readonly voicePlaybackService: VoicePlaybackService,
    ) {}

    async execute(ctx: CommandContext) {
        const { event, repliedMessage } = ctx;

        try {
            const userId = event.sender_id as string;
            const clanId = event.clan_id as string;
            const client = this.mcService.getClient();

            const { voiceChannel, error: voiceChannelError } = await resolvePlayVoiceChannel(
                client,
                clanId,
                userId,
                event.content,
            );

            if (voiceChannelError === 'not_voice') {
                await this.mcService.updateMessage(
                    repliedMessage,
                    getErrorMessage(
                        'Hashtag không phải kênh thoại',
                        'Hãy tag kênh thoại Mezon nha.',
                    ),
                );
                return;
            }

            if (!voiceChannel) {
                await this.mcService.updateMessage(repliedMessage, getNeedVoiceChannelMessage());
                return;
            }

            const firstSong = await this.voicePlaylistService.resolvePlayStartSong(clanId);

            if (!firstSong) {
                await this.mcService.updateMessage(repliedMessage, getEmptyPlaylistMessage());
                return;
            }

            if (await this.voicePlaylistService.isPlaying(clanId)) {
                const session = await this.voicePlaylistService.findSessionByClanId(clanId);
                const currentSong = session
                    ? await this.voicePlaylistService.getCurrentSong(session.voiceChannelId)
                    : undefined;

                if (currentSong && session) {
                    const nextSong = await this.voicePlaylistService.getNextUnplayedSong(
                        session.voiceChannelId,
                        currentSong.order,
                    );
                    const queueTotal = await this.voicePlaylistService.getUnplayedSongCount(clanId);

                    await this.mcService.updateMessage(
                        repliedMessage,
                        getNowPlayingEmbedMessage({
                            currentSong,
                            trackInfo: this.voicePlaylistService.songToTrackInfo(currentSong),
                            channelName: session.channelName,
                            nextTrackName: nextSong?.trackName,
                            queueTotal,
                        }),
                    );
                    return;
                }

                await this.mcService.updateMessage(
                    repliedMessage,
                    getInfoMessage('Bot đang phát nhạc rồi nè', 'Dùng `*dj now` để xem bài hiện tại nha.'),
                );
                return;
            }

            try {
                await this.voicePlaybackService.startPlayback(
                    clanId,
                    voiceChannel.channelId,
                    voiceChannel.channelName,
                    firstSong.order,
                );
            } catch (error) {
                console.error('❌ Lỗi khi phát nhạc:', error);
                await this.mcService.updateMessage(
                    repliedMessage,
                    getErrorMessage('Không thể phát nhạc', 'Hãy thử lại sau nha.'),
                );
                return;
            }

            const queueTotal = await this.voicePlaylistService.getUnplayedSongCount(clanId);

            await this.mcService.updateMessage(
                repliedMessage,
                getSongEmbedMessage({
                    trackInfo: this.voicePlaylistService.songToTrackInfo(firstSong),
                    description: [
                        '🎵 Đã bắt đầu phát nhạc',
                        '',
                        `✨ Kênh: ${voiceChannel.channelName}`,
                        `📋 Hàng đợi hiện có ${queueTotal} bài`,
                    ].join('\n'),
                    songUrl: firstSong.songUrl,
                    order: firstSong.order,
                    queueTotal,
                    requestedBy: firstSong.requestedBy,
                    channelName: voiceChannel.channelName,
                }),
            );
        } catch (error) {
            console.error('❌ Lỗi khi thực hiện lệnh `play`:', error);
            await this.miscService.handleCommandError(ctx, error);
        }
    }
}
