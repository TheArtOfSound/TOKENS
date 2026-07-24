/**
 * History-API router with clean URLs.
 *
 * Was hash-based (#/u/bryan) because GitHub Pages has no server rewrite. Clean
 * paths (/u/bryan) are worth the extra plumbing: they share better, look
 * professional, and are what people expect. Two pieces make them work on a
 * static host:
 *
 *   1. A global click interceptor turns same-origin <a href> into pushState
 *      navigation — no per-link onClick needed.
 *   2. dist/404.html is a copy of index.html (see the build script), so GitHub
 *      Pages serves the app for ANY path and the router reads location.pathname.
 *      A hard refresh on /u/bryan therefore works.
 *
 * Legacy hash links (#/u/bryan) that were already shared are migrated to the
 * clean path on load, so nothing that's out in the world breaks.
 */

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'directory' }
  | { name: 'member'; handle: string }
  | { name: 'join' }
  | { name: 'verify' }
  | { name: 'employer' }
  | { name: 'compare' };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, ''); // '' at a domain root

function stripBase(pathname: string): string {
  if (BASE && pathname.startsWith(BASE)) return pathname.slice(BASE.length) || '/';
  return pathname || '/';
}

export function parsePath(pathname: string): Route {
  const path = stripBase(pathname).replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/home') return { name: 'home' };
  if (path === '/people' || path === '/directory') return { name: 'directory' };
  if (path === '/join') return { name: 'join' };
  if (path === '/verify') return { name: 'verify' };
  if (path === '/employer' || path === '/hire' || path === '/for-employers') return { name: 'employer' };
  if (path === '/compare') return { name: 'compare' };
  const member = path.match(/^\/u\/([a-z0-9][a-z0-9-]{1,38})$/);
  if (member) return { name: 'member', handle: member[1] };
  return { name: 'home' };
}

export function href(route: Route): string {
  const b = BASE || '';
  switch (route.name) {
    case 'directory':
      return `${b}/people`;
    case 'member':
      return `${b}/u/${route.handle}`;
    case 'join':
      return `${b}/join`;
    case 'verify':
      return `${b}/verify`;
    case 'employer':
      return `${b}/employer`;
    case 'compare':
      return `${b}/compare`;
    default:
      return `${b}/`;
  }
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => {
    // Migrate a legacy hash link (#/u/bryan) to its clean path once, on load.
    if (window.location.hash.startsWith('#/')) {
      const migrated = window.location.hash.slice(1);
      window.history.replaceState({}, '', migrated);
    }
    return parsePath(window.location.pathname);
  });

  useEffect(() => {
    const onPop = () => {
      setRoute(parsePath(window.location.pathname));
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('popstate', onPop);

    // Intercept clicks on internal links so they navigate without a full reload.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const rawHref = anchor.getAttribute('href');
      if (!rawHref || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      if (rawHref.startsWith('mailto:') || rawHref.startsWith('#')) return;
      const url = new URL(rawHref, window.location.origin);
      if (url.origin !== window.location.origin) return;
      // Let real files (data, scripts, icons) load normally.
      if (/\.(json|svg|png|ico|sh|txt|xml|webmanifest)$/i.test(url.pathname)) return;
      event.preventDefault();
      if (url.pathname !== window.location.pathname) navigate(url.pathname);
    };
    document.addEventListener('click', onClick);

    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick);
    };
  }, []);

  return route;
}
