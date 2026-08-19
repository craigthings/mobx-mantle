// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Component, createComponent } from '../src';
import { observationProbe } from './helpers';

/**
 * With no `window` (real server), useMantleObserver renders untracked: no
 * render Reaction is created at all, and un-committed effects leave onCreate
 * watchers dormant. renderToString therefore leaks zero reactions.
 */
describe('server render (node environment)', () => {
  it('window is undefined here', () => {
    expect(typeof window).toBe('undefined');
  });

  it('observables read in render are not tracked on the server', () => {
    const probe = observationProbe();
    class C extends Component {
      render() {
        return <div>{probe.get()}</div>;
      }
    }
    const El = createComponent(C);
    const html = renderToString(<El />);
    expect(html).toContain('0');
    // No render reaction on the server → nothing observes the probe.
    expect(probe.observed).toBe(false);
  });

  it('onCreate watchers create no reactions during server render', () => {
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
    renderToString(<El />);
    expect(probe.observed).toBe(false);
  });

  it('preserves Mantle ancestry without changing server markup', () => {
    let parent!: Parent;
    let child!: Child;

    class Child extends Component {
      parentFromField = this.getParent();

      onCreate() {
        child = this;
      }

      render() {
        return <span>child</span>;
      }
    }
    const ChildView = createComponent(Child);

    class Parent extends Component {
      onCreate() {
        parent = this;
      }

      render() {
        return <main><ChildView /></main>;
      }
    }
    const ParentView = createComponent(Parent);

    const html = renderToString(<ParentView />);

    expect(html).toBe('<main><span>child</span></main>');
    expect(child.parentFromField).toBe(parent);
    expect(child.getParent()).toBe(parent);
    expect(child.getRoot()).toBe(parent);
  });
});
