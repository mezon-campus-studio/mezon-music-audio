import { ConfigService } from '@nestjs/config';
import type { Flags } from 'youtube-dl-exec';

type YtdlpFlags = Partial<Flags> & {
    extractorArgs?: string;
};

const DEFAULT_EXTRACTOR_ARGS = 'youtube:player_client=android,web';
const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function getYtdlpExecFlags(configService: ConfigService): YtdlpFlags {
    const cookiesPath = configService.get<string>('YT_DLP_COOKIES_PATH')?.trim();
    const defaultExtractorArgs = cookiesPath
        ? 'youtube:player_client=web'
        : DEFAULT_EXTRACTOR_ARGS;

    const flags: YtdlpFlags = {
        jsRuntimes: 'node',
        extractorArgs:
            configService.get<string>('YT_DLP_EXTRACTOR_ARGS') ?? defaultExtractorArgs,
        addHeader: [`User-Agent:${DEFAULT_USER_AGENT}`],
    };

    if (cookiesPath) {
        flags.cookies = cookiesPath;
    }

    return flags;
}

export function buildYtdlpCliArgs(configService: ConfigService): string[] {
    const flags = getYtdlpExecFlags(configService);
    const args: string[] = [];

    if (flags.jsRuntimes) {
        args.push('--js-runtimes', String(flags.jsRuntimes));
    }

    if (flags.extractorArgs) {
        args.push('--extractor-args', flags.extractorArgs);
    }

    for (const header of flags.addHeader ?? []) {
        args.push('--add-header', header);
    }

    if (flags.cookies) {
        args.push('--cookies', flags.cookies);
    }

    return args;
}

export function toYoutubeWatchUrl(videoId: string): string {
    return `https://www.youtube.com/watch?v=${videoId}`;
}
