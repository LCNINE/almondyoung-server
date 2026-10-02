import { randomBytes } from 'crypto';

const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
const TRAILING_PUNCTUATION = /[.,!?)\]'"]+$/;
const BOT_USER_AGENT =
  /bot|crawl|spider|preview|scrap|facebookexternalhit|slack|whatsapp|telegram|discord|curl|wget|python|okhttp|go-http|axios|node-fetch|headless/i;

export const newLinkCode = (): string => randomBytes(6).toString('base64url');

export function trackLinks(
  body: string,
  baseUrl: string,
  newCode: () => string = newLinkCode,
): { body: string; links: { code: string; url: string }[] } {
  const links: { code: string; url: string }[] = [];
  const replaced = body.replace(URL_PATTERN, (match) => {
    const url = match.replace(TRAILING_PUNCTUATION, '');
    const code = newCode();
    links.push({ code, url });
    return `${baseUrl}/${code}${match.slice(url.length)}`;
  });
  return { body: replaced, links };
}

export const isBotUserAgent = (userAgent?: string): boolean => !userAgent || BOT_USER_AGENT.test(userAgent);
