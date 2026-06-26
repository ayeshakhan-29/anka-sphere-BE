import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const secret = process.env.WP_ENCRYPTION_KEY;
  if (!secret) {
    // Do not silently fall back in production.
    // For local dev, this is still usable if you set the env var.
    throw new Error('Missing WP_ENCRYPTION_KEY env var');
  }
  // Derive a 32-byte key from the secret.
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptText(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv).base64(tag).base64(ciphertext)
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptText(enc: string): string {
  const key = getKey();
  const [ivB64, tagB64, ctB64] = enc.split('.');
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('Invalid encrypted value');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

