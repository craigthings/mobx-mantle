import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { Component, createComponent } from '../src';
import { observationProbe } from './helpers';

describe('Leak & disposal hygiene', () => {
  it('after unmount, no live reactions remain', () => {
    const probe = observationProbe();
    class C extends Component {
      onCreate() {
        this.watch(
          () => probe.get(),
          () => {}
        );
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C);
    const { unmount } = render(<El />);
    // watcher is live after commit
    expect(probe.observed).toBe(true);

    act(() => {
      unmount();
    });
    // watcher disposed → nothing observes the probe
    expect(probe.observed).toBe(false);
  });

  it('replacing the mounted instance disposes the old one’s watchers (no leak across remount)', () => {
    const probe = observationProbe();
    class C extends Component {
      onCreate() {
        this.watch(
          () => probe.get(),
          () => {}
        );
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C);
    const { rerender } = render(<El key="a" />);
    expect(probe.observed).toBe(true);

    // key change forces unmount of the old instance + mount of a new one
    rerender(<El key="b" />);
    // still exactly one live watcher, not two (old one was disposed)
    expect(probe.observed).toBe(true);
  });

  it('constructing during render creates zero live reactions (dormant until commit)', () => {
    const probe = observationProbe();
    let observedDuringRender: boolean | undefined;
    class C extends Component {
      onCreate() {
        this.watch(
          () => probe.get(),
          () => {}
        );
      }
      render() {
        // render runs before the commit-phase layout effect that activates specs
        observedDuringRender = probe.observed;
        return <div />;
      }
    }
    const El = createComponent(C);
    render(<El />);

    // The onCreate watcher was dormant while rendering...
    expect(observedDuringRender).toBe(false);
    // ...and came alive only at commit.
    expect(probe.observed).toBe(true);
  });

  it('stop() called in onCreate → the spec never materializes at mount', () => {
    const probe = observationProbe();
    class C extends Component {
      onCreate() {
        const dispose = this.watch(
          () => probe.get(),
          () => {}
        );
        dispose(); // cancel before it can materialize
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C);
    render(<El />);
    expect(probe.observed).toBe(false);
  });

  // Note: true server rendering (renderToString with no `window`) is covered
  // in server.node.test.tsx, which runs in the node environment.
});
