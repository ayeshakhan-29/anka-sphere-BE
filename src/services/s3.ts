import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

let s3Client: S3Client | null = null;
const bucketName = process.env.AWS_S3_BUCKET_NAME;

if (
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_REGION &&
  bucketName
) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

export function isS3Configured(): boolean {
  return s3Client !== null && !!bucketName;
}

/**
 * Uploads a base64 data URI to AWS S3 and returns the public URL.
 * If S3 is not configured, or if the URL is not a data URI, returns the original URL.
 */
export async function uploadToS3(dataUri: string, filenamePrefix: string): Promise<string> {
  if (!isS3Configured() || !s3Client || !bucketName) {
    return dataUri;
  }

  if (!dataUri.startsWith('data:')) {
    // Not a data URI (already an HTTP URL or similar)
    return dataUri;
  }

  try {
    // data:[mime/type];base64,[data]
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid data URI format');
    }

    const contentType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Determine file extension
    let ext = 'png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
    else if (contentType.includes('webp')) ext = 'webp';
    else if (contentType.includes('gif')) ext = 'gif';
    else if (contentType.includes('mp4')) ext = 'mp4';
    else if (contentType.includes('quicktime')) ext = 'mov';

    // Unique filename
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const key = `uploads/${filenamePrefix}-${uniqueId}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await s3Client.send(command);

    // Construct the S3 public URL
    const region = process.env.AWS_REGION;
    return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  } catch (error) {
    console.error('Failed to upload asset to AWS S3:', error);
    // Fall back to returning the original data URI so that nothing breaks
    return dataUri;
  }
}
