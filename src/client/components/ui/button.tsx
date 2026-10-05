import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[3px] font-mono text-sm font-medium uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:bg-accent-strong",
        outline: "border border-rule-strong bg-transparent text-ink hover:bg-panel-2",
        ghost: "bg-transparent text-ink-soft hover:bg-panel-2 hover:text-ink",
      },
      size: {
        md: "h-11 px-5",
        sm: "h-8 px-3 text-xs",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
