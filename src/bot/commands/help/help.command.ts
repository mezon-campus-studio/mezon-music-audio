import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { BotCommand, CommandContext, CommandRole } from '../command.interface';
import { CommandService } from '../command.service';
import { MezonClientService } from '@/libs/mezon-client/mezon-client.service';
import { PrismaService } from '@/libs/prisma/prisma.service';
import { MiscService } from '@/modules/misc/misc.service';
import { getEmbedMessage } from '@/utils';

@Injectable()
export class HelpCommand implements BotCommand {
    name = 'help';
    role: CommandRole = 'public';
    description = 'Hiển thị bảng hướng dẫn này';

    constructor(
        private readonly mcService: MezonClientService,
        private readonly prismaService: PrismaService,
        @Inject(forwardRef(() => CommandService))
        private readonly commandService: CommandService,
        private readonly miscService: MiscService,
    ) {}

    async execute(ctx: CommandContext) {
        const { event, repliedMessage } = ctx;

        try {
            const clanId = event.clan_id as string;
            const senderId = event.sender_id as string;

            let isElevated = false;
            const clan = await this.prismaService.clan.findUnique({
                where: { id: clanId },
            });

            if (clan) {
                const isOwner = clan.ownerId === senderId;
                const isMod = clan.moderatorIds.includes(senderId);
                isElevated = isOwner || isMod;
            }

            const allCommands = this.commandService.getCommands();
            const lines: string[] = [];

            for (const cmd of allCommands) {
                if (cmd.role !== 'public' && !isElevated) continue;
                lines.push(`*dj ${cmd.name} - ${cmd.description}`);
            }

            lines.push('*dj <mô tả vibe/mood> - Gợi ý bài hát bằng AI');

            const embed = getEmbedMessage({
                color: '#f6a6c1',
                title: `ℹ️ ${process.env.MEZON_BOT_NAME} - Danh sách lệnh`,
                description: `✨ Danh sách các lệnh hiện có của ${process.env.MEZON_BOT_NAME}`,
                fields: [{ name: '📋 Danh sách lệnh', value: lines.join('\n'), inline: false }],
                footer: {
                    text: '💡 Dùng *dj help để xem hướng dẫn bất cứ lúc nào nha.',
                },
            });

            if (isElevated) {
                await repliedMessage.delete();
                const channelId = event.channel_id as string;
                await this.mcService.sendEphemeralMessage(channelId, senderId, embed);
            } else {
                await this.mcService.updateMessage(repliedMessage, embed);
            }
        } catch (error) {
            console.error('❌ Lỗi khi thực hiện lệnh `help`:', error);
            await this.miscService.handleCommandError(ctx, error);
        }
    }
}
