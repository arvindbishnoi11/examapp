// =============================================================================
// Minimal, typed path router (no dependencies)
// =============================================================================

import type { Handler } from '../env';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type CompiledRoute = {
  method: Method;
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  handler: Handler;
  /** Route is matched even if it ends with a wildcard (e.g. /api/assets/*). */
  tag?: string;
};

export type RouteSpec = {
  method: Method;
  path: string;
  handler: Handler;
  tag?: string;
};

function compile(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  let pattern = '';
  for (const segment of path.split('/')) {
    if (!segment) continue;
    if (segment === '*') {
      pattern += '(?:/(.*))?';
      paramNames.push('wildcard');
    } else if (segment.startsWith(':')) {
      paramNames.push(segment.slice(1));
      pattern += '/([^/]+)';
    } else {
      pattern += '/' + segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return { regex: new RegExp(`^${pattern || '/'}/?$`, 'i'), paramNames };
}

export class Router {
  private routes: CompiledRoute[] = [];

  add(spec: RouteSpec): this {
    const { regex, paramNames } = compile(spec.path);
    this.routes.push({ ...spec, pattern: spec.path, regex, paramNames });
    return this;
  }

  get(path: string, handler: Handler, tag?: string) {
    return this.add({ method: 'GET', path, handler, tag });
  }
  post(path: string, handler: Handler, tag?: string) {
    return this.add({ method: 'POST', path, handler, tag });
  }
  put(path: string, handler: Handler, tag?: string) {
    return this.add({ method: 'PUT', path, handler, tag });
  }
  patch(path: string, handler: Handler, tag?: string) {
    return this.add({ method: 'PATCH', path, handler, tag });
  }
  delete(path: string, handler: Handler, tag?: string) {
    return this.add({ method: 'DELETE', path, handler, tag });
  }

  match(method: string, pathname: string):
    | { handler: Handler; params: Record<string, string>; tag?: string; allowed: Method[] }
    | { handler: null; allowed: Method[] } {
    const allowed: Method[] = [];
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      if (route.method !== method) {
        allowed.push(route.method);
        continue;
      }
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        const raw = m[index + 1];
        if (raw !== undefined) params[name] = decodeURIComponent(raw);
      });
      return { handler: route.handler, params, tag: route.tag, allowed };
    }
    return { handler: null, allowed: Array.from(new Set(allowed)) };
  }

  /** Route inventory for the self-documenting API docs endpoint. */
  list(): { method: Method; path: string; tag?: string }[] {
    return this.routes.map((r) => ({ method: r.method, path: r.pattern, tag: r.tag }));
  }
}
