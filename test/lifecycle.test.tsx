import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { runInAction } from 'mobx';
import { Component, createComponent } from '../src';
import { captureErrors } from './helpers';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  render() {
    return this.state.crashed ? <div data-testid="boundary">caught</div> : this.props.children;
  }
}

describe('Lifecycle contract', () => {
  it('ordering: onCreate → render → onLayoutMount → onMount; teardown cleans up and disposes watchers', () => {
    const log: string[] = [];
    let inst!: C;
    class C extends Component {
      n = 0;
      fires = 0;
      onCreate() {
        inst = this;
        log.push('create');
      }
      onLayoutMount() {
        log.push('layoutmount');
        return () => log.push('layoutcleanup');
      }
      onMount() {
        log.push('mount');
        this.watch(
          () => this.n,
          () => {
            this.fires++;
          }
        );
        return () => log.push('mountcleanup');
      }
      onUnmount() {
        log.push('unmount');
      }
      render() {
        log.push('render');
        return <div />;
      }
    }
    const El = createComponent(C);
    const { unmount } = render(<El />);

    // Mount ordering is strict and well-defined.
    expect(log.indexOf('create')).toBeLessThan(log.indexOf('render'));
    expect(log.indexOf('render')).toBeLessThan(log.indexOf('layoutmount'));
    expect(log.indexOf('layoutmount')).toBeLessThan(log.indexOf('mount'));

    act(() => {
      unmount();
    });
    // onMount cleanup runs before onUnmount (same teardown handler)
    expect(log.indexOf('mountcleanup')).toBeLessThan(log.indexOf('unmount'));
    expect(log).toContain('layoutcleanup');

    // Watcher disposed at unmount: a later mutation must not fire it.
    const before = inst.fires;
    runInAction(() => {
      inst.n = 99;
    });
    expect(inst.fires).toBe(before);
  });

  it('onUpdate runs after every render', () => {
    let updates = 0;
    class C extends Component {
      n = 0;
      inc() {
        this.n++;
      }
      onUpdate() {
        updates++;
      }
      render() {
        return <button onClick={this.inc}>{this.n}</button>;
      }
    }
    const El = createComponent(C);
    render(<El />);
    expect(updates).toBe(1);

    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(updates).toBe(2);
  });

  it('returning a Promise from a lifecycle method triggers the dev error', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    class C extends Component {
      onMount() {
        return Promise.resolve() as unknown as void;
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C);
    const { unmount } = render(<El />);
    const hit = errSpy.mock.calls
      .map((a) => String(a[0]))
      .find((m) => m.includes('onMount() returned a Promise'));
    expect(hit).toBeTruthy();
    // The returned Promise must not be mistaken for a cleanup function at unmount.
    expect(() => act(() => unmount())).not.toThrow();
    errSpy.mockRestore();
  });

  it('render errors reach a React error boundary', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    class Bad extends Component {
      render(): React.ReactElement {
        throw new Error('render boom');
      }
    }
    const El = createComponent(Bad);
    render(
      <ErrorBoundary>
        <El />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('boundary').textContent).toBe('caught');
    errSpy.mockRestore();
  });

  it('lifecycle errors reach onError, not the error boundary', () => {
    const errors = captureErrors();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    class C extends Component {
      onMount() {
        throw new Error('mount boom');
      }
      render() {
        return <div data-testid="ok">ok</div>;
      }
    }
    const El = createComponent(C);
    render(
      <ErrorBoundary>
        <El />
      </ErrorBoundary>
    );
    // Boundary did not catch — component stayed mounted.
    expect(screen.getByTestId('ok').textContent).toBe('ok');
    expect(screen.queryByTestId('boundary')).toBeNull();
    const hit = errors.find((e) => e.context.phase === 'onMount');
    expect(hit).toBeTruthy();
    expect(hit!.context).toMatchObject({ name: 'C', isBehavior: false });
    errSpy.mockRestore();
  });
});
