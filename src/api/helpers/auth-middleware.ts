import {
  getMyAccessToken,
  invalidateMyAccessToken,
} from "@/api/helpers/access-token.ts";
import { Middleware } from "@/api/helpers/create-fetch-client";
import {
  getRoomTvAccessToken,
  invalidateRoomTvAccessToken,
  isRoomTvPage,
} from "@/api/helpers/room-tv-auth.ts";

function getAccessTokenForRequest() {
  if (isRoomTvPage()) {
    return getRoomTvAccessToken();
  }
  return getMyAccessToken();
}

function createAuthMiddleware(getAccessToken: () => string | null): Middleware {
  return {
    async onRequest({ request }) {
      // Check the requested URL to add token only to our API
      if (
        !request.url.startsWith("https://api.innohassle.ru/") &&
        !request.url.startsWith("http://localhost") &&
        !request.url.startsWith("https://local.innohassle.ru")
      )
        return;

      const token = getAccessToken();
      if (token) {
        const newRequest = request.clone();
        newRequest.headers.set("Authorization", `Bearer ${token}`);
        return newRequest;
      }
      return request;
    },
    async onResponse({ request, response }) {
      // Check the final URL to ensure we are handling only our API
      if (
        !response.url.startsWith("https://api.innohassle.ru/") &&
        !response.url.startsWith("http://localhost") &&
        !response.url.startsWith("https://local.innohassle.ru")
      )
        return;

      if (response.status === 401 && request.headers.has("Authorization")) {
        const authHeader = request.headers.get("Authorization");
        const roomTvToken = getRoomTvAccessToken();
        if (roomTvToken && authHeader === `Bearer ${roomTvToken}`) {
          console.log(
            "[room-tv-auth] Got 401, invalidating room TV access token",
          );
          invalidateRoomTvAccessToken();
        } else {
          console.log("[auth] Got 401, invalidating access token");
          invalidateMyAccessToken();
        }
        throw new Error("Unauthorized");
      }
      return response;
    },
  };
}

export const authMiddleware = createAuthMiddleware(getAccessTokenForRequest);

// Accounts always acts for the user: a room TV token would get a 401 there and
// be invalidated, logging the TV out.
export const userAuthMiddleware = createAuthMiddleware(getMyAccessToken);
