// "Open Gmail" on the code step: a shortcut to the inbox for the common providers. Erasable TypeScript only.

export type MailProvider = { name: string; url: string };

const PROVIDERS: { match: RegExp; provider: MailProvider }[] = [
  { match: /^(gmail|googlemail)\.com$/, provider: { name: "Gmail", url: "https://mail.google.com/" } },
  { match: /^(outlook|hotmail|live|msn)\.[a-z.]+$/, provider: { name: "Outlook", url: "https://outlook.live.com/mail/" } },
  { match: /^(yahoo\.[a-z.]+|ymail\.com)$/, provider: { name: "Yahoo Mail", url: "https://mail.yahoo.com/" } },
  { match: /^(icloud|me|mac)\.com$/, provider: { name: "iCloud Mail", url: "https://www.icloud.com/mail" } },
];

/** The inbox for this address, or null when we don't know the provider (a work address, say). */
export function mailProviderFor(email: string): MailProvider | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  return PROVIDERS.find((entry) => entry.match.test(domain))?.provider ?? null;
}
