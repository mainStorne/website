import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import remarkGfm from "remark-gfm";
// @ts-expect-error The plugin is not typed
import veauryVitePlugins from "veaury/vite/esm/index.mjs";
import { defineConfig, loadEnv } from "vite";
import { ViteMinifyPlugin } from "vite-plugin-minify";
import mkcert from "vite-plugin-mkcert";
import { VitePWA } from "vite-plugin-pwa";
import { sri } from "vite-plugin-sri3";
import { fileURLToPath, URL } from "node:url";
import { version } from "./package.json";
import {
  parseProxyHosts,
  PROXY_FALLBACK_SCRIPT,
  proxyFallbackScript,
} from "./src/app/sw-proxy-fallback.ts";
import {
  CALENDAR_FEEDS_CACHE,
  isCalendarFeedUrl,
  isMapsUrl,
  MAPS_CACHE,
} from "./src/app/sw-runtime-caches.ts";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  // Retry requests through a mirror when the network blocks the original host
  const proxyHosts = parseProxyHosts(env.VITE_PROXY_HOSTS);
  const proxiedHostsPattern = Object.keys(proxyHosts)
    .map((host) => host.replaceAll(".", "\\."))
    .join("|");
  const proxiedUrlPattern = proxiedHostsPattern
    ? new RegExp(`^https://(?:${proxiedHostsPattern})/`)
    : undefined;

  return {
    plugins: [
      // HTTPS support in development
      mkcert({
        hosts: ["local.innohassle.ru"],
      }),

      // Enable routing via TanStack Router
      tanstackRouter({
        routesDirectory: "src/app/routes",
        generatedRouteTree: "src/app/route-tree.gen.ts",
        quoteStyle: "double",
        semicolons: true,
      }),

      // TailwindCSS support
      tailwindcss(),

      // Support for React and Vue in one project
      veauryVitePlugins({
        type: "react",
        // Configuration of @vitejs/plugin-react
        // reactOptions: {...},
        // Configuration of @vitejs/plugin-vue
        // vueOptions: {...},
        // Configuration of @vitejs/plugin-vue-jsx
        // vueJsxOptions: {...}
      }),

      // MDX support
      mdx({
        remarkPlugins: [remarkGfm],
      }),

      // Script with the mirror fallback, loaded by the service worker
      proxiedUrlPattern && proxyFallbackScript(proxyHosts),

      // Offline mode via PWA
      VitePWA({
        registerType: "prompt",
        workbox: {
          globPatterns: ["**/*.{js,css,html,json,svg,png,woff2}"],
          navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/assets\//],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
          importScripts: proxiedUrlPattern ? [PROXY_FALLBACK_SCRIPT] : [],
          // Take control of the open page as soon as the first service worker
          // activates, so its requests get the mirror fallback without a
          // reload. Updates still wait for the prompt (no skipWaiting).
          clientsClaim: true,
          // API responses kept for instant loads and offline use. The matchers
          // are in sw-runtime-caches.ts.
          runtimeCaching: [
            {
              // Network first: a changed timetable must win whenever there is a
              // connection; the cached copy is used offline or when the network
              // is slower than the timeout.
              urlPattern: isCalendarFeedUrl,
              handler: "NetworkFirst",
              options: {
                cacheName: CALENDAR_FEEDS_CACHE,
                networkTimeoutSeconds: 3,
                cacheableResponse: { statuses: [200] },
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                },
              },
            },
            {
              // Maps rarely change, so serve the cached copy at once and
              // refresh it in the background for the next visit.
              urlPattern: isMapsUrl,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: MAPS_CACHE,
                cacheableResponse: { statuses: [200] },
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                },
              },
            },
            // Every other retry to a host with a mirror, of any method: routed
            // through the service worker only so its fetch sends it to the
            // mirror; nothing is cached.
            ...(proxiedUrlPattern
              ? (["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map(
                  (method) => ({
                    urlPattern: proxiedUrlPattern,
                    method,
                    handler: "NetworkOnly" as const,
                  }),
                )
              : []),
          ],
        },
        manifest: false, // Manifest is already in public/manifest.json
        includeManifestIcons: true,
        includeAssets: "*",
      }),

      // Minify the index.html
      ViteMinifyPlugin({}),

      // Subresource Integrity for built JS/CSS in index.html
      sri(),
    ],

    server: {
      hmr: {
        host: "local.innohassle.ru",
      },
    },

    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },

    define: {
      // Inject the app version variable
      __VERSION__: JSON.stringify(version),
    },
  };
});
