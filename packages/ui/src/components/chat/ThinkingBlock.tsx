/**
 * Collapsible, dimmed reasoning display for chat bubbles.
 *
 * Renders a model's thinking/reasoning (extracted from `<think>`/`<reasoning>`
 * blocks in the streamed message, or accumulated from a coding sub-agent's ACP
 * `agent_thought_chunk` updates) as a quiet, collapsed-by-default panel — the
 * way Claude Code surfaces extended thinking. The reasoning never appears in the
 * user-facing answer text; it lives only inside this block.
 */
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

interface ThinkingBlockProps {
  content: string;
  /** When true, the panel renders open. Defaults to collapsed. */
  defaultOpen?: boolean;
  /** When true, reasoning is still arriving (unclosed `<think>` during stream). */
  streaming?: boolean;
  label?: string;
}

export function ThinkingBlock({
  content,
  defaultOpen = false,
  streaming = false,
  label = "Thinking",
}: ThinkingBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const trimmed = content.trim();
  if (!trimmed && !streaming) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-2 border border-border/40 rounded-sm bg-muted/5 overflow-hidden"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-3 py-1 text-xs font-mono text-muted/70 uppercase tracking-wider hover:text-muted transition-colors">
        <span
          className="transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          ▸
        </span>
        <span>{streaming ? `${label}…` : label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words text-muted/60 m-0 overflow-x-auto">
          {trimmed}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
