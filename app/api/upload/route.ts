import { createHash, timingSafeEqual } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function hasValidAccessToken(request: Request, expectedToken: string) {
  const authorization = request.headers.get('authorization') ?? '';
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return false;
  const receivedHash = createHash('sha256').update(token).digest();
  const expectedHash = createHash('sha256').update(expectedToken).digest();
  return timingSafeEqual(receivedHash, expectedHash);
}

function getS3Client() {
  const accessKeyId = process.env.AW_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AW_SECRET_ACCESS_KEY;
  const region = process.env.AW_REGION ?? 'eu-central-1';
  if (!accessKeyId || !secretAccessKey) return null;
  return new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
}

export async function POST(request: Request) {
  const accessToken = process.env.ACCESS_TOKEN;
  if (!accessToken) return Response.json({ error: 'ACCESS_TOKEN is not configured.' }, { status: 500 });
  if (!hasValidAccessToken(request, accessToken)) {
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body: { dataUrl?: string; filename?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { dataUrl, filename } = body;
  if (!dataUrl) return Response.json({ error: 'Missing dataUrl' }, { status: 400 });

  // Parse data URL: "data:<mime>;base64,<data>"
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return Response.json({ error: 'Invalid dataUrl format' }, { status: 400 });

  const [, mimeType, base64Data] = match;
  const buffer = Buffer.from(base64Data, 'base64');

  const s3 = getS3Client();
  const bucket = process.env.AW_S3_BUCKET;

  if (!s3 || !bucket) {
    return Response.json({ error: 'S3 not configured. Set AW_ACCESS_KEY_ID, AW_SECRET_ACCESS_KEY, AW_S3_BUCKET in .env' }, { status: 500 });
  }

  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  const hash = createHash('md5').update(buffer).digest('hex').slice(0, 8);
  const safeFilename = (filename ?? 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `img-translate/${Date.now()}-${hash}-${safeFilename}.${ext}`;
  const region = process.env.AW_REGION ?? 'eu-central-1';

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  });

  await s3.send(cmd);

  // Generate a 7-day pre-signed URL so KIE can download the image
  const getCmd = new (await import('@aws-sdk/client-s3')).GetObjectCommand({ Bucket: bucket, Key: key });
  const signedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 7 * 24 * 3600 });

  // Also build the public URL (works if bucket has public-read policy)
  const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  console.info('[S3] uploaded', { key, bucket, region, size: buffer.length });

  return Response.json({ url: signedUrl, publicUrl, key });
}
