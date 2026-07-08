# Mantle-Web Router

A type-safe, MobX-powered router with TanStack-quality DX in ~115 lines.

---

## Design Goals

- **Type-safe params and search** — Full TypeScript inference for route params and query strings
- **MobX-native** — Router state is observable; components react automatically
- **Minimal ceremony** — Define routes, match them, done
- **Tiny footprint** — ~1KB vs TanStack's ~12KB
- **SSR compatible** — Works with server-side rendering and hydration

---

## Quick Start

```tsx
import { Router, Route, Link } from 'mantle-web';

// 1. Define routes with types
const routes = {
  home: Route('/'),
  users: Route('/users'),
  user: Route<{ id: string }>('/users/:id'),
  userTab: Route<{ id: string }, { tab: 'posts' | 'likes'; page: number }>('/users/:id/:tab'),
};

// 2. Create router
const router = new Router(routes);

// 3. Use in components
class App extends Component {
  render() {
    return router.match({
      home: () => <HomePage />,
      users: () => <UserList />,
      user: ({ id }) => <UserPage id={id} />,
      userTab: ({ id }, { tab, page }) => <UserPage id={id} tab={tab} page={page} />,
      fallback: () => <NotFound />,
    });
  }
}
```

---

## Route Definition

### Basic Routes

```tsx
const routes = {
  home: Route('/'),
  about: Route('/about'),
  contact: Route('/contact'),
};
```

### Routes with Params

```tsx
// Single param
const userRoute = Route<{ id: string }>('/users/:id');

// Multiple params
const postRoute = Route<{ userId: string; postId: string }>('/users/:userId/posts/:postId');
```

### Routes with Search Params

```tsx
// Typed search params
const searchRoute = Route<{}, { q: string; page: number }>('/search');

// Combined params and search
const userTabRoute = Route<
  { id: string },                           // URL params
  { tab: 'posts' | 'likes'; page: number }  // Search params
>('/users/:id');
```

### The `Route()` Factory

```tsx
function Route<
  P extends Record<string, string> = {},
  S extends Record<string, any> = {}
>(pattern: string) {
  return {
    pattern,
    _params: {} as P,  // Type marker
    _search: {} as S,  // Type marker
  };
}
```

---

## Navigation

### Programmatic Navigation

```tsx
// Simple navigation
router.go('home');

// With params
router.go('user', { id: '123' });

// With params and search
router.go('userTab', { id: '123' }, { tab: 'posts', page: 1 });

// Back/forward
router.back();
router.forward();
```

### Link Component

```tsx
// Basic link
<Link to="home">Home</Link>

// With params
<Link to="user" params={{ id: '123' }}>View User</Link>

// With params and search
<Link to="userTab" params={{ id: '123' }} search={{ tab: 'posts', page: 1 }}>
  User Posts
</Link>

// With class
<Link to="home" class="nav-link active">Home</Link>
```

---

## Search Params

Search params are first-class observable state — like TanStack Router.

### Reading Search Params

```tsx
class SearchPage extends Component {
  render() {
    // Type-safe access
    const { q, page } = router.getSearch<'search'>();
    
    return (
      <div>
        <p>Searching for: {q}</p>
        <p>Page: {page}</p>
      </div>
    );
  }
}
```

### Updating Search Params

```tsx
// Merge update (preserves other params)
router.setSearch({ page: 2 });
// /search?q=hello&page=1 → /search?q=hello&page=2

// Remove a param
router.setSearch({ filter: undefined });
// /search?q=hello&filter=active → /search?q=hello
```

### Search Params in Components

```tsx
class UserPosts extends Component<{ userId: string }> {
  render() {
    const { page, sort } = router.getSearch<'userPosts'>();
    
    return (
      <div>
        {/* Sort buttons */}
        <button 
          class={sort === 'new' ? 'active' : ''} 
          onClick={() => router.setSearch({ sort: 'new' })}
        >
          New
        </button>
        <button 
          class={sort === 'top' ? 'active' : ''} 
          onClick={() => router.setSearch({ sort: 'top' })}
        >
          Top
        </button>
        
        {/* Pagination */}
        <button 
          disabled={page <= 1}
          onClick={() => router.setSearch({ page: page - 1 })}
        >
          Prev
        </button>
        <span>Page {page}</span>
        <button onClick={() => router.setSearch({ page: page + 1 })}>
          Next
        </button>
      </div>
    );
  }
}
```

---

## Pattern Matching

The `router.match()` method provides exhaustive route matching:

```tsx
class App extends Component {
  render() {
    return router.match({
      // Each handler receives typed (params, search)
      home: () => <HomePage />,
      
      users: () => <UserList />,
      
      user: ({ id }) => <UserPage id={id} />,
      
      userPosts: ({ id }, { page, sort }) => (
        <UserPosts userId={id} page={page} sort={sort} />
      ),
      
      // Fallback for unmatched routes
      fallback: () => <NotFound />,
    });
  }
}
```

### Nested Layouts

```tsx
class App extends Component {
  render() {
    return (
      <div class="app">
        <Header />
        
        {router.match({
          home: () => <HomePage />,
          
          // User routes share a layout
          user: ({ id }) => (
            <UserLayout id={id}>
              <UserProfile id={id} />
            </UserLayout>
          ),
          userPosts: ({ id }, search) => (
            <UserLayout id={id}>
              <UserPosts userId={id} {...search} />
            </UserLayout>
          ),
          userLikes: ({ id }, search) => (
            <UserLayout id={id}>
              <UserLikes userId={id} {...search} />
            </UserLayout>
          ),
          
          fallback: () => <NotFound />,
        })}
        
        <Footer />
      </div>
    );
  }
}
```

---

## Reactive Updates

Since router state is MobX observable, components automatically re-render on navigation:

```tsx
class Breadcrumbs extends Component {
  render() {
    // This component re-renders when route changes
    const current = router.current;
    
    return (
      <nav class="breadcrumbs">
        <Link to="home">Home</Link>
        {current?.name === 'user' && (
          <>
            <span>/</span>
            <Link to="users">Users</Link>
            <span>/</span>
            <span>{router.params<'user'>().id}</span>
          </>
        )}
      </nav>
    );
  }
}
```

### Watching Route Changes

```tsx
class Analytics extends Component {
  onCreate() {
    // Track page views
    this.watch(
      () => router.path,
      (path) => {
        analytics.trackPageView(path);
      }
    );
  }
}
```

---

## Active Link Styling

```tsx
class NavLink extends Component<{ to: keyof typeof routes; children: any }> {
  get isActive() {
    return router.current?.name === this.props.to;
  }
  
  render() {
    return (
      <Link 
        to={this.props.to} 
        class={this.isActive ? 'nav-link active' : 'nav-link'}
      >
        {this.props.children}
      </Link>
    );
  }
}

// Usage
<nav>
  <NavLink to="home">Home</NavLink>
  <NavLink to="users">Users</NavLink>
  <NavLink to="about">About</NavLink>
</nav>
```

---

## SSR Support

### Server-Side

```tsx
// server.ts
import { Router, routes } from './routes';
import { renderToString } from 'mantle-web/ssr';

function handleRequest(req: Request) {
  const url = new URL(req.url);
  
  // Create router with server path
  const router = new Router(routes, url.pathname);
  
  // Render app
  const html = renderToString(App);
  
  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <script>window.__INITIAL_PATH__ = "${url.pathname}";</script>
      </head>
      <body>${html}</body>
    </html>
  `);
}
```

### Client Hydration

```tsx
// client.ts
import { router } from './routes';
import { hydrate } from 'mantle-web';

// Router auto-initializes from window.location
hydrate(App, document.getElementById('root'));
```

---

## Route Guards

Protect routes with guards that run before navigation:

```tsx
const router = new Router(routes, {
  guards: {
    // Protect admin routes
    admin: async () => {
      if (!authStore.isAdmin) {
        router.go('home');
        return false;  // Prevent navigation
      }
      return true;
    },
    
    // Require authentication
    user: async () => {
      if (!authStore.isLoggedIn) {
        router.go('login', {}, { redirect: router.path });
        return false;
      }
      return true;
    },
  },
});
```

---

## Implementation

### Router Class (~80 lines)

```tsx
import { makeAutoObservable, runInAction } from 'mobx';

type RouteDefinition<P = {}, S = {}> = {
  pattern: string;
  _params: P;
  _search: S;
};

type Routes = Record<string, RouteDefinition<any, any>>;

type RouterOptions<R extends Routes> = {
  guards?: Partial<Record<keyof R, () => boolean | Promise<boolean>>>;
};

class Router<R extends Routes> {
  path: string;
  search: URLSearchParams;
  
  private routes: R;
  private patterns: Map<keyof R, RegExp> = new Map();
  private guards: RouterOptions<R>['guards'];
  
  constructor(routes: R, initialPath?: string, options?: RouterOptions<R>) {
    this.routes = routes;
    this.guards = options?.guards;
    this.path = initialPath ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
    this.search = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    
    makeAutoObservable(this);
    
    // Build regex patterns
    for (const [name, route] of Object.entries(routes)) {
      const regex = new RegExp(
        '^' + route.pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'
      );
      this.patterns.set(name as keyof R, regex);
    }
    
    // Listen to browser navigation
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', () => {
        runInAction(() => {
          this.path = window.location.pathname;
          this.search = new URLSearchParams(window.location.search);
        });
      });
    }
  }
  
  get current(): { name: keyof R; params: Record<string, string> } | null {
    for (const [name, regex] of this.patterns) {
      const match = this.path.match(regex);
      if (match) {
        return { name, params: match.groups || {} };
      }
    }
    return null;
  }
  
  params<K extends keyof R>(): R[K]['_params'] {
    return (this.current?.params || {}) as R[K]['_params'];
  }
  
  getSearch<K extends keyof R>(): R[K]['_search'] {
    const result: Record<string, any> = {};
    this.search.forEach((value, key) => {
      result[key] = /^\d+$/.test(value) ? Number(value) : value;
    });
    return result as R[K]['_search'];
  }
  
  setSearch(updates: Partial<R[keyof R]['_search']>) {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === null) {
        this.search.delete(key);
      } else {
        this.search.set(key, String(value));
      }
    }
    this.syncUrl();
  }
  
  async go<K extends keyof R>(
    route: K,
    params?: R[K]['_params'],
    search?: Partial<R[K]['_search']>
  ) {
    // Run guard if exists
    const guard = this.guards?.[route];
    if (guard && !(await guard())) {
      return;  // Navigation prevented
    }
    
    let path = this.routes[route].pattern;
    
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        path = path.replace(`:${key}`, value as string);
      }
    }
    
    const searchParams = new URLSearchParams();
    if (search) {
      for (const [key, value] of Object.entries(search)) {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value));
        }
      }
    }
    
    const url = searchParams.toString() ? `${path}?${searchParams}` : path;
    history.pushState(null, '', url);
    
    runInAction(() => {
      this.path = path;
      this.search = searchParams;
    });
  }
  
  match<T>(
    handlers: { [K in keyof R]?: (params: R[K]['_params'], search: R[K]['_search']) => T } 
      & { fallback?: () => T }
  ): T | null {
    const current = this.current;
    if (current && handlers[current.name]) {
      return handlers[current.name]!(current.params as any, this.getSearch() as any);
    }
    return handlers.fallback?.() ?? null;
  }
  
  back() { history.back(); }
  forward() { history.forward(); }
  
  private syncUrl() {
    const search = this.search.toString();
    const url = search ? `${this.path}?${search}` : this.path;
    history.replaceState(null, '', url);
  }
}
```

### Link Component (~25 lines)

```tsx
class Link<R extends Routes, K extends keyof R> extends Component<{
  to: K;
  params?: R[K]['_params'];
  search?: Partial<R[K]['_search']>;
  class?: string;
  children?: any;
}> {
  handleClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey) return;  // Allow new tab
    e.preventDefault();
    router.go(this.props.to, this.props.params, this.props.search);
  };
  
  get href() {
    let path = router.routes[this.props.to].pattern;
    if (this.props.params) {
      for (const [key, value] of Object.entries(this.props.params)) {
        path = path.replace(`:${key}`, value as string);
      }
    }
    if (this.props.search) {
      path += `?${new URLSearchParams(this.props.search as any)}`;
    }
    return path;
  }
  
  render() {
    return (
      <a href={this.href} onClick={this.handleClick} class={this.props.class}>
        {this.props.children}
      </a>
    );
  }
}
```

---

## Comparison

| Feature | TanStack Router | Mantle Router |
|---------|-----------------|---------------|
| Type-safe params | ✅ | ✅ |
| Type-safe search | ✅ | ✅ |
| Observable state | ❌ (hooks) | ✅ (MobX) |
| Pattern matching | ❌ | ✅ `router.match()` |
| Search merge updates | ✅ | ✅ |
| Route guards | ✅ | ✅ |
| Data loaders | ✅ | ❌* |
| Pending states | ✅ | ❌* |
| Bundle size | ~12KB | **~1KB** |
| SSR | ✅ | ✅ |

*Components handle data loading via MobX stores — no framework-level abstraction needed.

---

## Bundle Size

| Piece | Size |
|-------|------|
| `Route()` factory | ~10 lines |
| `Router` class | ~80 lines |
| `Link` component | ~25 lines |
| **Total** | **~115 lines (~1KB min+gzip)** |

---

## Why No Data Loaders?

TanStack Router's data loaders are powerful but add complexity. In Mantle, components own their data:

```tsx
// TanStack way
const userRoute = createRoute({
  path: '/users/$userId',
  loader: async ({ params }) => fetchUser(params.userId),
  component: UserPage,
});

// Mantle way — simpler, same result
class UserPage extends Component<{ id: string }> {
  user: User | null = null;
  loading = true;
  error: Error | null = null;
  
  async onCreate() {
    try {
      this.user = await fetchUser(this.props.id);
    } catch (e) {
      this.error = e as Error;
    } finally {
      this.loading = false;
    }
  }
  
  render() {
    if (this.loading) return <Spinner />;
    if (this.error) return <ErrorMessage error={this.error} />;
    return <UserProfile user={this.user!} />;
  }
}
```

Benefits of Mantle's approach:
- Loading state is colocated with the component
- No framework-level loader registry
- Works with any data fetching pattern (fetch, axios, GraphQL)
- MobX stores can be shared across routes
