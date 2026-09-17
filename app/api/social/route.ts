import { Supadata } from '@supadata/js';
import { NextResponse } from 'next/server';

type SocialTranscriptRequest = {
  url?: unknown;
  lang?: unknown;
};

export async function POST(request: Request) {
  const apiKey = process.env.SUPADATA_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'SUPADATA_API_KEY is not configured.' },
      { status: 500 },
    );
  }

  let body: SocialTranscriptRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const lang = typeof body.lang === 'string' ? body.lang.trim() : undefined;

  if (!url) {
    return NextResponse.json(
      { error: 'The url field is required.' },
      { status: 400 },
    );
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json(
      { error: 'The url field must be a valid URL.' },
      { status: 400 },
    );
  }

  try {
    const supadata = new Supadata({ apiKey });
    const transcriptResult = await supadata.transcript({
      url,
      ...(lang ? { lang } : {}),
      text: true,
      mode: 'auto',
    });

    return NextResponse.json(transcriptResult);
  } catch (error) {
    console.error('Supadata transcript request failed:', error);

    return NextResponse.json(
      { error: 'Failed to fetch the social media transcript.' },
      { status: 502 },
    );
  }
}
