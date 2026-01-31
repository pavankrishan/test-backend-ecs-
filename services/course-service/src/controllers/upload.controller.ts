/**
 * Upload Controller - File Upload Handler
 * Uploads to S3 bucket (AWS_S3_BUCKET, e.g. kc-code-test).
 */

import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { uploadToS3, getSignedGetUrl, isS3Configured } from '@kodingcaravan/shared/utils/s3Client';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'application/pdf',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: images, videos, PDF.'));
    }
  },
});

// Single file upload middleware
export const uploadSingle = upload.single('file');

const UPLOAD_PREFIX = 'uploads';

export class UploadController {
  /**
   * POST /api/v1/upload
   * Upload a file to S3 (image, video, or PDF). Returns S3 key and a signed URL.
   */
  uploadFile = async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'No file provided',
        });
      }

      if (!isS3Configured()) {
        return errorResponse(res, {
          statusCode: 503,
          message: 'Upload not configured: S3 credentials and bucket required',
        });
      }

      const file = req.file;
      const fileExtension = path.extname(file.originalname);
      const fileName = `${uuidv4()}${fileExtension}`;
      const s3Key = `${UPLOAD_PREFIX}/${fileName}`;

      await uploadToS3(s3Key, file.buffer, file.mimetype);

      const signedUrl = await getSignedGetUrl(s3Key, 3600);

      return successResponse(res, {
        statusCode: 201,
        message: 'File uploaded successfully',
        data: {
          key: s3Key,
          url: signedUrl,
          fileName,
          size: file.size,
          mimeType: file.mimetype,
        },
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to upload file',
      });
    }
  };
}
