import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

/**
 * 사용자별 OpenAI API 키처럼 평문 노출이 위험한 값을 AES-256-GCM으로 암호화한다.
 * 저장 포맷: base64(iv) ":" base64(authTag) ":" base64(ciphertext)
 *
 * - 마스터 키는 ENCRYPTION_KEY (64자 hex = 32 bytes).
 * - iv는 12바이트 무작위(GCM 권장).
 * - 동일한 평문을 두 번 암호화해도 매번 iv가 달라서 ciphertext가 다르게 나온다.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const hex = config.getOrThrow<string>('ENCRYPTION_KEY').trim();
    this.key = Buffer.from(hex, 'hex');
    if (this.key.length !== 32) {
      throw new Error('[crypto] ENCRYPTION_KEY는 32 bytes(64 hex chars)여야 한다.');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv) as CipherGCM;
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('[crypto] invalid ciphertext format');
    }
    const [ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ctB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv) as DecipherGCM;
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  }
}
