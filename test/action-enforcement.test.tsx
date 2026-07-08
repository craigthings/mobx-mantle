import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { runInAction } from 'mobx';
import { Component, createComponent } from '../src';
import { tick } from './helpers';

/**
 * Default config (manageMobxActions: true) sets MobX enforceActions to
 * 'never', so the async continuations and watch callbacks Mantle encourages
 * don't trip MobX's strict-mode warning.
 */
const STRICT = /strict-mode|without using an action/i;

describe('Action enforcement (managed MobX config)', () => {
  it('async method mutating state after await → no enforceActions warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let inst!: C;
    class C extends Component {
      value = 0;
      onCreate() {
        inst = this;
      }
      async load() {
        await Promise.resolve();
        this.value = 5; // mutation outside an action, after await
      }
      render() {
        return <div data-testid="v">{this.value}</div>;
      }
    }
    const El = createComponent(C);
    render(<El />); // reading value makes it observed

    await act(async () => {
      await inst.load();
    });
    await tick();

    expect(screen.getByTestId('v').textContent).toBe('5');
    expect(warn.mock.calls.some((a) => STRICT.test(String(a[0])))).toBe(false);
    warn.mockRestore();
  });

  it('watch callback assigning state → no enforceActions warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let inst!: C;
    class C extends Component {
      a = 0;
      b = 0;
      onCreate() {
        inst = this;
      }
      onMount() {
        this.watch(
          () => this.a,
          () => {
            this.b = this.a * 2; // assignment inside a watch callback
          }
        );
      }
      render() {
        return <div data-testid="v">{this.b}</div>;
      }
    }
    const El = createComponent(C);
    render(<El />);

    act(() => {
      runInAction(() => {
        inst.a = 3;
      });
    });
    expect(screen.getByTestId('v').textContent).toBe('6');
    expect(warn.mock.calls.some((a) => STRICT.test(String(a[0])))).toBe(false);
    warn.mockRestore();
  });
});
