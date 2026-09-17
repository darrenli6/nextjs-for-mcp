import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    users: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]
  });
}
