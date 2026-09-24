import { registerSW } from "virtual:pwa-register";
import { queryClient } from "./query-client.ts";
import { repairPoisonedPrecache } from "./sw-cache-repair.ts";

export const appUpdateAvailableEvent = "app-update-available";

export function registerServiceWorker() {
  // On the first visit, requests start before the service worker controls the
  // page, so they miss its mirror fallback and fail if the API host is
  // blocked. Once it takes control, redo the failed ones and the ones still
  // in flight (a blocked connection can take seconds to fail). In-flight ones
  // are cancelled first: without data yet, a refetch would just reuse the
  // pending attempt.
  navigator.serviceWorker?.addEventListener("controllerchange", async () => {
    const queriesToRedo = queryClient.getQueryCache().findAll({
      predicate: (query) =>
        query.state.status === "error" ||
        query.state.fetchStatus === "fetching",
    });
    const filters = {
      predicate: (query: (typeof queriesToRedo)[number]) =>
        queriesToRedo.includes(query),
    };
    await queryClient.cancelQueries(filters);
    await queryClient.refetchQueries(filters);
  });

  // Enable offline support via PWA service worker
  const updateServiceWorker = registerSW({
    onNeedRefresh() {
      window.dispatchEvent(
        new CustomEvent(appUpdateAvailableEvent, {
          detail: {
            reload: () => updateServiceWorker(true),
          },
        }),
      );
    },
    onRegisteredSW(swUrl, r) {
      if (r === undefined) return;

      void repairPoisonedPrecache(r);

      // Check for updates periodically
      // https://vite-pwa-org.netlify.app/guide/periodic-sw-updates.html
      async function checkUpdate() {
        if (r === undefined || r.installing || !navigator) return;

        // Do not try to update service worker if offline
        if ("connection" in navigator && !navigator.onLine) return;

        const resp = await fetch(swUrl, {
          cache: "no-store",
          headers: {
            cache: "no-store",
            "cache-control": "no-cache",
          },
        });

        if (resp?.status === 200) await r.update();
      }

      // Check after page load
      checkUpdate();

      // Check every 30 minutes
      setInterval(checkUpdate, 30 * 60 * 1000);

      // Trigger update check on page focus
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          void repairPoisonedPrecache(r);
          void checkUpdate();
        }
      });
    },
  });
}
