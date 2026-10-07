import { useEffect, useRef } from "react";
import { turnstileAction } from "../../../shared/turnstile";

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoading: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) {
    return Promise.resolve();
  }
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error("turnstile_unavailable"));
    };
    document.head.append(script);
  });
  return scriptLoading;
}

export interface TurnstileWidgetProps {
  siteKey: string;
  action?: string;
  resetKey: number;
  onToken: (token: string | null) => void;
  onUnavailable: () => void;
}

export function TurnstileWidget({ siteKey, action = turnstileAction, resetKey, onToken, onUnavailable }: TurnstileWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onToken, onUnavailable });
  callbacks.current = { onToken, onUnavailable };

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) {
          return;
        }
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          action,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          size: "flexible",
          callback: (token: string) => callbacks.current.onToken(token),
          "expired-callback": () => callbacks.current.onToken(null),
          "error-callback": () => callbacks.current.onToken(null),
        });
      })
      .catch(() => callbacks.current.onUnavailable());
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [siteKey, action, resetKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
