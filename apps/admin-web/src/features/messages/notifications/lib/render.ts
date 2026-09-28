import type { ChannelBody, NotificationChannel, TemplateContents } from '@/lib/api/domains/notification';

const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

type Slot = [outer: string, inner: string];

function readSlot(contents: TemplateContents | undefined, channel: NotificationChannel): Slot | null {
  const langKey = contents?.ko ? 'ko' : contents?.en ? 'en' : null;
  if (langKey && contents?.[langKey]?.[channel]) return [langKey, channel];
  const legacy = contents?.[channel];
  if (legacy?.ko) return [channel, 'ko'];
  if (legacy?.en) return [channel, 'en'];
  return null;
}

export function channelBody(contents: TemplateContents | undefined, channel: NotificationChannel): ChannelBody | null {
  const slot = readSlot(contents, channel);
  return slot ? (contents?.[slot[0]]?.[slot[1]] ?? null) : null;
}

export function withChannelBody(
  contents: TemplateContents | undefined,
  channel: NotificationChannel,
  body: ChannelBody
): TemplateContents {
  const [outer, inner] = readSlot(contents, channel) ?? [channel, 'ko'];
  const block = contents?.[outer];
  return { ...contents, [outer]: { ...block, [inner]: { ...block?.[inner], ...body } } };
}

export function variableNames(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE_RE)].map((m) => m[1]))];
}

export function unknownVariables(text: string, known: string[]): string[] {
  return variableNames(text).filter((name) => !known.includes(name) && !known.includes(name.split('.')[0]));
}

export function fillSample(text: string): string {
  return text.replace(VARIABLE_RE, (_, key: string) => `[${key}]`);
}
