/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activityEvents from "../activityEvents.js";
import type * as aiReviewActions from "../aiReviewActions.js";
import type * as aiReviews from "../aiReviews.js";
import type * as auth from "../auth.js";
import type * as branches from "../branches.js";
import type * as comments from "../comments.js";
import type * as commits from "../commits.js";
import type * as debugOrg from "../debugOrg.js";
import type * as github from "../github.js";
import type * as http from "../http.js";
import type * as issues from "../issues.js";
import type * as labels from "../labels.js";
import type * as members from "../members.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as prReviews from "../prReviews.js";
import type * as projects from "../projects.js";
import type * as pullRequests from "../pullRequests.js";
import type * as reviewOrchestration from "../reviewOrchestration.js";
import type * as reviewOrchestrationActions from "../reviewOrchestrationActions.js";
import type * as teams from "../teams.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activityEvents: typeof activityEvents;
  aiReviewActions: typeof aiReviewActions;
  aiReviews: typeof aiReviews;
  auth: typeof auth;
  branches: typeof branches;
  comments: typeof comments;
  commits: typeof commits;
  debugOrg: typeof debugOrg;
  github: typeof github;
  http: typeof http;
  issues: typeof issues;
  labels: typeof labels;
  members: typeof members;
  notifications: typeof notifications;
  organizations: typeof organizations;
  prReviews: typeof prReviews;
  projects: typeof projects;
  pullRequests: typeof pullRequests;
  reviewOrchestration: typeof reviewOrchestration;
  reviewOrchestrationActions: typeof reviewOrchestrationActions;
  teams: typeof teams;
  users: typeof users;
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

export declare const components: {};
