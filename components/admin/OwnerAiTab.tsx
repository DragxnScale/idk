"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AI_MODEL_PRESETS,
  OWNER_AI_SETTING_KEYS,
  type AiReasoningMode,
  type OwnerAiSettings,
} from "@/lib/owner-ai-settings-shared";
import {
  contentMentionsOwnerAiProposal,
  parseOwnerAiProposal,
  stripOwnerAiProposalFromDisplay,
} from "@/lib/owner-ai-proposal";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface InsightsSummary {
  contentCounts: Record<string, number>;
  usageTotals30d: { callCount: number; totalTokens: number };
  reportedVelocityCount: number;
  clientErrorCount: number;
}

const ANALYZE_USER_MESSAGE =
  "Analyze recent production data and suggest prompt improvements.";

function modelSupportsReasoning(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.startsWith("gpt-5") ||
    id.startsWith("o1") ||
    id.startsWith("o3") ||
    id.startsWith("o4")
  );
}

const EMPTY_SETTINGS: OwnerAiSettings = {
  aiOwnerStyle: "",
  aiProductContext: "",
  aiNotesExtra: "",
  aiQuizExtra: "",
  aiFlashcardsExtra: "",
  aiVelocityExtra: "",
  aiVideosExtra: "",
};

const FEATURE_HINTS: { key: keyof OwnerAiSettings; label: string; hint: string }[] = [
  {
    key: "aiNotesExtra",
    label: "Notes",
    hint: "POST /api/ai/notes",
  },
  {
    key: "aiQuizExtra",
    label: "Quiz + fact-check",
    hint: "POST /api/ai/quiz, factCheckQuizQuestions",
  },
  {
    key: "aiFlashcardsExtra",
    label: "Flashcards",
    hint: "POST /api/ai/flashcards",
  },
  {
    key: "aiVelocityExtra",
    label: "Velocity",
    hint: "POST /api/ai/velocity, complete, factCheckVelocityQuestions",
  },
  {
    key: "aiVideosExtra",
    label: "Videos",
    hint: "POST /api/ai/videos",
  },
];

const PATCH_KEY_LABELS: Record<string, string> = {
  [OWNER_AI_SETTING_KEYS.aiProductContext]: "Product context",
  [OWNER_AI_SETTING_KEYS.aiOwnerStyle]: "Global style",
  [OWNER_AI_SETTING_KEYS.aiNotesExtra]: "Notes extra",
  [OWNER_AI_SETTING_KEYS.aiQuizExtra]: "Quiz extra",
  [OWNER_AI_SETTING_KEYS.aiFlashcardsExtra]: "Flashcards extra",
  [OWNER_AI_SETTING_KEYS.aiVelocityExtra]: "Velocity extra",
  [OWNER_AI_SETTING_KEYS.aiVideosExtra]: "Videos extra",
};

const CAMEL_TO_SNAKE: Record<keyof OwnerAiSettings, string> = {
  aiOwnerStyle: OWNER_AI_SETTING_KEYS.aiOwnerStyle,
  aiProductContext: OWNER_AI_SETTING_KEYS.aiProductContext,
  aiNotesExtra: OWNER_AI_SETTING_KEYS.aiNotesExtra,
  aiQuizExtra: OWNER_AI_SETTING_KEYS.aiQuizExtra,
  aiFlashcardsExtra: OWNER_AI_SETTING_KEYS.aiFlashcardsExtra,
  aiVelocityExtra: OWNER_AI_SETTING_KEYS.aiVelocityExtra,
  aiVideosExtra: OWNER_AI_SETTING_KEYS.aiVideosExtra,
};

function snakePatchesToCamel(
  patches: Record<string, string>
): Partial<OwnerAiSettings> {
  const out: Partial<OwnerAiSettings> = {};
  for (const [key, value] of Object.entries(patches)) {
    const entry = Object.entries(CAMEL_TO_SNAKE).find(([, snake]) => snake === key);
    if (entry) {
      out[entry[0] as keyof OwnerAiSettings] = value;
    }
  }
  return out;
}

export function OwnerAiTab() {
  const [settings, setSettings] = useState<OwnerAiSettings>(EMPTY_SETTINGS);
  const [model, setModel] = useState("");
  const [reasoningMode, setReasoningMode] = useState<AiReasoningMode>("instant");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatting, setChatting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [insightsSummary, setInsightsSummary] = useState<InsightsSummary | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<{
    patches: Record<string, string>;
    summary: string;
    messageIndex: number;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const [proposalAppliedNotice, setProposalAppliedNotice] = useState(false);
  const handledProposalIndicesRef = useRef<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/owner-ai");
      if (!res.ok) return;
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
      else if (data.noteStyleExtra != null) {
        setSettings((s) => ({ ...s, aiOwnerStyle: data.noteStyleExtra }));
      }
      setModel(data.model ?? "");
      if (data.reasoningMode === "thinking" || data.reasoningMode === "instant") {
        setReasoningMode(data.reasoningMode);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingProposal]);

  useEffect(() => {
    if (pendingProposal) return;
    const lastIdx = messages.findLastIndex((m) => m.role === "assistant");
    if (lastIdx === -1) return;
    if (handledProposalIndicesRef.current.has(lastIdx)) return;
    const proposal = parseOwnerAiProposal(messages[lastIdx].content);
    if (proposal) {
      setPendingProposal({ ...proposal, messageIndex: lastIdx });
    }
  }, [messages, pendingProposal]);

  useEffect(() => {
    if (!proposalAppliedNotice) return;
    const timer = window.setTimeout(() => setProposalAppliedNotice(false), 3500);
    return () => window.clearTimeout(timer);
  }, [proposalAppliedNotice]);

  async function saveAll() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/owner-ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings,
          aiModel: model.trim(),
          aiReasoningMode: reasoningMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.settings) setSettings(data.settings);
        if (data.model) setModel(data.model);
        if (data.reasoningMode === "thinking" || data.reasoningMode === "instant") {
          setReasoningMode(data.reasoningMode);
        }
        setSaveMsg(
          "Saved. Model, reasoning mode, and prompts apply to all AI features."
        );
      } else {
        setSaveMsg(data.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function loadSnapshot() {
    setSnapshotLoading(true);
    setChatError(null);
    try {
      const res = await fetch("/api/admin/owner-ai/insights");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChatError(data.error ?? "Failed to load production snapshot");
        return;
      }
      const insights = data.insights as {
        contentCounts: Record<string, number>;
        reportedVelocityCount: number;
        usageSections: { callCount30d: number; totalTokens30d: number }[];
        clientErrors: unknown[];
      };
      const usageTotals30d = (insights.usageSections ?? []).reduce(
        (acc, s) => ({
          callCount: acc.callCount + s.callCount30d,
          totalTokens: acc.totalTokens + s.totalTokens30d,
        }),
        { callCount: 0, totalTokens: 0 }
      );
      setInsightsSummary({
        contentCounts: insights.contentCounts,
        usageTotals30d,
        reportedVelocityCount: insights.reportedVelocityCount ?? 0,
        clientErrorCount: insights.clientErrors?.length ?? 0,
      });
      setSnapshotOpen(true);
    } catch {
      setChatError("Network error loading snapshot");
    } finally {
      setSnapshotLoading(false);
    }
  }

  async function analyzeAndSuggest() {
    if (chatting || analyzing) return;
    setChatError(null);
    setPendingProposal(null);
    const userMsg: ChatMessage = { role: "user", content: ANALYZE_USER_MESSAGE };
    const next = [...messages, userMsg];
    setMessages(next);
    setAnalyzing(true);
    try {
      const res = await fetch("/api/admin/owner-ai/suggest", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChatError(data.error ?? "Analysis request failed");
        return;
      }
      const content = data.content ?? "";
      setMessages((prev) => [...prev, { role: "assistant", content }]);
      if (data.insightsSummary) {
        setInsightsSummary(data.insightsSummary as InsightsSummary);
      }
      const proposal = parseOwnerAiProposal(content);
      if (proposal) {
        setPendingProposal({
          ...proposal,
          messageIndex: next.length,
        });
      }
    } catch {
      setChatError("Network error");
    } finally {
      setAnalyzing(false);
    }
  }

  async function sendChat() {
    const trimmed = input.trim();
    if (!trimmed || chatting || analyzing) return;
    setChatError(null);
    setPendingProposal(null);
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
      const content = data.content ?? "";
      setMessages((prev) => [...prev, { role: "assistant", content }]);
      const proposal = parseOwnerAiProposal(content);
      if (proposal) {
        setPendingProposal({
          ...proposal,
          messageIndex: next.length,
        });
      }
    } catch {
      setChatError("Network error");
    } finally {
      setChatting(false);
    }
  }

  function dismissProposal() {
    if (!pendingProposal) return;
    handledProposalIndicesRef.current.add(pendingProposal.messageIndex);
    setPendingProposal(null);
  }

  async function applyProposal() {
    if (!pendingProposal || applying) return;
    const messageIndex = pendingProposal.messageIndex;
    setApplying(true);
    setChatError(null);
    setProposalAppliedNotice(false);
    try {
      const res = await fetch("/api/admin/owner-ai/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patches: pendingProposal.patches }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChatError(data.error ?? "Apply failed");
        return;
      }
      if (data.settings) {
        setSettings(data.settings);
      } else {
        setSettings((prev) => ({
          ...prev,
          ...snakePatchesToCamel(pendingProposal.patches),
        }));
      }
      handledProposalIndicesRef.current.add(messageIndex);
      setPendingProposal(null);
      setProposalAppliedNotice(true);
      setSaveMsg("Copilot proposal applied.");
    } catch {
      setChatError("Network error applying proposal");
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <p className="text-gray-400 text-sm animate-pulse py-8">Loading owner AI settings…</p>
    );
  }

  return (
    <div className="space-y-10 max-w-3xl">
      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white mb-1">AI model</h2>
          <p className="text-xs text-gray-500">
            Applies to notes, quiz, flashcards, velocity, videos, owner copilot, and
            admin TOC extract. Saved with <span className="text-gray-400">Save all settings</span>{" "}
            below.
          </p>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Model id</label>
          <input
            type="text"
            list="owner-ai-model-presets"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-5.4"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 font-mono focus:border-gray-500 focus:outline-none"
          />
          <datalist id="owner-ai-model-presets">
            {AI_MODEL_PRESETS.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-2">Reasoning mode</label>
          <div className="inline-flex rounded-lg border border-gray-700 p-0.5 bg-gray-950">
            <button
              type="button"
              onClick={() => setReasoningMode("instant")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                reasoningMode === "instant"
                  ? "bg-white text-gray-950"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Instant
            </button>
            <button
              type="button"
              onClick={() => setReasoningMode("thinking")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                reasoningMode === "thinking"
                  ? "bg-white text-gray-950"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Thinking
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            {modelSupportsReasoning(model)
              ? reasoningMode === "instant"
                ? "Minimal internal reasoning — faster, lower cost."
                : "Deeper internal reasoning — slower, often higher quality."
              : "Reasoning mode applies to GPT-5 and o-series models only; ignored for this model."}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-white mb-1">Product context</h2>
          <p className="text-xs text-gray-500 mb-3">
            Prepended to every student-facing AI system prompt. Describe what Bowl Beacon is and
            who it serves.
          </p>
          <textarea
            value={settings.aiProductContext}
            onChange={(e) =>
              setSettings((s) => ({ ...s, aiProductContext: e.target.value }))
            }
            rows={4}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none resize-y"
            maxLength={4000}
          />
        </div>

        <div>
          <h2 className="text-sm font-semibold text-white mb-1">Global AI style</h2>
          <p className="text-xs text-gray-500 mb-3">
            Appended to all features after the base prompt — tone, depth, formatting.
          </p>
          <textarea
            value={settings.aiOwnerStyle}
            onChange={(e) => setSettings((s) => ({ ...s, aiOwnerStyle: e.target.value }))}
            rows={6}
            placeholder="e.g. Prefer short phrases. Always include one real-world example per concept."
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none resize-y"
            maxLength={8000}
          />
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-white">Per-feature instructions</h2>
          {FEATURE_HINTS.map(({ key, label, hint }) => (
            <div key={key}>
              <label className="text-xs text-gray-400 block mb-1">
                {label}{" "}
                <span className="text-gray-600 font-mono">({hint})</span>
              </label>
              <textarea
                value={settings[key]}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, [key]: e.target.value }))
                }
                rows={3}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none resize-y"
                maxLength={4000}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveAll()}
            disabled={saving}
            className="rounded-lg bg-white text-gray-950 px-4 py-2 text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save all settings (model + prompts)"}
          </button>
          {saveMsg && <span className="text-xs text-gray-400">{saveMsg}</span>}
        </div>
      </section>

      <section className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-6">
        <h2 className="text-sm font-semibold text-amber-200 mb-1">Owner AI copilot</h2>
        <p className="text-xs text-amber-200/70 mb-4">
          Context-aware assistant with product architecture loaded. Ask how features work, run{" "}
          <strong className="font-medium text-amber-200/90">Analyze &amp; suggest</strong> on
          production data, or request prompt refinements — proposals can be applied with one click.
          Messages are not stored.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => void analyzeAndSuggest()}
            disabled={chatting || analyzing}
            className="rounded-lg border border-amber-700/60 bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/60 disabled:opacity-50"
          >
            {analyzing ? "Analyzing production data…" : "Analyze & suggest"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (snapshotOpen) {
                setSnapshotOpen(false);
              } else if (insightsSummary) {
                setSnapshotOpen(true);
              } else {
                void loadSnapshot();
              }
            }}
            disabled={snapshotLoading || analyzing}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 disabled:opacity-50"
          >
            {snapshotLoading
              ? "Loading snapshot…"
              : snapshotOpen
                ? "Hide production snapshot"
                : "Show production snapshot"}
          </button>
        </div>
        {snapshotOpen && insightsSummary && (
          <div className="rounded-lg border border-gray-800 bg-gray-950/80 p-3 mb-3 text-xs text-gray-400 space-y-2">
            <p className="text-gray-300 font-medium">Production snapshot (30 days)</p>
            <p>
              AI calls: {insightsSummary.usageTotals30d.callCount.toLocaleString()} · Tokens:{" "}
              {insightsSummary.usageTotals30d.totalTokens.toLocaleString()}
            </p>
            <p>
              Stored content — notes: {insightsSummary.contentCounts.notes?.toLocaleString() ?? 0},
              quiz: {insightsSummary.contentCounts.quiz?.toLocaleString() ?? 0}, flashcards:{" "}
              {insightsSummary.contentCounts.flashcards?.toLocaleString() ?? 0}, velocity games:{" "}
              {insightsSummary.contentCounts["velocity-games"]?.toLocaleString() ?? 0}, velocity
              bank: {insightsSummary.contentCounts["velocity-bank"]?.toLocaleString() ?? 0}
            </p>
            <p>
              Velocity questions reported:{" "}
              {insightsSummary.reportedVelocityCount.toLocaleString()} · Recent AI client errors
              sampled: {insightsSummary.clientErrorCount}
            </p>
          </div>
        )}
        <div className="rounded-lg border border-gray-800 bg-gray-950 h-80 overflow-y-auto p-3 space-y-3 mb-3">
          {messages.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-8">
              Try: &quot;How does notes caching work?&quot; or &quot;Tighten quiz distractors for
              chemistry.&quot;
            </p>
          )}
          {messages.map((m, i) => {
            const displayContent =
              m.role === "assistant"
                ? stripOwnerAiProposalFromDisplay(m.content)
                : m.content;
            if (!displayContent && m.role === "assistant") return null;
            return (
              <div
                key={i}
                className={`text-sm rounded-lg px-3 py-2 max-w-[95%] whitespace-pre-wrap ${
                  m.role === "user"
                    ? "ml-auto bg-gray-800 text-gray-100"
                    : "mr-auto bg-gray-900 border border-gray-800 text-gray-300"
                }`}
              >
                {displayContent}
              </div>
            );
          })}
          {!pendingProposal &&
            messages.some(
              (m) =>
                m.role === "assistant" &&
                contentMentionsOwnerAiProposal(m.content) &&
                !parseOwnerAiProposal(m.content)
            ) && (
              <p className="text-xs text-amber-400/90">
                A settings proposal was mentioned but could not be parsed. Ask the copilot to
                resend valid JSON, or edit the textareas manually.
              </p>
            )}
          {proposalAppliedNotice && (
            <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 p-3 text-sm">
              <p className="text-emerald-300 font-medium">Changes applied</p>
              <p className="text-gray-400 text-xs mt-1">
                Owner AI settings were updated from the copilot proposal.
              </p>
            </div>
          )}
          {pendingProposal && !proposalAppliedNotice && (
            <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-3 text-sm">
              <p className="text-emerald-300 font-medium mb-2">Proposed settings change</p>
              <p className="text-gray-300 text-xs mb-2">{pendingProposal.summary}</p>
              <ul className="text-xs text-gray-400 mb-3 space-y-1">
                {Object.keys(pendingProposal.patches).map((k) => (
                  <li key={k}>
                    {PATCH_KEY_LABELS[k] ?? k}: {pendingProposal.patches[k].slice(0, 120)}
                    {pendingProposal.patches[k].length > 120 ? "…" : ""}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void applyProposal()}
                  disabled={applying}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {applying ? "Applying…" : "Apply changes"}
                </button>
                <button
                  type="button"
                  onClick={dismissProposal}
                  disabled={applying}
                  className="rounded-md border border-gray-600 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {(chatting || analyzing) && (
            <p className="text-xs text-gray-500 animate-pulse">
              {analyzing ? "Analyzing production data…" : "Thinking…"}
            </p>
          )}
          <div ref={bottomRef} />
        </div>
        {chatError && <p className="text-xs text-red-400 mb-2">{chatError}</p>}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void sendChat())}
            placeholder="Message…"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 focus:border-gray-500 focus:outline-none"
            disabled={chatting || analyzing}
          />
          <button
            type="button"
            onClick={() => void sendChat()}
            disabled={chatting || analyzing || !input.trim()}
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
            setPendingProposal(null);
            setProposalAppliedNotice(false);
            handledProposalIndicesRef.current.clear();
          }}
          className="mt-2 text-xs text-gray-500 hover:text-gray-400 underline"
        >
          Clear conversation
        </button>
      </section>
    </div>
  );
}
