"use client";

import Link from "next/link";

export function AppUiEditorTab() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-semibold text-white mb-2">In-context UI editor</h3>
        <p className="text-sm text-gray-400 leading-relaxed">
          Open a full-screen version of the live app. Navigate between Home, Dashboard, Session
          start, and Settings — same screens and functionality as production.
        </p>
      </div>

      <ul className="text-sm text-gray-400 space-y-2 list-disc list-inside">
        <li>
          <strong className="text-gray-200">Right-click</strong> any labeled text to edit copy and
          typography
        </li>
        <li>
          <strong className="text-gray-200">Right-click</strong> images (favicon, dog photo, logo)
          to upload a replacement and crop to size
        </li>
        <li>
          Press <strong className="text-gray-200">Enter</strong> to review changes, then confirm to
          save live immediately
        </li>
      </ul>

      <Link
        href="/admin/ui-edit"
        className="inline-flex rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition"
      >
        Open editor
      </Link>
    </div>
  );
}
