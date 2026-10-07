import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-36 w-full resize-y rounded-[3px] border border-rule-strong bg-bg px-3.5 py-3 font-mono text-[0.95rem] leading-relaxed text-ink placeholder:text-ink-faint focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
