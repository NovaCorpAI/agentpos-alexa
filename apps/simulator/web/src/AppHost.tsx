/**
 * Hosts one MCP Apps view in a sandboxed iframe through the official AppBridge, the same
 * way Alexa+ or any other host would. The Simulator only forwards the tool result and
 * relays what the view asks: a message to the assistant, a display mode change, a resize.
 */
import { PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { useEffect, useRef, useState } from "react";
import type { ToolResult } from "./api";
import { turnLangOf, useLang } from "./i18n";

export type DisplayMode = "inline" | "fullscreen";

export interface AppHostProps {
  html: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  result: ToolResult;
  theme: "light" | "dark";
  displayMode: DisplayMode;
  width: number;
  /** Fired when the view sends a user message (a tap on a card). */
  onMessage: (text: string) => void;
  onRequestDisplayMode: (mode: DisplayMode) => void;
  /** Timing hooks for the inspection summary. */
  onInitialized: () => void;
}

export function AppHost(props: AppHostProps) {
  const [uiLang] = useLang();
  // The host tells the view which language its few fixed words should be in.
  const locale = turnLangOf(uiLang);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const [height, setHeight] = useState(props.displayMode === "fullscreen" ? 560 : 300);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let disposed = false;
    const bridge = new AppBridge(
      null,
      { name: "agentpos-alexa-simulator", version: "0.0.1" },
      { openLinks: {}, logging: {} },
      {
        hostContext: {
          theme: props.theme,
          displayMode: props.displayMode,
          availableDisplayModes: ["inline", "fullscreen"],
          containerDimensions: { width: props.width, height, maxHeight: props.displayMode === "fullscreen" ? 800 : 360 },
          locale,
        },
      },
    );
    bridge.oninitialized = () => {
      if (disposed) return;
      props.onInitialized();
      void bridge.sendToolInput({ arguments: props.toolArguments });
      void bridge.sendToolResult(props.result as Parameters<AppBridge["sendToolResult"]>[0]);
    };
    bridge.onmessage = async (params) => {
      const text = params.content.map((c) => (c.type === "text" ? (c as { text: string }).text : "")).join(" ").trim();
      if (text) props.onMessage(text);
      return {};
    };
    bridge.onrequestdisplaymode = async (params) => {
      const mode = params.mode === "fullscreen" ? "fullscreen" : "inline";
      props.onRequestDisplayMode(mode);
      return { mode };
    };
    bridge.onsizechange = (params) => {
      if (typeof params.height === "number") setHeight(Math.min(Math.max(120, Math.ceil(params.height) + 16), 800));
    };
    bridge.onopenlink = async () => ({});
    bridge.onloggingmessage = () => undefined;
    bridgeRef.current = bridge;

    const onLoad = () => {
      if (disposed || !iframe.contentWindow) return;
      void bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
    };
    iframe.addEventListener("load", onLoad);
    iframe.srcdoc = props.html;
    return () => {
      disposed = true;
      iframe.removeEventListener("load", onLoad);
      void bridge.close().catch(() => undefined);
      bridgeRef.current = null;
    };
    // The view is rebuilt for a new result; theme and mode changes go through setHostContext below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.html, props.result]);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.setHostContext({
      theme: props.theme,
      displayMode: props.displayMode,
      availableDisplayModes: ["inline", "fullscreen"],
      containerDimensions: { width: props.width, height, maxHeight: props.displayMode === "fullscreen" ? 800 : 360 },
      locale,
    });
  }, [props.theme, props.displayMode, props.width, height, locale]);

  return (
    <iframe
      ref={iframeRef}
      title={`${props.toolName} view`}
      className="app-view"
      sandbox="allow-scripts"
      style={{ width: "100%", height, border: 0, background: "transparent" }}
    />
  );
}
