/**
 * Names of the service worker's runtime caches, and which requests go to
 * them. Shared between the PWA config in vite.config.ts, which creates them,
 * and the app, which fills them with responses the service worker doesn't see
 * (install-mirror-retry.ts) and clears the user-specific one on logout. Keep
 * this file free of browser APIs: it is also compiled for Node as part of the
 * Vite config.
 */
export const CALENDAR_FEEDS_CACHE = "calendar-feeds";
export const MAPS_CACHE = "maps";

// The matchers are serialized into the service worker, so they must not
// reference anything outside themselves; they check the path only, so they
// work with any API host from the env.

/**
 * Calendar feeds (.ics, and external calendars proxied through
 * check-calendar-url-to-link), plus the schedule and when2meet requests the
 * calendar page builds its list of feed URLs from: without them, offline, it
 * doesn't know which feeds to show.
 */
export function isCalendarFeedUrl({ url }: { url: URL }) {
  return (
    url.pathname.endsWith(".ics") ||
    url.pathname.endsWith("/check-calendar-url-to-link") ||
    /\/schedule\/v\d+\/(users\/me|users\/me\/predefined|event-groups\/)$/.test(
      url.pathname,
    ) ||
    /\/when2meet\/v\d+\/meetings\/(participating)?$/.test(url.pathname)
  );
}

/**
 * Maps: the scene list and the floor plan SVGs.
 */
export function isMapsUrl({ url }: { url: URL }) {
  return /\/maps\/v\d+\/(scenes\/?|static\/.+\.svg)$/.test(url.pathname);
}
