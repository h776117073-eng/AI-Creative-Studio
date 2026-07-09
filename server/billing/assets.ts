import crypto from 'node:crypto';
export function createSignedUploadUrl(bucket: string, key: string, secret: string, ttlSeconds = 900): { url: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = crypto.createHmac('sha256', secret).update(`${bucket}/${key}:${expiresAt}`).digest('hex');
  return { url: `https://storage.example.com/${bucket}/${encodeURIComponent(key)}?expires=${expiresAt}&signature=${signature}`, expiresAt };
}
