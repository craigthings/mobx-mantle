import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { runInAction } from 'mobx';
import { Component, Behavior, createComponent, createBehavior, resolve, type MaybeGetter } from '../src';
import {
  mountBehavior,
  unmountBehavior,
} from '../src/behavior';
import { captureErrors, renderStrict } from './helpers';

describe('Behavior construction & deferral', () => {
  it('watch in onCreate tracks a field assigned in that same onCreate', () => {
    const seen: string[] = [];
    let inst!: UrlBehavior;
    class UrlBehavior extends Behavior {
      url = '';
      onCreate(u: string) {
        inst = this;
        this.url = u;
        this.watch(
          () => this.url,
          (v) => {
            seen.push(v);
          }
        );
      }
    }
    const withUrl = createBehavior(UrlBehavior);
    class Host extends Component {
      loader = withUrl('a');
      render() {
        return <div>{this.loader.url}</div>;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    // Deferred watcher came alive at commit and tracks the onCreate-assigned field.
    act(() => {
      runInAction(() => {
        inst.url = 'b';
      });
    });
    expect(seen).toEqual(['b']);
  });

  it('ref-like object passed into onCreate keeps identity (observable.ref)', () => {
    const ref = { current: null as HTMLElement | null };
    let inst!: RefBehavior;
    class RefBehavior extends Behavior {
      el!: { current: HTMLElement | null };
      onCreate(r: { current: HTMLElement | null }) {
        inst = this;
        this.el = r;
      }
    }
    const withRef = createBehavior(RefBehavior);
    class Host extends Component {
      r = withRef(ref);
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    // Same object, not a deep-observable proxy.
    expect(inst.el).toBe(ref);
  });

  it('factory is callable with and without new; onCreate receives args', () => {
    class Arged extends Behavior {
      a = '';
      b = 0;
      onCreate(a: string, b: number) {
        this.a = a;
        this.b = b;
      }
    }
    const withArged = createBehavior(Arged);

    const noNew = withArged('x', 1);
    const withNew = new (withArged as unknown as new (a: string, b: number) => Arged)('y', 2);

    expect(noNew.a).toBe('x');
    expect(noNew.b).toBe(1);
    expect(withNew.a).toBe('y');
    expect(withNew.b).toBe(2);
  });

  it('lifecycle relay: onLayoutMount/onMount/onUnmount fire with the parent; cleanups run', () => {
    const log: string[] = [];
    class Lifecycle extends Behavior {
      onLayoutMount() {
        log.push('layout');
        return () => log.push('layout-cleanup');
      }
      onMount() {
        log.push('mount');
        return () => log.push('mount-cleanup');
      }
      onUnmount() {
        log.push('unmount');
      }
    }
    const withLifecycle = createBehavior(Lifecycle);
    class Host extends Component {
      b = withLifecycle();
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    const { unmount } = render(<El />);
    expect(log).toEqual(['layout', 'mount']);

    act(() => {
      unmount();
    });
    // teardown: layout cleanup + mount cleanup + onUnmount
    expect(log).toEqual(['layout', 'mount', 'layout-cleanup', 'mount-cleanup', 'unmount']);
  });

  it('a throwing behavior does not prevent siblings or the parent from mounting', () => {
    const errors = captureErrors();
    const mounted: string[] = [];
    class Throwing extends Behavior {
      onMount() {
        throw new Error('boom');
      }
    }
    class Sibling extends Behavior {
      onMount() {
        mounted.push('sibling');
      }
    }
    const withThrowing = createBehavior(Throwing);
    const withSibling = createBehavior(Sibling);
    class Host extends Component {
      bad = withThrowing();
      good = withSibling();
      onMount() {
        mounted.push('host');
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    expect(mounted).toContain('sibling');
    expect(mounted).toContain('host');
    expect(errors).toHaveLength(1);
    expect(errors[0].context).toMatchObject({ phase: 'onMount', name: 'Throwing', isBehavior: true });
  });
});

describe('Nested behaviors', () => {
  it('grandchildren mount child-before-parent and tear down parent-before-child (3 levels)', () => {
    const log: string[] = [];
    class Leaf extends Behavior {
      onMount() {
        log.push('mount:leaf');
      }
      onUnmount() {
        log.push('unmount:leaf');
      }
    }
    const withLeaf = createBehavior(Leaf);
    class Mid extends Behavior {
      leaf = withLeaf();
      onMount() {
        log.push('mount:mid');
      }
      onUnmount() {
        log.push('unmount:mid');
      }
    }
    const withMid = createBehavior(Mid);
    class Top extends Behavior {
      mid = withMid();
      onMount() {
        log.push('mount:top');
      }
      onUnmount() {
        log.push('unmount:top');
      }
    }
    const withTop = createBehavior(Top);
    class Host extends Component {
      top = withTop();
      onMount() {
        log.push('mount:host');
      }
      onUnmount() {
        log.push('unmount:host');
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    const { unmount } = render(<El />);

    // children mount before parents; host (component) last
    expect(log).toEqual(['mount:leaf', 'mount:mid', 'mount:top', 'mount:host']);

    log.length = 0;
    act(() => {
      unmount();
    });
    // component onUnmount first, then parent-before-child down the tree
    expect(log).toEqual(['unmount:host', 'unmount:top', 'unmount:mid', 'unmount:leaf']);
  });

  it('child behavior watchers survive StrictMode via resurrection', () => {
    const seen: number[] = [];
    let child!: Child;
    class Child extends Behavior {
      n = 0;
      onCreate() {
        child = this;
        this.watch(
          () => this.n,
          (v) => seen.push(v)
        );
      }
    }
    const withChild = createBehavior(Child);
    class Parent extends Behavior {
      child = withChild();
    }
    const withParent = createBehavior(Parent);
    class Host extends Component {
      p = withParent();
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    renderStrict(<El />);

    act(() => {
      runInAction(() => {
        child.n = 5;
      });
    });
    // exactly one live reaction after the strict cycle
    expect(seen).toEqual([5]);
  });

  it('child assigned in a behavior onCreate is collected; underscore-prefixed is not', () => {
    const log: string[] = [];
    class Collected extends Behavior {
      onMount() {
        log.push('collected');
      }
    }
    const withCollected = createBehavior(Collected);
    class Hidden extends Behavior {
      onMount() {
        log.push('hidden');
      }
    }
    const withHidden = createBehavior(Hidden);
    class Owner extends Behavior {
      child!: Collected;
      _hidden!: Hidden;
      onCreate() {
        this.child = withCollected();
        this._hidden = withHidden();
      }
    }
    const withOwner = createBehavior(Owner);
    class Host extends Component {
      owner = withOwner();
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    expect(log).toContain('collected');
    expect(log).not.toContain('hidden');
  });

  it('a cyclic behavior graph does not infinite-loop the relay; each mounts once', () => {
    class Node extends Behavior {
      mounts = 0;
      unmounts = 0;
      onMount() {
        this.mounts++;
      }
      onUnmount() {
        this.unmounts++;
      }
    }
    const withNode = createBehavior(Node);
    const a = withNode();
    const b = withNode();
    // Hand-build a cycle: a → b → a
    (a as unknown as { _behaviors: { instance: unknown }[] })._behaviors.push({ instance: b });
    (b as unknown as { _behaviors: { instance: unknown }[] })._behaviors.push({ instance: a });

    const entry = { instance: a };
    expect(() => mountBehavior(entry)).not.toThrow();
    expect(a.mounts).toBe(1);
    expect(b.mounts).toBe(1);

    expect(() => unmountBehavior(entry)).not.toThrow();
    expect(a.unmounts).toBe(1);
    expect(b.unmounts).toBe(1);
  });
});

describe('Reactive arguments', () => {
  it('resolve() returns getter results and non-functions as-is', () => {
    expect(resolve(5)).toBe(5);
    expect(resolve('x')).toBe('x');
    expect(resolve(() => 7)).toBe(7);
    const obj = { a: 1 };
    expect(resolve(obj)).toBe(obj);
  });

  it('getter argument: observable change flows into the behavior', () => {
    const seen: number[] = [];
    class Watcher extends Behavior {
      onCreate(src: MaybeGetter<number>) {
        this.watch(
          () => resolve(src),
          (v) => seen.push(v),
          { fireImmediately: true }
        );
      }
    }
    const withWatcher = createBehavior(Watcher);
    let host!: Host;
    class Host extends Component {
      n = 1;
      w = withWatcher(() => this.n);
      onCreate() {
        host = this;
      }
      render() {
        return <div>{this.n}</div>;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    expect(seen).toEqual([1]);
    act(() => {
      runInAction(() => {
        host.n = 2;
      });
    });
    expect(seen).toEqual([1, 2]);
  });

  it('plain-value argument stays static across source changes', () => {
    const seen: number[] = [];
    class Watcher extends Behavior {
      onCreate(src: MaybeGetter<number>) {
        this.watch(
          () => resolve(src),
          (v) => seen.push(v),
          { fireImmediately: true }
        );
      }
    }
    const withWatcher = createBehavior(Watcher);
    let host!: Host;
    class Host extends Component {
      n = 1;
      w = withWatcher(5); // frozen value, ignores this.n
      onCreate() {
        host = this;
      }
      render() {
        return <div>{this.n}</div>;
      }
    }
    const El = createComponent(Host);
    render(<El />);

    act(() => {
      runInAction(() => {
        host.n = 99;
      });
    });
    expect(seen).toEqual([5]);
  });
});

describe('Late-creation warning', () => {
  function warnings(fn: () => void): string[] {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fn();
    const calls = spy.mock.calls.map((a) => String(a[0]));
    spy.mockRestore();
    return calls;
  }

  it('behavior assigned in a Component onCreate warns and names the field', () => {
    class Thing extends Behavior {}
    const withThing = createBehavior(Thing);
    class Late extends Component {
      onCreate() {
        (this as unknown as { late: unknown }).late = withThing();
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Late);
    const msgs = warnings(() => render(<El />));
    const hit = msgs.find(
      (m) => m.includes('holds a behavior that was assigned after') && m.includes('Late.late')
    );
    expect(hit).toBeTruthy();
  });

  it('field-declared behaviors are silent', () => {
    class Thing extends Behavior {}
    const withThing = createBehavior(Thing);
    class Fine extends Component {
      thing = withThing();
      render() {
        return <div />;
      }
    }
    const El = createComponent(Fine);
    const msgs = warnings(() => render(<El />));
    expect(msgs.some((m) => m.includes('holds a behavior that was assigned after'))).toBe(false);
  });

  it('late-assigned grandchild on a collected behavior is warned (recursive scan)', () => {
    class Grand extends Behavior {}
    const withGrand = createBehavior(Grand);
    class Parent extends Behavior {}
    const withParent = createBehavior(Parent);
    class Host extends Component {
      parent = withParent();
      onCreate() {
        (this.parent as unknown as { lateChild: unknown }).lateChild = withGrand();
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Host);
    const msgs = warnings(() => render(<El />));
    const hit = msgs.find(
      (m) => m.includes('holds a behavior that was assigned after') && m.includes('Parent.lateChild')
    );
    expect(hit).toBeTruthy();
  });
});
