import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { runInAction } from 'mobx';
import { Component, Behavior, createComponent, createBehavior } from '../src';
import { renderStrict } from './helpers';

/**
 * These assert the *settled* state after React 18 StrictMode's
 * mount → simulated-unmount → remount cycle: exactly one live reaction, no
 * duplicates, cleanups balanced. A regression in the spec-resurrection
 * machinery (internals.ts activateSpecs / _wasUnmounted) fails these loudly.
 */
describe('StrictMode & remount resurrection', () => {
  it('watcher declared in onCreate fires exactly once per change after double-mount', () => {
    let inst!: Watcher;
    class Watcher extends Component {
      value = 0;
      fires = 0;
      onCreate() {
        inst = this;
        this.watch(
          () => this.value,
          () => {
            this.fires++;
          }
        );
      }
      render() {
        return <div>{this.value}</div>;
      }
    }
    const El = createComponent(Watcher);
    renderStrict(<El />);

    // Not fired during setup (no fireImmediately)
    expect(inst.fires).toBe(0);

    act(() => {
      runInAction(() => {
        inst.value++;
      });
    });
    // Exactly one live reaction — resurrection disposed the first, created one.
    expect(inst.fires).toBe(1);
  });

  it('effect declared in onCreate resurrects on remount; cleanup ran at simulated unmount', () => {
    // Counters are plain closure vars, not observable fields: the effect body
    // is a tracked region, and reading+writing an observable inside it would
    // self-invalidate. Only `value` (the dependency we drive) is observable.
    let runs = 0;
    let cleanups = 0;
    let inst!: Effecter;
    class Effecter extends Component {
      value = 0;
      onCreate() {
        inst = this;
        this.effect(() => {
          void this.value; // track
          runs++;
          return () => {
            cleanups++;
          };
        });
      }
      render() {
        return <div>{this.value}</div>;
      }
    }
    const El = createComponent(Effecter);
    renderStrict(<El />);

    // Ran on first activation and again after resurrection; cleaned up once between.
    expect(runs).toBe(2);
    expect(cleanups).toBe(1);

    act(() => {
      runInAction(() => {
        inst.value++;
      });
    });
    // Exactly one live autorun: one more run, one more cleanup (before re-run).
    expect(runs).toBe(3);
    expect(cleanups).toBe(2);
  });

  it('fireImmediately watcher fires again on remount (documented semantics)', () => {
    let inst!: Immediate;
    class Immediate extends Component {
      value = 0;
      fires = 0;
      onCreate() {
        inst = this;
        this.watch(
          () => this.value,
          () => {
            this.fires++;
          },
          { fireImmediately: true }
        );
      }
      render() {
        return <div>{this.value}</div>;
      }
    }
    const El = createComponent(Immediate);
    renderStrict(<El />);

    // fireImmediately runs at each activation: first mount + resurrection = 2.
    expect(inst.fires).toBe(2);
  });

  it('stop() called before remount prevents resurrection; stop() while unmounted is safe', () => {
    let inst!: Stopper;
    let dispose!: () => void;
    class Stopper extends Component {
      value = 0;
      fires = 0;
      onCreate() {
        inst = this;
        dispose = this.watch(
          () => this.value,
          () => {
            this.fires++;
          }
        );
      }
      render() {
        return <div>{this.value}</div>;
      }
    }
    const El = createComponent(Stopper);
    const { unmount } = renderStrict(<El />);

    // Stop the spec — resurrection must skip it and it must never re-create.
    act(() => {
      dispose();
    });
    act(() => {
      runInAction(() => {
        inst.value++;
      });
    });
    expect(inst.fires).toBe(0);

    // Calling dispose again after a full unmount must not throw.
    act(() => {
      unmount();
    });
    expect(() => dispose()).not.toThrow();
  });

  it('watcher registered in onMount does not double-fire after remount', () => {
    let inst!: MountWatcher;
    class MountWatcher extends Component {
      value = 0;
      fires = 0;
      onMount() {
        this.watch(
          () => this.value,
          () => {
            this.fires++;
          }
        );
      }
      onCreate() {
        inst = this;
      }
      render() {
        return <div>{this.value}</div>;
      }
    }
    const El = createComponent(MountWatcher);
    renderStrict(<El />);

    // onMount re-runs on remount and its callsite re-registers naturally; the
    // unmount between disposed the first, so exactly one is live.
    act(() => {
      runInAction(() => {
        inst.value++;
      });
    });
    expect(inst.fires).toBe(1);
  });

  it('behavior with an onCreate watcher survives StrictMode intact', () => {
    class Tracker extends Behavior {
      value = 0;
      fires = 0;
      onCreate() {
        this.watch(
          () => this.value,
          () => {
            this.fires++;
          }
        );
      }
    }
    const withTracker = createBehavior(Tracker);

    let inst!: Tracker;
    class Host extends Component {
      tracker = withTracker();
      onCreate() {
        inst = this.tracker;
      }
      render() {
        return <div>{this.tracker.value}</div>;
      }
    }
    const El = createComponent(Host);
    renderStrict(<El />);

    expect(inst.fires).toBe(0);
    act(() => {
      runInAction(() => {
        inst.value++;
      });
    });
    expect(inst.fires).toBe(1);
  });

  it('addCleanup in onMount re-registers on remount; pre-mount addCleanup is one-shot', () => {
    // one-shot pre-mount: addCleanup called in onCreate registers a single
    // disposer that runs once at unmount and is NOT re-created on remount.
    let mountCleanups = 0;
    let preMountCleanups = 0;
    class Cleaner extends Component {
      onCreate() {
        // Suppress the documented pre-mount warning noise for this assertion.
        const warn = console.warn;
        console.warn = () => {};
        this.addCleanup(() => {
          preMountCleanups++;
        });
        console.warn = warn;
      }
      onMount() {
        this.addCleanup(() => {
          mountCleanups++;
        });
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(Cleaner);
    const { unmount } = renderStrict(<El />);

    // After the StrictMode cycle, the simulated unmount already ran cleanups
    // once. onMount's addCleanup re-registered on remount; the pre-mount one
    // did not (one-shot), so it fired only during the simulated unmount.
    act(() => {
      unmount();
    });
    // onMount cleanup: fired at simulated unmount + real unmount = 2.
    expect(mountCleanups).toBe(2);
    // pre-mount cleanup: one-shot, fired only at the simulated unmount.
    expect(preMountCleanups).toBe(1);
  });

  describe('pre-mount addCleanup dev warning', () => {
    it('warns for addCleanup before mount (Component and Behavior); silent for watch/effect and onMount', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      class Bhv extends Behavior {
        value = 0;
        onCreate() {
          this.addCleanup(() => {}); // pre-mount → warns
          this.watch(
            () => this.value,
            () => {}
          ); // internal _addCleanup → no warn
        }
      }
      const withBhv = createBehavior(Bhv);

      class Comp extends Component {
        value = 0;
        bhv = withBhv();
        onCreate() {
          this.addCleanup(() => {}); // pre-mount → warns
          this.effect(() => {
            void this.value;
          }); // internal → no warn
        }
        onMount() {
          this.addCleanup(() => {}); // mounted → no warn
        }
        render() {
          return <div />;
        }
      }
      const El = createComponent(Comp);
      render(<El />);

      const cleanupWarnings = warn.mock.calls.filter((args) =>
        String(args[0]).includes('addCleanup() called before mount')
      );
      // Exactly two: one from the Component, one from the Behavior.
      expect(cleanupWarnings).toHaveLength(2);
      const messages = cleanupWarnings.map((a) => String(a[0]));
      expect(messages.some((m) => m.includes('Comp.addCleanup'))).toBe(true);
      expect(messages.some((m) => m.includes('Bhv.addCleanup'))).toBe(true);

      warn.mockRestore();
    });
  });
});
