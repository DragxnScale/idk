import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { documents, users } from "@/lib/db/schema";
import { deletePdf, listR2BucketObjects, type BackendName } from "@/lib/storage-backend";

// Node runtime — listing R2 needs the AWS SDK.
export const runtime = "nodejs";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { bucketName, objects, objectCount, totalSize } = await listR2BucketObjects();

    const allBlobs: {
      url: string;
      pathname: string;
      size: number;
      uploadedAt: string;
      backend: BackendName;
      documentId: string | null;
      documentTitle: string | null;
      documentSourceType: string | null;
      uploader: { id: string; name: string | null; email: string } | null;
    }[] = objects.map((o) => ({
      url: o.url,
      pathname: o.pathname,
      size: o.size,
      uploadedAt: o.uploadedAt,
      backend: o.backend,
      documentId: null,
      documentTitle: null,
      documentSourceType: null,
      uploader: null,
    }));

    const documentRows = await db
      .select({
        fileUrl: documents.fileUrl,
        documentId: documents.id,
        documentTitle: documents.title,
        documentSourceType: documents.sourceType,
        uploaderId: users.id,
        uploaderName: users.name,
        uploaderEmail: users.email,
      })
      .from(documents)
      .leftJoin(users, eq(documents.userId, users.id));

    const documentsByUrl = new Map(
      documentRows
        .filter((row) => row.fileUrl)
        .map((row) => [row.fileUrl!, row])
    );

    for (const blob of allBlobs) {
      const doc = documentsByUrl.get(blob.url);
      if (!doc) continue;
      blob.documentId = doc.documentId;
      blob.documentTitle = doc.documentTitle;
      blob.documentSourceType = doc.documentSourceType;
      blob.uploader = doc.uploaderId && doc.uploaderEmail
        ? { id: doc.uploaderId, name: doc.uploaderName, email: doc.uploaderEmail }
        : null;
    }

    return NextResponse.json({
      blobs: allBlobs,
      bucketName,
      objectCount,
      totalSize,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url param required" }, { status: 400 });
  }

  try {
    await deletePdf(url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
