export const DEFAULT_LOGIN_DOMAIN = 'evaluador.ve';
export const DEMO_LOGIN_DOMAIN = 'demo.ve';

export function normalizeLoginIdentifier(
  raw: string,
  defaultDomain: string = DEFAULT_LOGIN_DOMAIN,
): string {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return '';
  if (cleaned.includes('@')) return cleaned;
  return `${cleaned}@${defaultDomain}`;
}
