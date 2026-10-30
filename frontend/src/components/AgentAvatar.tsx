import { Bot } from "lucide-react";

const SIZES = {
  sm: { circle: "h-5 w-5", icon: "h-3 w-3" },
  md: { circle: "h-6 w-6", icon: "h-3.5 w-3.5" },
} as const;

interface AgentAvatarProps {
  name: string;
  size?: keyof typeof SIZES;
}

/** Avatar for an Autopilot agent, shown wherever a person's avatar would be. */
export function AgentAvatar({ name, size = "sm" }: AgentAvatarProps) {
  const { circle, icon } = SIZES[size];
  return (
    <span title={name} className={`flex ${circle} shrink-0 items-center justify-center rounded-full bg-linear-to-br from-sky-500 to-blue-700 text-white ring-2 ring-black/40`}>
      <Bot className={icon} aria-hidden="true" />
    </span>
  );
}
