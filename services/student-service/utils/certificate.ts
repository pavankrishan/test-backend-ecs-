import { createHash, randomUUID } from 'crypto';

export interface CertificateSource {
  studentId: string;
  studentName: string;
  courseId: string;
  courseTitle?: string;
}

export interface CertificatePayload {
  certificateId: string;
  studentId: string;
  courseId: string;
  studentName: string;
  courseTitle?: string;
  issuedAt: string;
  verificationCode: string;
}

export function generateCourseCertificate(source: CertificateSource): CertificatePayload {
  const issuedAt = new Date().toISOString();
  const certificateId = randomUUID();

  const verificationCode = createHash('sha256')
    .update(`${source.studentId}:${source.courseId}:${issuedAt}:${certificateId}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();

  return {
    certificateId,
    studentId: source.studentId,
    courseId: source.courseId,
    studentName: source.studentName,
    courseTitle: source.courseTitle,
    issuedAt,
    verificationCode,
  };
}

