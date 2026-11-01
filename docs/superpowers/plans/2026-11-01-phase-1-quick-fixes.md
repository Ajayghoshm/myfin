# Phase 1: Quick Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the empty space at the bottom of every page when scrolled fully down, and re-validate the login on every tab refocus before the user can interact.

**Architecture:** Both changes live in the authenticated shell, `myfin-web/src/components/PrivateRoute.tsx` (layout `<main>` and the existing `useAuthStatus` session query). No API change.

**Tech Stack:** React, MUI, react-router, TanStack Query, Vite, Biome. The web package has no component test runner (only `node:test` for pure helpers), so these tasks are verified by lint, build and the browser.

**Spec:** `docs/superpowers/plans/2026-11-01-next-phase-roadmap.md` (items 1 and 8).

## Global Constraints

- Run `npm run lint` and `npm run build` in `myfin-web` before each commit.
- Follow `myfin-web/docs/frontend-guidelines.md` (read it first, including UI copy and i18n rules).
- Commit and push after each task.

## Review Focus

- Short pages (content shorter than the viewport) must not start scrolling after the fix.
- Refocusing while a form dialog is open with unsaved input and a valid session: the check must not close it or lose input.
- Focus + visibilitychange both fire on one tab switch: only one check should be in flight.
- API unreachable on refocus (network error, not 401): do not log the user out; show the existing error behavior.

---

### Task 1: Remove the empty space at the bottom of pages

**Files:**
- Modify: `myfin-web/src/components/PrivateRoute.tsx` (the `<main>` and wrapper `Box`, around lines 82-90)
- Possibly modify: the page container that adds the extra bottom space (found in Step 1)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks use.

- [ ] **Step 1: Reproduce and locate the cause**

Run `npm run dev` in `myfin-web`, log in, and scroll to the bottom on at least Dashboard, Transactions, Budgets, Insights and Stats. In browser devtools, find which element makes the scroll area taller than its content (candidates: `<main>` with `height: 100vh` inside a flex `Box` next to the sidebar, a page root with bottom margin/padding, an element with `min-height: 100vh`). Record the element and the cause in the commit message.

- [ ] **Step 2: Fix at the source**

Fix the element found in Step 1 (e.g. give `<main>` `height: 100dvh` or `minHeight: 0` inside a flex column, or remove the stray bottom margin/padding from the page container). Change only that element; do not add compensating negative margins.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build` (expected: both succeed). In the browser on the five pages above, scroll to the bottom: the last content ends at the viewport bottom with only normal page padding. Also check a short page (e.g. Profile): no scrollbar appears. Also check a narrow (mobile-width) window.

- [ ] **Step 4: Commit and push**

```bash
git add myfin-web/src/components/PrivateRoute.tsx
git commit -m "fix: remove empty space at the bottom of scrolled pages"
git push
```

---

### Task 2: Re-validate the session on every tab refocus

**Files:**
- Modify: `myfin-web/src/components/PrivateRoute.tsx` (the effects near lines 63-73, the render near line 76)
- Reference: `myfin-web/src/services/auth/authHooks.ts` (`useAuthStatus`), `myfin-web/src/components/BackdropLoading.tsx`

**Interfaces:**
- Consumes: `useAuthStatus(true)` returns the TanStack query result plus `isAuthenticated: boolean | null`; its `refetch` re-runs `AuthServices.validateSession()`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Re-check on refocus**

In `PrivateRoute`, add a `useEffect` that subscribes to `document` `visibilitychange` (when `document.visibilityState === 'visible'`) and `window` `focus`, calling `authStatus.refetch({ cancelRefetch: false })` so simultaneous events share one in-flight check. Remove the listeners on cleanup.

- [ ] **Step 2: Block interaction while checking**

While `authStatus.isFetching && authStatus.isSuccess` (a re-check, not the first load), render `BackdropLoading` over the page so nothing can be clicked until the check resolves. Reuse the existing component; do not add new copy.

- [ ] **Step 3: Verify the expired and network-error cases**

The existing effect already navigates to `ROUTE_AUTH` when the check ends unauthenticated; confirm a 401 from `validateSession` ends in `isAuthenticated !== true`. Confirm a network error (API stopped) does not send the user to login unless the existing behavior already does; if it would, only treat an actual unauthenticated response as logout.

Run: `npm run lint && npm run build` (expected: both succeed). In the browser: (a) log in, switch to another tab and back with a valid session: a brief overlay, then the page is usable; (b) invalidate the session on the server (restart the API with a new session secret or delete the session row), switch away and back: redirected to login with no stale page interaction; (c) open a dialog with typed input, switch away and back with a valid session: dialog and input are intact.

- [ ] **Step 4: Commit and push**

```bash
git add myfin-web/src/components/PrivateRoute.tsx
git commit -m "feat: re-validate the session on every tab refocus"
git push
```
