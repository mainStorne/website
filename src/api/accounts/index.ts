import { accountsApiAvailabilityMiddleware } from "@/api/accounts/api-availability.ts";
import { userAuthMiddleware } from "@/api/helpers/auth-middleware.ts";
import createQueryClient from "@/api/helpers/create-query-client";
import createFetchClient from "@/api/helpers/create-fetch-client";
import * as accountsTypes from "./types.ts";

export type { accountsTypes };

export const accountsFetch = createFetchClient<accountsTypes.paths>({
  baseUrl: import.meta.env.VITE_ACCOUNTS_API_URL,
  credentials: "include",
});
accountsFetch.use(accountsApiAvailabilityMiddleware);
// The session cookie isn't sent to the mirror host (see sw-proxy-fallback.ts),
// so the access token in the header keeps the user signed in there.
accountsFetch.use(userAuthMiddleware);
export const $accounts = createQueryClient(accountsFetch, "accounts");
