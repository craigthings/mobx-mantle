import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { runInAction } from 'mobx';
import { Component, Behavior, createComponent, createBehavior, type MaybeGetter } from '../src';
import { renderStrict } from './helpers';

describe('watch(source) MaybeGetter overload', () => {
  it('a getter argument passed straight through fires on change', () => {
    const seen: number[] = [];
    class Mirror extends Behavior {
      onCreate(source: MaybeGetter<number>) {
        this.watch(source, (v) => seen.push(v));
      }
    }
    const withMirror = createBehavior(Mirror);

    let host!: Host;
    class Host extends Component {
      n = 1;
      m = withMirror(() => this.n);
      onCreate() {
        host = this;
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    act(() => {
      runInAction(() => {
        host.n = 2;
      });
    });
    expect(seen).toEqual([2]);
  });

  it('a plain value with fireImmediately fires once, without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: number[] = [];
    class Once extends Component {
      onMount() {
        this.watch(42, (v) => seen.push(v), { fireImmediately: true });
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Once);
    render(<El />);

    expect(seen).toEqual([42]);
    expect(warn.mock.calls.some((a) => String(a[0]).includes('can never'))).toBe(false);
    warn.mockRestore();
  });

  it('a plain value with no fireImmediately dev-warns (unreachable watch)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: number[] = [];
    class Dead extends Component {
      onMount() {
        this.watch(42, (v) => seen.push(v));
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Dead);
    render(<El />);

    expect(seen).toEqual([]);
    const hit = warn.mock.calls
      .map((a) => String(a[0]))
      .find((m) => m.includes('Dead.watch()') && m.includes('never fire'));
    expect(hit).toBeTruthy();
    warn.mockRestore();
  });
});

describe('Behavior.sync()', () => {
  class UrlBehavior extends Behavior {
    url = '';
    onCreate(url: MaybeGetter<string>) {
      this.url = this.sync(url);
    }
  }
  const withUrl = createBehavior(UrlBehavior);

  it('getter argument: the synced field stays current when the source changes', () => {
    let host!: Host;
    class Host extends Component {
      path = '/a';
      loader = withUrl(() => this.path);
      onCreate() {
        host = this;
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    // initial value bound at construction
    expect(host.loader.url).toBe('/a');

    act(() => {
      runInAction(() => {
        host.path = '/b';
      });
    });
    // hidden sync effect mirrored the change into the field
    expect(host.loader.url).toBe('/b');
  });

  it('plain-value argument: field holds it; no machinery, no updates', () => {
    let host!: Host;
    class Host extends Component {
      path = '/a';
      loader = withUrl('/static');
      onCreate() {
        host = this;
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    expect(host.loader.url).toBe('/static');
    act(() => {
      runInAction(() => {
        host.path = '/b';
      });
    });
    expect(host.loader.url).toBe('/static');
  });

  it('the synced field is observable: author watchers on it fire', () => {
    const seen: string[] = [];
    class Watching extends Behavior {
      url = '';
      onCreate(url: MaybeGetter<string>) {
        this.url = this.sync(url);
        this.watch(
          () => this.url,
          (v) => seen.push(v)
        );
      }
    }
    const withWatching = createBehavior(Watching);

    let host!: Host;
    class Host extends Component {
      path = '/a';
      w = withWatching(() => this.path);
      onCreate() {
        host = this;
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    act(() => {
      runInAction(() => {
        host.path = '/b';
      });
    });
    expect(seen).toEqual(['/b']);
  });

  it('sync survives a StrictMode remount (spec resurrection)', () => {
    let host!: Host;
    class Host extends Component {
      path = '/a';
      loader = withUrl(() => this.path);
      onCreate() {
        host = this;
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    renderStrict(<El />);

    act(() => {
      runInAction(() => {
        host.path = '/b';
      });
    });
    expect(host.loader.url).toBe('/b');
  });

  it('dev-warns when a synced field is written from outside', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let host!: Host;
    class Host extends Component {
      path = '/a';
      loader = withUrl(() => this.path);
      onCreate() {
        host = this;
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    act(() => {
      runInAction(() => {
        host.loader.url = '/rogue';
      });
    });
    const hit = warn.mock.calls
      .map((a) => String(a[0]))
      .find((m) => m.includes('one-way synced field'));
    expect(hit).toBeTruthy();
    // ...and no warning from the sync effect's own writes
    warn.mockClear();
    act(() => {
      runInAction(() => {
        host.path = '/c';
      });
    });
    expect(
      warn.mock.calls.map((a) => String(a[0])).find((m) => m.includes('one-way synced field'))
    ).toBeUndefined();
    expect(host.loader.url).toBe('/c');
    warn.mockRestore();
  });

  it('sync() called after construction dev-warns and degrades to a snapshot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let late = '';
    class LateSync extends Behavior {
      onMount() {
        late = this.sync(() => 'now');
      }
    }
    const withLate = createBehavior(LateSync);
    class Host extends Component {
      l = withLate();
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    expect(late).toBe('now');
    const hit = warn.mock.calls
      .map((a) => String(a[0]))
      .find((m) => m.includes('sync() called after construction'));
    expect(hit).toBeTruthy();
    warn.mockRestore();
  });

  it('config-object pattern: one arrow makes the bag live; key watchers ignore bag churn', () => {
    const seen: string[] = [];
    interface Opts {
      query: string;
      limit?: number;
      onResult?: () => void;
    }
    let callbackInvoked = 0;
    class Search extends Behavior {
      opts!: Opts;
      onCreate(opts: MaybeGetter<Opts>) {
        this.opts = this.sync(opts);
        this.watch(
          () => this.opts.query,
          (q) => seen.push(q)
        );
      }
    }
    const withSearch = createBehavior(Search);

    let host!: Host;
    class Host extends Component {
      query = 'a';
      limit = 10;
      s = withSearch(() => ({
        query: this.query,
        limit: this.limit,
        onResult: () => callbackInvoked++,
      }));
      onCreate() {
        host = this;
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    // callback in the bag was read, never called
    expect(callbackInvoked).toBe(0);
    expect(host.s.opts.query).toBe('a');

    // unrelated key change re-creates the bag; the query watcher must not fire
    act(() => {
      runInAction(() => {
        host.limit = 20;
      });
    });
    expect(host.s.opts.limit).toBe(20);
    expect(seen).toEqual([]);

    // the watched key firing works
    act(() => {
      runInAction(() => {
        host.query = 'b';
      });
    });
    expect(seen).toEqual(['b']);
    // the callback is still callable through the live bag
    host.s.opts.onResult?.();
    expect(callbackInvoked).toBe(1);
  });

  it('dev-warns when a sync() result is not assigned to a field', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class Dropped extends Behavior {
      onCreate(source: MaybeGetter<number>) {
        this.sync(source); // result discarded — can never be bound
      }
    }
    const withDropped = createBehavior(Dropped);
    class Host extends Component {
      d = withDropped(() => 1);
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    const hit = warn.mock.calls
      .map((a) => String(a[0]))
      .find((m) => m.includes('were not assigned to a field'));
    expect(hit).toBeTruthy();
    warn.mockRestore();
  });
});
