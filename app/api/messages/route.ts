import { NextRequest, NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { requireAdmin, isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { messages, users } from "@/lib/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

const ADMIN_EMAIL = "jaydenw0711@gmail.com";

async function getAdminUserId(): Promise<string | null> {
  const admin = await db.query.users.findFirst({
    where: (u, { eq: e }) => e(u.email, ADMIN_EMAIL),
  });
  return admin?.id ?? null;
}

export async function GET(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(user.email ?? "");

  if (admin) {
    const userId = req.nextUrl.searchParams.get("userId");
    if (userId) {
      const rows = await db.query.messages.findMany({
        where: (m, { or: o, and: a, eq: e }) =>
          o(
            a(e(m.fromUserId, userId), e(m.toUserId, user.id)),
            a(e(m.fromUserId, user.id), e(m.toUserId, userId))
          ),
        orderBy: (m, { asc }) => asc(m.createdAt),
      });

      await db
        .update(messages)
        .set({ read: true })
        .where(
          and(eq(messages.toUserId, user.id), eq(messages.fromUserId, userId))
        );

      return NextResponse.json(rows);
    }

    const allMessages = await db.query.messages.findMany({
      where: (m, { or: o, eq: e }) =>
        o(e(m.fromUserId, user.id), e(m.toUserId, user.id)),
      orderBy: (m, { desc: d }) => d(m.createdAt),
    });

    const conversationMap = new Map<
      string,
      { userId: string; lastMessage: string; lastAt: string; unread: number }
    >();

    for (const msg of allMessages) {
      const otherId =
        msg.fromUserId === user.id ? msg.toUserId : msg.fromUserId;
      if (!conversationMap.has(otherId)) {
        conversationMap.set(otherId, {
          userId: otherId,
          lastMessage: msg.content.slice(0, 100),
          lastAt: msg.createdAt?.toISOString() ?? "",
          unread: 0,
        });
      }
      if (msg.toUserId === user.id && !msg.read) {
        const conv = conversationMap.get(otherId)!;
        conv.unread++;
      }
    }

    const userIds = Array.from(conversationMap.keys());
    const userRows =
      userIds.length > 0
        ? await Promise.all(
            userIds.map((uid) =>
              db.query.users.findFirst({
                where: (u, { eq: e }) => e(u.id, uid),
              })
            )
          )
        : [];

    const userMap = new Map(
      userRows.filter(Boolean).map((u) => [u!.id, {
        name: u!.name,
        email: u!.email,
        mutedUntil: u!.mutedUntil?.toISOString() ?? null,
        blocked: u!.blocked,
      }])
    );

    const now = new Date();
    const conversations = Array.from(conversationMap.values()).map((c) => {
      const info = userMap.get(c.userId);
      const mutedUntil = info?.mutedUntil ? new Date(info.mutedUntil) : null;
      return {
        ...c,
        userName: info?.name ?? null,
        userEmail: info?.email ?? null,
        muted: mutedUntil ? mutedUntil > now : false,
        mutedUntil: info?.mutedUntil ?? null,
        blocked: info?.blocked ?? false,
      };
    });

    return NextResponse.json({ conversations });
  }

  // Regular user: get conversation with admin
  const adminId = await getAdminUserId();
  if (!adminId) {
    return NextResponse.json([]);
  }

  const rows = await db.query.messages.findMany({
    where: (m, { or: o, and: a, eq: e }) =>
      o(
        a(e(m.fromUserId, user.id), e(m.toUserId, adminId)),
        a(e(m.fromUserId, adminId), e(m.toUserId, user.id))
      ),
    orderBy: (m, { asc }) => asc(m.createdAt),
  });

  await db
    .update(messages)
    .set({ read: true })
    .where(
      and(eq(messages.toUserId, user.id), eq(messages.fromUserId, adminId))
    );

  return NextResponse.json({ messages: rows, currentUserId: user.id });
}

export async function POST(req: NextRequest) {
  const authUser = await getAppUser();
  if (!authUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { content, toUserId } = body;

  if (!content?.trim()) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const user = await db.query.users.findFirst({
    where: (u, { eq: e }) => e(u.id, authUser.id),
  });

  if (user?.blocked) {
    return NextResponse.json(
      { error: "You have been blocked from sending messages." },
      { status: 403 }
    );
  }

  if (user?.mutedUntil && user.mutedUntil > new Date()) {
    const until = user.mutedUntil.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return NextResponse.json(
      { error: `You are muted until ${until}.` },
      { status: 403 }
    );
  }

  const admin = await isAdmin(authUser.email ?? "");
  let targetUserId: string;

  if (admin && toUserId) {
    targetUserId = toUserId;
  } else {
    const adminId = await getAdminUserId();
    if (!adminId) {
      return NextResponse.json({ error: "Admin not found" }, { status: 500 });
    }
    targetUserId = adminId;
  }

  const id = randomUUID();
  const row = {
    id,
    fromUserId: authUser.id,
    toUserId: targetUserId,
    content: content.trim().slice(0, 2000),
    read: false,
    createdAt: new Date(),
  };

  await db.insert(messages).values(row);
  return NextResponse.json(row, { status: 201 });
}
