import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const navigationEvent = "scamcam:navigate";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(navigationEvent, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(navigationEvent, onChange);
  };
}

function currentPath(): string {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath, () => "/");
}

export function navigate(to: string): void {
  if (to === currentPath() && !window.location.hash) {
    return;
  }
  window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(navigationEvent));
  window.scrollTo(0, 0);
  document.getElementById("main")?.focus({ preventScroll: true });
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
}

export function Link({ to, onClick, ...props }: LinkProps) {
  return (
    <a
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && isPlainLeftClick(event) && to.startsWith("/")) {
          event.preventDefault();
          navigate(to);
        }
      }}
      {...props}
    />
  );
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title === "ScamCam" ? "ScamCam - Check the Scan" : `${title} | ScamCam`;
  }, [title]);
}
