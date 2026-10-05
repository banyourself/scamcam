export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path d="M3 10V3h7M22 3h7v7M29 22v7h-7M10 29H3v-7" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="16" cy="16" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="16" cy="16" r="2.6" fill="currentColor" />
    </svg>
  );
}
