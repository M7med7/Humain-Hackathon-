import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowUp, Bot, Loader2, Sparkles, User } from "lucide-react";
import type { ConversationMessage } from "../lib/api";

interface PlanRefinementPanelProps {
  messages: ConversationMessage[];
  isRefining: boolean;
  onSend: (message: string) => void;
}

const QUICK_ACTIONS = [
  { label: "Add testing", message: "Add comprehensive unit and integration testing tasks before deployment" },
  { label: "Add deployment", message: "Add a complete deployment and release phase with CI/CD pipeline tasks" },
  { label: "Simplify", message: "Simplify the plan to include only the most essential tasks" },
  { label: "Compress timeline", message: "Compress the timeline by 25% while keeping all key phases" },
  { label: "Balance workload", message: "Rebalance task assignments so no single person carries more than 50% of the work" },
  { label: "Add risk tasks", message: "Add risk assessment, mitigation, and contingency planning tasks" },
  { label: "Add planning phase", message: "Add a requirements gathering and planning phase at the beginning" },
];

function MessageBubble({ msg }: { msg: ConversationMessage }) {
  const isUser = msg.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${isUser ? 'bg-purple-600' : 'bg-white/10 border border-white/15'
        }`}>
        {isUser
          ? <User className="w-3.5 h-3.5 text-white" />
          : <Bot className="w-3.5 h-3.5 text-gray-300" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${isUser
        ? 'bg-purple-700/60 text-purple-50 rounded-tr-sm'
        : 'bg-white/6 border border-white/10 text-gray-200 rounded-tl-sm'
        }`}>
        {msg.content}
      </div>
    </motion.div>
  );
}

export function PlanRefinementPanel({ messages, isRefining, onSend }: PlanRefinementPanelProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isRefining]);

  const submit = () => {
    const msg = input.trim();
    if (!msg || isRefining) return;
    setInput('');
    onSend(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-semibold text-gray-300">Refine with AI</span>
        <span className="text-xs text-gray-600">— ask for any change in plain language</span>
      </div>

      {/* Message history */}
      {messages.length > 0 && (
        <div className="rounded-2xl border border-white/8 bg-white/2 p-4 space-y-3 max-h-64 overflow-y-auto">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          {isRefining && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-3"
            >
              <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-white/10 border border-white/15">
                <Bot className="w-3.5 h-3.5 text-gray-300" />
              </div>
              <div className="bg-white/6 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-2.5 flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Refining your plan...
              </div>
            </motion.div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Quick action chips */}
      {!isRefining && (
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onSend(action.message)}
              disabled={isRefining}
              className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/4 text-gray-400 hover:border-purple-500/40 hover:bg-purple-900/20 hover:text-purple-200 transition-all duration-150"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRefining}
          rows={2}
          placeholder="e.g. Add a deployment phase, assign backend tasks to Ahmed, reduce timeline to 4 weeks…"
          className="flex-1 px-4 py-3 bg-white/5 border border-white/15 rounded-2xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 resize-none disabled:opacity-40 transition-colors leading-relaxed"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!input.trim() || isRefining}
          className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${input.trim() && !isRefining
            ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/30'
            : 'bg-white/5 text-gray-600 cursor-not-allowed'
            }`}
        >
          {isRefining
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <ArrowUp className="w-4 h-4" />}
        </button>
      </div>

      <p className="text-[11px] text-gray-600">
        Enter to send · Shift+Enter for new line · Changes are shown as a preview before applying
      </p>
    </div>
  );
}
