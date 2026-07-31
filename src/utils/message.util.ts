import { ChannelMessageContent, IInteractiveMessageProps } from 'mezon-sdk';
import { DJ_DANCE_URL, LOADING_EMOJI_ID, MUSIC_WAVE_URL } from '@/constants';
import { getRandomDjDanceUrl, getRandomPastelHexColor } from '@/utils/misc.util';
import { formatDuration, TrackInfo } from '@/utils/youtube.util';
import { PlaylistSong } from '@/modules/voice-playlist/voice-playlist.service';

export const getTextMessage = (text: string): ChannelMessageContent => {
    return {
        t: text,
    };
};

export const getEmbedMessage = (embed: IInteractiveMessageProps): ChannelMessageContent => {
    return {
        embed: [embed],
    };
};

export const getErrorMessage = (error: string, hint: string): ChannelMessageContent => {
    return getTextMessage(`❌ ${error}\n\n💡 ${hint}`);
};

export const getWarningMessage = (warning: string, hint?: string): ChannelMessageContent => {
    const text = hint ? `⚠️ ${warning}\n\n💡 ${hint}` : `⚠️ ${warning}`;
    return getTextMessage(text);
};

export const getInfoMessage = (info: string, detail?: string): ChannelMessageContent => {
    const text = detail ? `ℹ️ ${info}\n\n✨ ${detail}` : `ℹ️ ${info}`;
    return getTextMessage(text);
};

export const getSuccessMessage = (action: string, detail?: string): ChannelMessageContent => {
    const text = detail ? `✅ ${action}\n\n✨ ${detail}` : `✅ ${action}`;
    return getTextMessage(text);
};

export const getEmptyPlaylistMessage = (): ChannelMessageContent => {
    return getInfoMessage('Playlist đang trống', 'Dùng `*dj req <link>` để thêm bài hát nha.');
};

export const getNotPlayingMessage = (): ChannelMessageContent => {
    return getInfoMessage('Bot chưa phát nhạc', 'Dùng `*dj play` để bắt đầu phát nha.');
};

export const getNeedVoiceChannelMessage = (): ChannelMessageContent => {
    return getErrorMessage(
        'Bạn cần tham gia kênh thoại trước nha',
        'Hãy vào kênh thoại rồi thử lại.',
    );
};

const buildTrackFields = (params: {
    trackInfo: TrackInfo;
    order: number;
    queueTotal?: number;
    prevTrackName?: string;
    requestedBy?: string;
    channelName?: string;
}) => {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

    fields.push({
        name: 'Vị trí',
        value: `#${params.order}`,
        inline: true,
    });

    if (params.queueTotal !== undefined) {
        fields.push({
            name: 'Hàng đợi',
            value: `${params.queueTotal} bài`,
            inline: true,
        });
    }

    if (params.trackInfo.durationSeconds) {
        fields.push({
            name: 'Thời lượng',
            value: formatDuration(params.trackInfo.durationSeconds),
            inline: true,
        });
    }

    if (params.channelName) {
        fields.push({
            name: 'Kênh thoại',
            value: params.channelName,
            inline: true,
        });
    }

    if (params.trackInfo.providerName) {
        fields.push({
            name: 'Nền tảng',
            value: params.trackInfo.providerName,
            inline: true,
        });
    }

    if (params.prevTrackName !== undefined) {
        fields.push({
            name: 'Trước đó',
            value: params.prevTrackName || '—',
            inline: false,
        });
    }

    if (params.requestedBy) {
        fields.push({
            name: 'Yêu cầu bởi',
            value: params.requestedBy,
            inline: true,
        });
    }

    return fields;
};

export const getSongEmbedMessage = (params: {
    trackInfo: TrackInfo;
    description: string;
    songUrl: string;
    order: number;
    queueTotal?: number;
    prevTrackName?: string;
    requestedBy?: string;
    channelName?: string;
}): ChannelMessageContent => {
    const { trackInfo, description, songUrl, order, queueTotal, prevTrackName, requestedBy, channelName } =
        params;
    const fields = buildTrackFields({
        trackInfo,
        order,
        queueTotal,
        prevTrackName,
        requestedBy,
        channelName,
    });

    return getEmbedMessage({
        color: getRandomPastelHexColor() as string,
        title: trackInfo.trackName,
        description,
        url: songUrl,
        author: trackInfo.authorName
            ? {
                  name: trackInfo.authorName,
                  url: trackInfo.authorUrl,
              }
            : undefined,
        thumbnail: trackInfo.thumbnailUrl ? { url: trackInfo.thumbnailUrl } : undefined,
        fields: fields.length > 0 ? fields : undefined,
    });
};

export const getNowPlayingEmbedMessage = (params: {
    currentSong: PlaylistSong;
    trackInfo: TrackInfo;
    channelName: string;
    nextTrackName?: string;
    queueTotal: number;
}): ChannelMessageContent => {
    const { currentSong, trackInfo, channelName, nextTrackName, queueTotal } = params;
    const duration = trackInfo.durationSeconds
        ? formatDuration(trackInfo.durationSeconds)
        : '—';

    const description = [
        trackInfo.authorName ? `👤 ${trackInfo.authorName}` : undefined,
        `⏱️ Thời lượng: ${duration}`,
        `📻 Kênh phát: ${channelName}`,
        `📋 Vị trí: #${currentSong.order} / ${queueTotal}`,
        '',
        '▶️ Tiếp theo:',
        nextTrackName ? `🎵 ${nextTrackName}` : '—',
    ]
        .filter((line) => line !== undefined)
        .join('\n');

    const djURL = getRandomDjDanceUrl(DJ_DANCE_URL);     
    
    return getEmbedMessage({
        color: getRandomPastelHexColor() as string,
        title: `🎵 ${trackInfo.trackName}`,
        description,
        url: currentSong.songUrl,
        author: {
            name: "Đang phát",
            icon_url: MUSIC_WAVE_URL,
        },
        thumbnail: { url: djURL },
        image: {
            url: djURL,
        },
    });
};

export const getQueueEmbedMessage = (params: {
    songs: Array<{ order: number; trackName: string; isPlayed?: boolean }>;
    total: number;
    unplayedTotal?: number;
    limit: number;
}): ChannelMessageContent => {
    const { songs, total, unplayedTotal, limit } = params;
    const songLines = songs.map((song, index) => {
        const status = song.isPlayed ? '✅' : '⏳';
        return `${status} #${index + 1} ${song.trackName}`;
    });

    const summary =
        unplayedTotal !== undefined
            ? `✨ Tổng cộng: ${total} bài (${unplayedTotal} chưa phát)`
            : `✨ Tổng cộng: ${total} bài`;

    const description = [...songLines, '', summary].join('\n');

    return getEmbedMessage({
        color: getRandomPastelHexColor() as string,
        title: '📋 Hàng đợi',
        description,
        footer:
            total > limit
                ? {
                      text: `📌 Chỉ hiển thị ${limit}/${total} bài đầu tiên`,
                  }
                : undefined,
    });
};

export const getLoadingMessage = (): ChannelMessageContent => {
    return {
        t: '    Chờ xíu nha... 🌸',
        ej: [
            {
                emojiid: LOADING_EMOJI_ID as string,
                s: 0,
                e: 1,
            },
        ],
    };
};

export const getEmbedLoadingMessage = (action: string): ChannelMessageContent => {
    return {
        embed: [
            {
                color: getRandomPastelHexColor() as string,
                title: `⚡ ${action}...`,
                description: '🌸 Chờ xíu nha...',
            },
        ],
    };
};

export const getInteralErrorMessage = (): ChannelMessageContent => {
    return getErrorMessage(
        'Đã có lỗi xảy ra!',
        'Vui lòng thử lại sau hoặc liên hệ admin (thang.thieuquang) nha.',
    );
};

export const getSongSuggestionEmbedMessage = (params: {
    query: string;
    intro: string;
    suggestions: Array<{ title: string; artist: string; reason?: string; url?: string }>;
}): ChannelMessageContent => {
    const songLines = params.suggestions.flatMap((song, index) => {
        const lines = [`**${index + 1}.** ${song.title} - ${song.artist}`];
        if (song.url) {
            lines.push(song.url);
        }
        return [...lines, ''];
    });

    return getEmbedMessage({
        color: getRandomPastelHexColor() as string,
        title: '🎵 Gợi ý bài hát',
        description: [
            `💬 ${params.intro}`,
            '',
            `🔍 *"${params.query}"*`,
            '',
            ...songLines,
            '💡 Gửi `*dj req <link>` để thêm vào queue nha~',
        ].join('\n'),
    });
};
