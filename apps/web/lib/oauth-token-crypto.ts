import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const algorithm = 'aes-256-gcm';
const version = 'v1';

function getEncryptionKey(): Buffer {
  const configured = process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY is not configured.');
  }

  if (/^[a-f0-9]{64}$/i.test(configured)) {
    return Buffer.from(configured, 'hex');
  }

  const decoded = Buffer.from(configured, 'base64');
  if (decoded.length === 32) {
    return decoded;
  }

  return createHash('sha256').update(configured).digest();
}

export function encryptOAuthToken(token: string): string {
  if (!token) throw new Error('Cannot encrypt an empty OAuth token.');

  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [version, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptOAuthToken(value: string): string {
  const [storedVersion, ivValue, tagValue, ciphertextValue] = value.split('.');
  if (storedVersion !== version || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('Stored OAuth token has an unsupported encryption format. Reconnect the provider.');
  }

  const decipher = createDecipheriv(algorithm, getEncryptionKey(), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}