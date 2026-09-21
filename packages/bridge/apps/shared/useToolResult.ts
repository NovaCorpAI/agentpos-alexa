/**
 * Connects a view to its host and exposes the latest tool result's structured content,
 * the host theme and the display mode. Views never fetch anything themselves: everything
 * they show arrived in the tool result, which keeps them honest about prices and stock.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useEffect, useState } from "react";
import { langOf, words, type ViewLang } from "./strings";

export interface ViewState<T> {
  app: App | null;
  data: T | null;
  isError: boolean;
  theme: "light" | "dark";
  displayMode: string;
  /** The customer's language, as the host reports it. */
  lang: ViewLang;
  /** The view's own fixed words in that language. */
  t: ReturnType<typeof words>;
}

export function useToolResult<T>(name: string): ViewState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isError, setIsError] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [displayMode, setDisplayMode] = useState("inline");
  const [lang, setLang] = useState<ViewLang>("en");

  const { app } = useApp({
    appInfo: { name: `agentpos-alexa:${name}`, version: "0.0.1" },
    capabilities: {},
    onAppCreated: (a) => {
      a.ontoolresult = (result) => {
        setIsError(result.isError === true);
        setData((result.structuredContent as T | undefined) ?? null);
      };
      a.onhostcontextchanged = (ctx) => {
        if (ctx.theme) setTheme(ctx.theme === "dark" ? "dark" : "light");
        if (ctx.displayMode) setDisplayMode(ctx.displayMode);
        if (ctx.locale) setLang(langOf(ctx.locale));
      };
    },
  });

  useEffect(() => {
    const ctx = app?.getHostContext();
    if (ctx?.theme) setTheme(ctx.theme === "dark" ? "dark" : "light");
    if (ctx?.displayMode) setDisplayMode(ctx.displayMode);
    if (ctx?.locale) setLang(langOf(ctx.locale));
  }, [app]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return { app, data, isError, theme, displayMode, lang, t: words(lang) };
}
