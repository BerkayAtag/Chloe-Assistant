export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email)) throw new Error('Geçerli bir e-posta adresi yaz.');
  return email;
}

export function emailProvider(value: string): 'google' | 'microsoft' | '' {
  const domain = value.trim().toLowerCase().split('@')[1];
  if (['gmail.com', 'googlemail.com'].includes(domain)) return 'google';
  if (/^(?:outlook|hotmail|live|msn)\.(?:com|com\.tr|co\.uk|de|fr)$/u.test(domain || '')) return 'microsoft';
  // Custom company domains cannot reliably identify the mailbox host.
  return '';
}
