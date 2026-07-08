import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { runInAction } from 'mobx';
import { Component, createComponent } from '../src';
import { captureErrors } from './helpers';

describe('watch/effect mechanics', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('callback receives (value, prev); fireImmediately runs on setup', () => {
    const calls: Array<[number, number | undefined]> = [];
    let inst!: C;
    class C extends Component {
      n = 0;
      onCreate() {
        inst = this;
      }
      onMount() {
        this.watch(
          () => this.n,
          (v, p) => calls.push([v, p]),
          { fireImmediately: true }
        );
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C);
    render(<El />);
    // fireImmediately: initial value, no previous
    expect(calls).toEqual([[0, undefined]]);

    act(() => {
      runInAction(() => {
        inst.n = 5;
      });
    });
    act(() => {
      runInAction(() => {
        inst.n = 8;
      });
    });
    expect(calls).toEqual([
      [0, undefined],
      [5, 0],
      [8, 5],
    ]);
  });

  it('delay debounces rapid changes into a single call with the latest value', () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    let inst!: C;
    class C extends Component {
      n = 0;
      onCreate() {
        inst = this;
      }
      onMount() {
        this.watch(
          () => this.n,
          (v) => calls.push(v),
          { delay: 100 }
        );
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C);
    render(<El />);

    act(() => {
      runInAction(() => {
        inst.n = 1;
      });
      runInAction(() => {
        inst.n = 2;
      });
    });
    // debounced — nothing yet
    expect(calls).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // collapsed to a single call with the latest value
    expect(calls).toEqual([2]);
  });

  it('effect cleanup runs before each re-run and on unmount', () => {
    const log: string[] = [];
    let inst!: C;
    class C extends Component {
      n = 0;
      onCreate() {
        inst = this;
        this.effect(() => {
          const v = this.n;
          log.push('run' + v);
          return () => log.push('cleanup' + v);
        });
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C);
    const { unmount } = render(<El />);
    expect(log).toEqual(['run0']);

    act(() => {
      runInAction(() => {
        inst.n = 1;
      });
    });
    // previous cleanup runs before the re-run
    expect(log).toEqual(['run0', 'cleanup0', 'run1']);

    act(() => {
      unmount();
    });
    expect(log).toEqual(['run0', 'cleanup0', 'run1', 'cleanup1']);
  });

  it('early-dispose from inside the callback (the "only needed once" pattern)', () => {
    const seen: number[] = [];
    let inst!: C;
    class C extends Component {
      n = 0;
      dispose?: () => void;
      onCreate() {
        inst = this;
      }
      onMount() {
        this.dispose = this.watch(
          () => this.n,
          (v) => {
            seen.push(v);
            if (v >= 1) this.dispose!();
          }
        );
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C);
    render(<El />);

    act(() => {
      runInAction(() => {
        inst.n = 1;
      });
    });
    act(() => {
      runInAction(() => {
        inst.n = 2;
      });
    });
    // disposed itself after the first fire; the second change is ignored
    expect(seen).toEqual([1]);
  });

  it('callback errors route to onError with correct context and do not break the component', () => {
    const errors = captureErrors();
    let inst!: C;
    class C extends Component {
      n = 0;
      onCreate() {
        inst = this;
      }
      onMount() {
        this.watch(
          () => this.n,
          () => {
            throw new Error('watch boom');
          }
        );
        this.effect(() => {
          if (this.n > 100) throw new Error('effect boom');
        });
      }
      render() {
        return <div data-testid="ok">ok</div>;
      }
    }
    const El = createComponent(C);
    const { getByTestId } = render(<El />);

    act(() => {
      runInAction(() => {
        inst.n = 1;
      });
    });
    const watchErr = errors.find((e) => e.context.phase === 'watch');
    expect(watchErr).toBeTruthy();
    expect(watchErr!.context).toMatchObject({ name: 'C', isBehavior: false });
    // component keeps working after a throwing callback
    expect(getByTestId('ok').textContent).toBe('ok');

    act(() => {
      runInAction(() => {
        inst.n = 200;
      });
    });
    expect(errors.some((e) => e.context.phase === 'effect')).toBe(true);
  });
});
