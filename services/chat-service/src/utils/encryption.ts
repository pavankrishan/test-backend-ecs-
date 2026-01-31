import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function getKey(): Buffer | null {
  const key = process.env.CHAT_ENCRYPTION_KEY;
  if (!key) {
    return null;
  }

  const buffer = Buffer.from(key, 'base64');
  if (buffer.length !== KEY_LENGTH) {
    throw new Error('CHAT_ENCRYPTION_KEY must be base64 encoded 32 bytes (256 bits).');
  }
  return buffer;
}

export function encryptMessage(plaintext: string): string {
  const key = getKey();
  if (!key) {
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${encrypted.toString('base64')}.${authTag.toString('base64')}`;
}

export function decryptMessage(payload: string): string {
  const key = getKey();
  if (!key) {
    return payload;
  }

  const [ivPart, dataPart, tagPart] = payload.split('.');
  if (!ivPart || !dataPart || !tagPart) {
    throw new Error('Invalid encrypted payload format.');
  }

  const iv = Buffer.from(ivPart, 'base64');
  const data = Buffer.from(dataPart, 'base64');
  const authTag = Buffer.from(tagPart, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

