import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireSuperOwner } from "@/lib/admin";
import { db } from "@/lib/db";
import { globalConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  DEFAULT_CONFIG,
  type SettingsLayoutConfig,
} from "@/lib/types/settings-layout";

async function getConfig(): Promise<SettingsLayoutConfig> {
  const row = await db.query.globalConfig.findFirst({ where: eq(globalConfig.id, 1) });
  if (!row?.settingsLayoutJson) return DEFAULT_CONFIG;
  try {
    return JSON.parse(row.settingsLayoutJson) as SettingsLayoutConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

// GET — any logged-in user may read (settings page needs it)
export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ config: await getConfig() });
}

// PATCH — super-owner only
export async function PATCH(req: Request) {
  const owner = await requireSuperOwner();
  if (!owner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { config: SettingsLayoutConfig };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const config = body?.config;
  if (!config || !Array.isArray(config.cards)) {
    return NextResponse.json({ error: "Invalid config shape" }, { status: 400 });
  }

  const json = JSON.stringify(config);
  const now = new Date();

  // Upsert row id=1
  const existing = await db.query.globalConfig.findFirst({ where: eq(globalConfig.id, 1) });
  if (existing) {
    await db.update(globalConfig)
      .set({ settingsLayoutJson: json, updatedAt: now })
      .where(eq(globalConfig.id, 1));
  } else {
    await db.insert(globalConfig).values({ id: 1, settingsLayoutJson: json, updatedAt: now });
  }

  return NextResponse.json({ config });
}
