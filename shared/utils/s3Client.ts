/**
 * S3 client for uploads and presigned URLs.
 * Uses env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import logger from '../config/logger';

const region = process.env.AWS_REGION || 'us-east-1';
const bucket = process.env.AWS_S3_BUCKET || '';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    const key = process.env.AWS_ACCESS_KEY_ID;
    const secret = process.env.AWS_SECRET_ACCESS_KEY;
    if (!key || !secret) {
      throw new Error('S3 not configured: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY required');
    }
    client = new S3Client({
      region,
      credentials: { accessKeyId: key, secretAccessKey: secret },
    });
  }
  return client;
}

/**
 * Upload a buffer to S3. Returns the object key.
 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  metadata?: Record<string, string>
): Promise<string> {
  if (!bucket) {
    throw new Error('S3 not configured: AWS_S3_BUCKET required');
  }
  const input: PutObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(metadata && { Metadata: metadata }),
  };
  await getClient().send(new PutObjectCommand(input));
  logger.debug('S3 upload completed', { key, bucket, contentType });
  return key;
}

/**
 * Generate a presigned GET URL for an S3 object (e.g. for video/PDF).
 * expiresIn: seconds (default 3600 = 1 hour).
 */
export async function getSignedGetUrl(key: string, expiresIn = 3600): Promise<string> {
  if (!bucket) {
    throw new Error('S3 not configured: AWS_S3_BUCKET required');
  }
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(getClient(), command, { expiresIn });
  return url;
}

/**
 * Check if S3 is configured (bucket and credentials set).
 */
export function isS3Configured(): boolean {
  return Boolean(
    process.env.AWS_S3_BUCKET &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
  );
}
