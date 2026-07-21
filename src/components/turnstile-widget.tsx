"use client";

import Script from "next/script";
import { useCallback, useEffect, useId, useRef } from "react";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileWidget({ onTokenChange, resetKey, siteKey }: { onTokenChange: (token: string) => void; resetKey: number; siteKey?: string | null }) {
  const id = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);

  const renderWidget = useCallback(() => {
    if (!siteKey || !window.turnstile || !containerRef.current || widgetRef.current) return;
    widgetRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "light",
      size: "flexible",
      callback: (token: string) => onTokenChange(token),
      "expired-callback": () => onTokenChange(""),
      "error-callback": () => onTokenChange(""),
    });
  }, [onTokenChange, siteKey]);

  useEffect(() => {
    if (!widgetRef.current || !window.turnstile) return;
    onTokenChange("");
    window.turnstile.reset(widgetRef.current);
  }, [onTokenChange, resetKey]);

  useEffect(() => () => {
    if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
    widgetRef.current = null;
  }, []);

  if (!siteKey) return null;
  return <div className="turnstile-wrap"><Script id={`turnstile-${id}`} src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={renderWidget} /><div ref={containerRef} /></div>;
}
