/**
 * Reasoning-effort picker for the chat composer.
 *
 * Mirrors Claude Code's effort control: a small dropdown that selects how much
 * the agent should think before answering. `none` keeps the historical
 * behaviour (thinking suppressed); higher levels turn on extended thinking and
 * raise the model tier server-side (and hint the model for coding sub-agents).
 */
import { Brain } from "lucide-react";
import type { ChatEffort } from "../../state/ui-preferences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

const EFFORT_OPTIONS: ReadonlyArray<{ value: ChatEffort; label: string }> = [
  { value: "none", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const EFFORT_LABEL: Record<ChatEffort, string> = {
  none: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
};

interface EffortSelectorProps {
  value: ChatEffort;
  onChange: (value: ChatEffort) => void;
  disabled?: boolean;
}

export function EffortSelector({
  value,
  onChange,
  disabled,
}: EffortSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        data-testid="chat-effort-selector"
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted/80 hover:text-txt disabled:opacity-50 disabled:pointer-events-none"
        title="Reasoning effort"
      >
        <Brain className="h-3.5 w-3.5" aria-hidden />
        <span>Effort: {EFFORT_LABEL[value]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(next as ChatEffort)}
        >
          {EFFORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
