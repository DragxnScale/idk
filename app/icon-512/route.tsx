import { ImageResponse } from "next/og";

export const runtime = "edge";

function IconContent({ size }: { size: number }) {
  const emojiSize = Math.round(size * 0.4);
  const textSize = Math.round(size * 0.14);
  const radius = Math.round(size * 0.19);
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        borderRadius: radius,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div style={{ fontSize: emojiSize, lineHeight: 1 }}>📖</div>
        <div style={{ fontSize: textSize, fontWeight: 800, color: "white", letterSpacing: -2 }}>BB</div>
      </div>
    </div>
  );
}

export async function GET() {
  return new ImageResponse(<IconContent size={512} />, {
    width: 512,
    height: 512,
  });
}
