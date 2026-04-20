import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { getAppUser } from "@/lib/app-user";

/** Who the app treats as signed-in (includes admin view-as). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const effective = await getAppUser();
  if (!effective) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const impersonating =
    (await isAdmin(session.user.email)) &&
    effective.id !== session.user.id;

  return NextResponse.json({
    jwtUserId: session.user.id,
    effectiveUser: effective,
    impersonating,
    /** Real admin identity when impersonating */
    adminEmail: impersonating ? session.user.email : null,
  });
}
