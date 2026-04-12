"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatRole = "user" | "assistant" | "system";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

export function OwnerAiTab() {
  const [noteStyleExtra, setNoteStyleExtra] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatting, setChatting] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/owner-ai");
      if (!res.ok) return;
      const data = await res.json();
      setNoteStyleExtra(data.noteStyleExtra ?? "");
      setModel(data.model ?? "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function saveStyle() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/owner-ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteStyleExtra }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSaveMsg("Saved. New instructions apply to notes, quiz, and video suggestions.");
        setNoteStyleExtra(data.noteStyleExtra ?? noteStyleExtra);
      } else {
        setSaveMsg(data.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function sendChat() {
    const trimmed = input.trim();
    if (!trimmed || chatting) return;
    setChatError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setChatting(true);
    try {
      const res = await fetch("/api/admin/owner-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChatError(data.error ?? "Chat request failed");
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content ?? "" },
      ]);
    } catch {
      setChatError("Network error");
    } finally {
      setChatting(false);
    }
  }

  if (loading) {
    return (
      <p className="text-gray-400 text-sm animate-pulse py-8">Loading owner AI settings…</p>
    );
  }

  return (
    <div className="space-y-10 max-w-3xl">
      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
        <h2 className="text-sm font-semibold text-white mb-1">AI model</h2>
        <p className="text-xs text-gray-500 mb-3">
          All Bowl Beacon AI features (notes, quiz, videos, this chat) use this model.
        </p>
        <code className="text-sm text-emerald-400 bg-gray-950 px-2 py-1 rounded border border-gray-800">
          {model || "—"}
        </code>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
        <h2 className="text-sm font-semibold text-white mb-1">Global note-taking &amp; AI style</h2>
        <p className="text-xs text-gray-500 mb-3">
          These instructions are appended to the system prompt for AI notes, quizzes, and video
          suggestions. Use them to set tone (e.g. more formal, more examples, MCAT-style), depth,
          or formatting preferences.
        </p>
        <textarea
          value={noteStyleExtra}
          onChange={(e) => setNoteStyleExtra(e.target.value)}
          rows={8}
          placeholder="e.g. Prefer short phrases. Always include one real-world example per concept. Use US customary units when the source does."
          className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none resize-y"
          maxLength={8000}
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={saveStyle}
            disabled={saving}
            className="rounded-lg bg-white text-gray-950 px-4 py-2 text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save style instructions"}
          </button>
          {saveMsg && (
            <span className="text-xs text-gray-400">{saveMsg}</span>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-6">
        <h2 className="text-sm font-semibold text-amber-200 mb-1">Direct OpenAI chat</h2>
        <p className="text-xs text-amber-200/70 mb-4">
          Owner-only playground using the same API key and model. Messages are not stored on the server.
        </p>
        <div className="rounded-lg border border-gray-800 bg-gray-950 h-72 overflow-y-auto p-3 space-y-3 mb-3">
          {messages.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-8">Send a message to start.</p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-sm rounded-lg px-3 py-2 max-w-[95%] whitespace-pre-wrap ${
                m.role === "user"
                  ? "ml-auto bg-gray-800 text-gray-100"
                  : "mr-auto bg-gray-900 border border-gray-800 text-gray-300"
              }`}
            >
              {m.content}
            </div>
          ))}
          {chatting && (
            <p className="text-xs text-gray-500 animate-pulse">Thinking…</p>
          )}
          <div ref={bottomRef} />
        </div>
        {chatError && (
          <p className="text-xs text-red-400 mb-2">{chatError}</p>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendChat())}
            placeholder="Message…"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-gray-500 focus:outline-none"
            maxLength={4000}
            disabled={chatting}
          />
          <button
            type="button"
            onClick={sendChat}
            disabled={chatting || !input.trim()}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setMessages([]);
            setChatError(null);
          }}
          className="mt-2 text-xs text-gray-500 hover:text-gray-400 underline"
        >
          Clear conversation
        </button>
      </section>
    </div>
  );
}
