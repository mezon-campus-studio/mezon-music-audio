import { ChannelMessageContent, ChannelType, EMarkdownType, MezonClient } from 'mezon-sdk';

export interface UserVoiceChannel {
    channelId: string;
    channelName: string;
}

const MEZON_CHANNEL_LINK_REGEX = /\/chat\/clans\/([^/\s?#]+)\/channels\/([^/\s?#]+)/;

function extractHashtagChannelIds(content: ChannelMessageContent): string[] {
    return (content.hg ?? [])
        .map((hashtag) => hashtag.channelId)
        .filter((channelId): channelId is string => !!channelId);
}

function extractVoiceLinkTexts(content: ChannelMessageContent): string[] {
    const text = content.t ?? '';
    const links: string[] = [];

    for (const voiceLink of content.vk ?? []) {
        if (voiceLink.s !== undefined && voiceLink.e !== undefined) {
            links.push(text.slice(voiceLink.s, voiceLink.e));
        }
    }

    for (const markdown of content.mk ?? []) {
        if (markdown.type === EMarkdownType.VOICE_LINK && markdown.s !== undefined && markdown.e !== undefined) {
            links.push(text.slice(markdown.s, markdown.e));
        }
    }

    return links;
}

function extractChannelIdFromMezonLink(link: string): string | null {
    const match = link.match(MEZON_CHANNEL_LINK_REGEX);
    return match?.[2] ?? null;
}

async function getVoiceChannelById(
    client: MezonClient,
    channelId: string,
): Promise<UserVoiceChannel | 'not_voice'> {
    const channel = await client.channels.fetch(channelId);
    if (channel.channel_type !== ChannelType.CHANNEL_TYPE_MEZON_VOICE) {
        return 'not_voice';
    }

    return {
        channelId,
        channelName: channel.name || channelId,
    };
}

export async function resolvePlayVoiceChannel(
    client: MezonClient,
    clanId: string,
    userId: string,
    content: ChannelMessageContent | undefined,
): Promise<{ voiceChannel: UserVoiceChannel | null; error?: 'not_voice' }> {
    if (content) {
        const hashtagChannelIds = extractHashtagChannelIds(content);
        const linkChannelIds = extractVoiceLinkTexts(content)
            .map(extractChannelIdFromMezonLink)
            .filter((channelId): channelId is string => !!channelId);
        const channelIds = [...hashtagChannelIds, ...linkChannelIds];

        if (channelIds.length > 0) {
            for (const channelId of channelIds) {
                const result = await getVoiceChannelById(client, channelId);
                if (result === 'not_voice') {
                    return { voiceChannel: null, error: 'not_voice' };
                }

                return { voiceChannel: result };
            }
        }
    }

    return {
        voiceChannel: await getUserVoiceChannel(client, clanId, userId),
    };
}

export async function getUserVoiceChannel(
    client: MezonClient,
    clanId: string,
    userId: string,
): Promise<UserVoiceChannel | null> {
    const clan = client.clans.get(clanId);
    if (!clan) {
        return null;
    }

    const voiceUsers = await clan.listChannelVoiceUsers();
    const userVoice = voiceUsers.voice_channel_users?.find((vcu) =>
        vcu.user_ids?.includes(userId),
    );

    if (!userVoice?.channel_id) {
        return null;
    }

    const voiceChannel = await client.channels.fetch(userVoice.channel_id);
    if (voiceChannel.channel_type !== ChannelType.CHANNEL_TYPE_MEZON_VOICE) {
        return null;
    }

    return {
        channelId: userVoice.channel_id,
        channelName: voiceChannel.name || userVoice.channel_id,
    };
}
