import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message : "(missing message)";
    const logDir = path.join(process.cwd(), "logs");
    const logPath = path.join(logDir, "recipe-card.log");

    await fs.mkdir(logDir, { recursive: true });
    const entry = `[${new Date().toISOString()}] ${message}\n`;
    await fs.appendFile(logPath, entry, "utf8");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
