/**
 * Page half of the mirror fallback (see sw-proxy-fallback.ts). Requests to a
 * host with a mirror go to that host as usual; when one fails with a network
 * error (the host is blocked, or we are offline), it is sent again marked with
 * MIRROR_RETRY_HEADER, and the service worker answers it from the mirror or,
 * offline, from its cache. The caller gets that response as if it came from
 * the original host.
 *
 * Wraps the global `fetch` on import: import this module before anything that
 * keeps a reference to `fetch`, such as the API clients.
 */
import { MIRROR_RETRY_HEADER, parseProxyHosts } from "./sw-proxy-fallback.ts";
import {
  CALENDAR_FEEDS_CACHE,
  isCalendarFeedUrl,
  isMapsUrl,
  MAPS_CACHE,
} from "./sw-runtime-caches.ts";

const proxyHosts = parseProxyHosts(import.meta.env.VITE_PROXY_HOSTS);

if (Object.keys(proxyHosts).length > 0 && "serviceWorker" in navigator) {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function fetchWithMirrorRetry(
    input: Request | string | URL,
    init?: RequestInit,
  ) {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (!(url.host in proxyHosts)) return originalFetch(input, init);

    const request = new Request(input, init);
    // Keep an unconsumed copy: the first attempt uses up the body
    const retryRequest = request.clone();
    try {
      const response = await originalFetch(request);
      storeForOffline(request, response);
      return response;
    } catch (error) {
      // Aborted, or no service worker to answer the retry
      if (!(error instanceof TypeError)) throw error;
      if (!navigator.serviceWorker.controller) throw error;

      const headers = new Headers(retryRequest.headers);
      headers.set(MIRROR_RETRY_HEADER, "1");
      try {
        return await originalFetch(new Request(retryRequest, { headers }));
      } catch {
        throw error;
      }
    }
  };
}

/**
 * The service worker doesn't see requests that reach the original host, so
 * put their responses in its caches here, for offline use.
 */
function storeForOffline(request: Request, response: Response) {
  if (typeof caches === "undefined") return;
  if (request.method !== "GET" || response.status !== 200) return;

  const url = new URL(request.url);
  const cacheName = isCalendarFeedUrl({ url })
    ? CALENDAR_FEEDS_CACHE
    : isMapsUrl({ url })
      ? MAPS_CACHE
      : undefined;
  if (!cacheName) return;

  const responseCopy = response.clone();
  void caches
    .open(cacheName)
    .then((cache) => cache.put(request.url, responseCopy));
}
