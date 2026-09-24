/**
 * Retries requests through a mirror (proxy) host when the user's network
 * blocks the original host by IP. Such a block shows up as a reset connection
 * (NS_ERROR_NET_RESET in Firefox, ERR_CONNECTION_CLOSED/RESET in Chrome),
 * which makes `fetch` reject with a TypeError.
 *
 * The page sends every request to the original host itself, and the service
 * worker lets it through untouched. Only when that fails does the page retry
 * it with the MIRROR_RETRY_HEADER header (see install-mirror-retry.ts); the
 * service worker sends such retries to the mirror and answers with the
 * mirror's response as if it came from the original host. Nothing is
 * remembered between requests.
 *
 * Keep this file free of browser APIs at the top level: it is compiled for
 * Node as part of the Vite config.
 */

// Name of the script the service worker loads with importScripts
export const PROXY_FALLBACK_SCRIPT = "sw-proxy-fallback.js";

// Marks the page's retry of a request that failed on the original host. Only
// travels from the page to the service worker, never to a server.
export const MIRROR_RETRY_HEADER = "X-Mirror-Retry";

/**
 * Runs in the service worker, from its source text, so it must not reference
 * anything outside itself. It is loaded before Workbox sets up its routes, so
 * its fetch listener runs first.
 */
function installProxyFallback(
  proxyHosts: Record<string, string>,
  retryHeader: string,
) {
  // Casts: Node's types, used by the Vite config, lack these worker globals
  const scope = globalThis as unknown as {
    location: { href: string };
    addEventListener(
      type: "fetch",
      listener: (event: Event & { request: Request }) => void,
    ): void;
  };
  const directFetch = globalThis.fetch.bind(globalThis);

  // The page's own attempt at a host with a mirror: keep Workbox from
  // handling it, so the browser sends it as a plain request from the page.
  scope.addEventListener("fetch", (event) => {
    const { host } = new URL(event.request.url);
    if (!(host in proxyHosts)) return;
    if (event.request.headers.has(retryHeader)) return;
    event.stopImmediatePropagation();
  });

  async function toProxyRequest(request: Request, proxyHost: string) {
    const url = new URL(request.url);
    url.host = proxyHost;
    const headers = new Headers(request.headers);
    headers.delete(retryHeader);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    return new Request(url, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      // Keep no-cors as it is, so the mirror needs no CORS for such requests
      mode: request.mode === "navigate" ? "cors" : request.mode,
      credentials: request.credentials,
      cache: request.cache,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
    });
  }

  // A response fetched from the mirror exposes the mirror's URL as
  // `response.url`; a copy has none, so the page sees the URL it asked for.
  // Opaque (no-cors) responses can't be copied, but their URL is hidden from
  // the page anyway.
  function asOriginalResponse(response: Response) {
    if (response.type === "opaque" || response.type === "opaqueredirect") {
      return response;
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  // Workbox strategies call the global fetch for every network request, so
  // marked retries reach the mirror on every route, and the caches store the
  // mirror's response under the original URL.
  globalThis.fetch = async function fetchWithProxyFallback(
    input: Request | string | URL,
    init?: RequestInit,
  ) {
    const request = new Request(input, init);
    const proxyHost = proxyHosts[new URL(request.url).host];
    if (!proxyHost || !request.headers.has(retryHeader)) {
      return directFetch(request);
    }
    const proxyRequest = await toProxyRequest(request, proxyHost);
    return asOriginalResponse(await directFetch(proxyRequest));
  };
}

/**
 * Vite plugin that emits PROXY_FALLBACK_SCRIPT with the host map built in.
 */
export function proxyFallbackScript(proxyHosts: Record<string, string>) {
  return {
    name: "proxy-fallback-script",
    apply: "build" as const,
    // Typed by hand: importing Vite's types would pull Node's into the app
    generateBundle(this: {
      emitFile(file: {
        type: "asset";
        fileName: string;
        source: string;
      }): string;
    }) {
      const args = [proxyHosts, MIRROR_RETRY_HEADER].map((arg) =>
        JSON.stringify(arg),
      );
      this.emitFile({
        type: "asset",
        fileName: PROXY_FALLBACK_SCRIPT,
        source: `(${installProxyFallback.toString()})(${args.join(", ")});\n`,
      });
    },
  };
}

/**
 * Parses `VITE_PROXY_HOSTS`: comma-separated `original=mirror` host pairs.
 */
export function parseProxyHosts(value: string | undefined) {
  const pairs = (value ?? "")
    .split(",")
    .map((pair) => pair.split("=").map((host) => host.trim()))
    .filter(([from, to]) => from && to);
  return Object.fromEntries(pairs) as Record<string, string>;
}
