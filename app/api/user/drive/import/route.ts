import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { unzipSync } from "fflate";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

export const maxDuration = 120;

interface ImportedDoc {
  id: string;
  title: string;
  fileUrl: string;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const url: string = (body.url ?? "").trim();

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // Fetch the remote file
  let fetchRes: Response;
  try {
    fetchRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; StudyFocus/1.0)" },
      redirect: "follow",
    });
  } catch {
    return NextResponse.json({ error: "Could not reach that URL. Check the link and try again." }, { status: 400 });
  }

  if (!fetchRes.ok) {
    return NextResponse.json(
      { error: `The URL returned an error (${fetchRes.status}). Make sure the link is publicly accessible.` },
      { status: 400 }
    );
  }

  const contentType = fetchRes.headers.get("content-type") ?? "";
  const rawBytes = new Uint8Array(await fetchRes.arrayBuffer());

  const isZip =
    contentType.includes("zip") ||
    url.toLowerCase().endsWith(".zip") ||
    // Check ZIP magic bytes: PK\x03\x04
    (rawBytes[0] === 0x50 && rawBytes[1] === 0x4b && rawBytes[2] === 0x03 && rawBytes[3] === 0x04);

  const isPdf =
    contentType.includes("pdf") ||
    url.toLowerCase().endsWith(".pdf") ||
    // Check PDF magic bytes: %PDF
    (rawBytes[0] === 0x25 && rawBytes[1] === 0x50 && rawBytes[2] === 0x44 && rawBytes[3] === 0x46);

  const imported: ImportedDoc[] = [];
  const now = new Date();

  if (isPdf && !isZip) {
    // Single PDF — store directly
    const rawTitle = url.split("/").pop()?.replace(/\.pdf$/i, "") ?? "Document";
    const title = decodeURIComponent(rawTitle).replace(/[-_]/g, " ").trim();
    const id = crypto.randomUUID();
    const blob = await put(`${session.user.id}/${id}.pdf`, new Blob([rawBytes], { type: "application/pdf" }), {
      access: "public",
    });
    await db.insert(documents).values({
      id,
      userId: session.user.id,
      title,
      sourceType: "upload",
      fileUrl: blob.url,
      createdAt: now,
      updatedAt: now,
    });
    imported.push({ id, title, fileUrl: blob.url });

  } else if (isZip) {
    // Unzip and extract all PDFs
    let unzipped: ReturnType<typeof unzipSync>;
    try {
      unzipped = unzipSync(rawBytes);
    } catch {
      return NextResponse.json(
        { error: "Could not unzip the file. It may be corrupted or password-protected." },
        { status: 400 }
      );
    }

    const pdfEntries = Object.entries(unzipped).filter(([name]) =>
      name.toLowerCase().endsWith(".pdf") && !name.startsWith("__MACOSX")
    );

    if (pdfEntries.length === 0) {
      return NextResponse.json(
        { error: "The zip file contains no PDF files." },
        { status: 400 }
      );
    }

    for (const [name, bytes] of pdfEntries) {
      const rawTitle = name.split("/").pop()?.replace(/\.pdf$/i, "") ?? "Document";
      const title = decodeURIComponent(rawTitle).replace(/[-_]/g, " ").trim();
      const id = crypto.randomUUID();
      const blob = await put(
        `${session.user.id}/${id}.pdf`,
        new Blob([Buffer.from(bytes)], { type: "application/pdf" }),
        { access: "public" }
      );
      await db.insert(documents).values({
        id,
        userId: session.user.id,
        title,
        sourceType: "upload",
        fileUrl: blob.url,
        createdAt: now,
        updatedAt: now,
      });
      imported.push({ id, title, fileUrl: blob.url });
    }

  } else {
    return NextResponse.json(
      { error: "The URL doesn't appear to be a PDF or ZIP file. Make sure it's a direct link ending in .pdf or .zip." },
      { status: 400 }
    );
  }

  return NextResponse.json({ imported });
}
