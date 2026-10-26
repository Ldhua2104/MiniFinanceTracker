import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ENCRYPTION_KEY_VERSION = 1;

function encryptionKey() {
  const encoded = env.AI_CREDENTIALS_ENCRYPTION_KEY;
  const key = Buffer.from(encoded, 'base64');
  if (!encoded || key.length !== 32 || key.toString('base64') !== encoded) {
    const error = new Error('AI credential encryption is not configured');
    error.code = 'AI_ENCRYPTION_NOT_CONFIGURED';
    throw error;
  }
  return key;
}

export function encryptAiSettings(value, userId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(String(userId)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: ENCRYPTION_KEY_VERSION
  };
}

export function decryptAiSettings(envelope, userId) {
  if (envelope.keyVersion !== ENCRYPTION_KEY_VERSION) {
    const error = new Error(`Unsupported AI credential key version: ${envelope.keyVersion}`);
    error.code = 'AI_ENCRYPTION_KEY_VERSION_UNSUPPORTED';
    throw error;
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(String(userId)));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}
