/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as clients from "../clients.js";
import type * as email from "../email.js";
import type * as entries from "../entries.js";
import type * as entryTags from "../entryTags.js";
import type * as errors from "../errors.js";
import type * as google from "../google.js";
import type * as healthcheck from "../healthcheck.js";
import type * as http from "../http.js";
import type * as import_ from "../import.js";
import type * as invoices from "../invoices.js";
import type * as lib_brand from "../lib/brand.js";
import type * as lib_codes from "../lib/codes.js";
import type * as lib_day from "../lib/day.js";
import type * as lib_docs from "../lib/docs.js";
import type * as lib_duration from "../lib/duration.js";
import type * as lib_entryFilter from "../lib/entryFilter.js";
import type * as lib_entryTimes from "../lib/entryTimes.js";
import type * as lib_invoiceLines from "../lib/invoiceLines.js";
import type * as lib_invoiceMath from "../lib/invoiceMath.js";
import type * as lib_invoiceNumber from "../lib/invoiceNumber.js";
import type * as lib_labels from "../lib/labels.js";
import type * as lib_logo from "../lib/logo.js";
import type * as lib_money from "../lib/money.js";
import type * as lib_palette from "../lib/palette.js";
import type * as lib_party from "../lib/party.js";
import type * as lib_scan from "../lib/scan.js";
import type * as lib_timeOfDay from "../lib/timeOfDay.js";
import type * as maintenance from "../maintenance.js";
import type * as migrations from "../migrations.js";
import type * as owned from "../owned.js";
import type * as projects from "../projects.js";
import type * as settings from "../settings.js";
import type * as tags from "../tags.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  clients: typeof clients;
  email: typeof email;
  entries: typeof entries;
  entryTags: typeof entryTags;
  errors: typeof errors;
  google: typeof google;
  healthcheck: typeof healthcheck;
  http: typeof http;
  import: typeof import_;
  invoices: typeof invoices;
  "lib/brand": typeof lib_brand;
  "lib/codes": typeof lib_codes;
  "lib/day": typeof lib_day;
  "lib/docs": typeof lib_docs;
  "lib/duration": typeof lib_duration;
  "lib/entryFilter": typeof lib_entryFilter;
  "lib/entryTimes": typeof lib_entryTimes;
  "lib/invoiceLines": typeof lib_invoiceLines;
  "lib/invoiceMath": typeof lib_invoiceMath;
  "lib/invoiceNumber": typeof lib_invoiceNumber;
  "lib/labels": typeof lib_labels;
  "lib/logo": typeof lib_logo;
  "lib/money": typeof lib_money;
  "lib/palette": typeof lib_palette;
  "lib/party": typeof lib_party;
  "lib/scan": typeof lib_scan;
  "lib/timeOfDay": typeof lib_timeOfDay;
  maintenance: typeof maintenance;
  migrations: typeof migrations;
  owned: typeof owned;
  projects: typeof projects;
  settings: typeof settings;
  tags: typeof tags;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};
