import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          borderRadius: 36,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
          }}
        >
          <div style={{ fontSize: 72, lineHeight: 1 }}>📖</div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "white",
              letterSpacing: -1,
            }}
          >
            BB
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
