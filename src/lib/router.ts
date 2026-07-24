/**
 * Hash router.
 *
 * Hash-based rather than history-based because the site is served from GitHub
 * Pages, which has no server-side rewrite: a hard refresh on /u/bryan would 404,
 * whereas /#/u/bryan always resolves to index.html.
 */

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'directory' }
  | { name: 'member'; handle: string }
  | { name: 'join' }
  | { name: 'verify' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '');
  if (path === '' || path === 'home') return { name: 'home' };
  if (path === 'people' || path === 'directory') return { name: 'directory' };
  if (path === 'join') return { name: 'join' };
  if (path === 'verify') return { name: 'verify' };
  const member = path.match(/^u\/([a-z0-9][a-z0-9-]{1,38})$/);
  if (member) return { name: 'member', handle: member[1] };
  return { name: 'home' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      // A route change is a new page to a reader; start at the top.
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function href(route: Route): string {
  switch (route.name) {
    case 'directory':
      return '#/people';
    case 'member':
      return `#/u/${route.handle}`;
    case 'join':
      return '#/join';
    case 'verify':
      return '#/verify';
    default:
      return '#/';
  }
}
