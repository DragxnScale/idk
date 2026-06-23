"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const LOGO_NATURAL_W = 499;
const LOGO_NATURAL_H = 487;
/** Ring pulse origin — geometric center of the logo image */
const RING_ORIGIN_Y = 0.5;

/**
 * Full-screen splash — fixed monochrome palette, not tied to user theme.
 * Layout: one centered column → beacon (logo + rings) → wordmark → tagline.
 */
export function SplashScreen() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 3900);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes bb-ring {
          0%   { width: 56px;  height: 56px;  top: -28px; left: -28px; opacity: 0; }
          14%  { opacity: 0.38; }
          100% { width: 400px; height: 400px; top: -200px; left: -200px; opacity: 0; }
        }
        @keyframes bb-logo {
          0%, 12%  { opacity: 0; transform: scale(0.84); }
          100%     { opacity: 1; transform: scale(1); }
        }
        @keyframes bb-name {
          0%, 28%  { opacity: 0; transform: translateY(8px); }
          100%     { opacity: 1; transform: translateY(0); }
        }
        @keyframes bb-tag {
          0%, 52%  { opacity: 0; }
          100%     { opacity: 0.5; }
        }
        @keyframes bb-splash {
          0%, 68%  { opacity: 1; }
          100%     { opacity: 0; }
        }
        .bb-ring {
          position: absolute;
          border-radius: 50%;
          border: 1.2px solid rgba(255,255,255,0.42);
          background: transparent;
          animation: bb-ring 2.6s ease-out infinite;
          pointer-events: none;
        }
        /* Single centered column — logo, rings, and text share one axis */
        .bb-splash-hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        /* Only as tall as the logo; rings overflow this box visually */
        .bb-splash-beacon {
          position: relative;
          width: clamp(120px, 28vw, 160px);
          margin-bottom: 22px;
        }
        .bb-splash-rings {
          position: absolute;
          left: 50%;
          top: calc(${RING_ORIGIN_Y * 100}%);
          transform: translateX(-50%);
          width: 0;
          height: 0;
          z-index: 0;
        }
        .bb-splash-logo {
          position: relative;
          z-index: 1;
          display: block;
          width: 100%;
          height: auto;
          aspect-ratio: ${LOGO_NATURAL_W} / ${LOGO_NATURAL_H};
          animation: bb-logo 1.1s ease-out forwards;
        }
        .bb-splash-name {
          color: #fff;
          font: 600 15px/1.2 system-ui, -apple-system, sans-serif;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          white-space: nowrap;
          margin: 0 0 12px;
          position: relative;
          z-index: 2;
          animation: bb-name 2s ease-out forwards;
        }
        .bb-splash-tag {
          color: #fff;
          font: 400 11px/1.4 system-ui, -apple-system, sans-serif;
          letter-spacing: 0.1em;
          white-space: nowrap;
          margin: 0;
          position: relative;
          z-index: 2;
          animation: bb-tag 2.9s ease-out forwards;
        }
      `}</style>

      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          backgroundColor: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          animation: "bb-splash 3.8s ease-in-out forwards",
        }}
      >
        <div className="bb-splash-hero">
          <div className="bb-splash-beacon">
            <div className="bb-splash-rings">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bb-ring"
                  style={{ animationDelay: `${i * 0.65}s` }}
                />
              ))}
            </div>
            <Image
              src="/splash-logo.png"
              alt=""
              width={LOGO_NATURAL_W}
              height={LOGO_NATURAL_H}
              priority
              className="bb-splash-logo"
            />
          </div>

          <div className="bb-splash-name">Bowl Beacon</div>
          <div className="bb-splash-tag">Stay focused. Study smarter.</div>
        </div>
      </div>
    </>
  );
}
