/**
 * MCP Apps views the Bridge serves as ui:// resources (extension io.modelcontextprotocol/ui,
 * spec 2026-01-26). Each view is one self-contained HTML file built from apps/<view>/ by
 * `pnpm --filter @agentpos-alexa/bridge build:apps` and committed under dist/, so the Bridge
 * runs with no build step. The host (Alexa+, or the Simulator) renders it in a sandboxed
 * iframe and forwards the tool result; the view never fetches anything itself.
 */
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

export type ViewName = "carousel" | "item-card";

const dist = new URL("./dist/", import.meta.url);

function load(view: ViewName): string {
  return readFileSync(new URL(`${view}/index.html`, dist), "utf8");
}

export const APP_VIEWS: Record<ViewName, { uri: string; title: string; description: string; html: string }> = {
  carousel: {
    uri: "ui://agentpos-alexa/carousel.html",
    title: "Item carousel",
    description: "Three to five items from search_items: image, title, exact price, gluten-free badge. Tap asks about the item.",
    html: load("carousel"),
  },
  "item-card": {
    uri: "ui://agentpos-alexa/item-card.html",
    title: "Item card",
    description: "One item from get_item: description, price, allergens, ingredients, weight. One action: buy.",
    html: load("item-card"),
  },
};

export interface AppViewOptions {
  /** Origins the views may load images from: the Store's own site. */
  imageOrigins: string[];
}

/** Registers every view on a server, with a CSP that only allows the Store's images. */
export function registerAppViews(server: McpServer, opts: AppViewOptions): void {
  for (const view of Object.values(APP_VIEWS)) {
    registerAppResource(server, view.title, view.uri, { description: view.description, mimeType: RESOURCE_MIME_TYPE }, async () => ({
      contents: [
        {
          uri: view.uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: view.html,
          _meta: { ui: { csp: { resourceDomains: opts.imageOrigins, connectDomains: [] }, prefersBorder: false } },
        },
      ],
    }));
  }
}
