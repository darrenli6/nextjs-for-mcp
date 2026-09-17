import { NextResponse } from 'next/server';

export async function GET() {
  // This is your data that the AI can access
  const data = {
    message: "Hello from MCP!",
    timestamp: new Date().toISOString(),
    tips: [
      "MCP lets AI access your app data",
      "You can create multiple endpoints",
      "AI can call these endpoints automatically"
    ]
  };
  
  return NextResponse.json(data);
}