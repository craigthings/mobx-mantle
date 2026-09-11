import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { reaction } from 'mobx';
import { Behavior, Component, createBehavior, createComponent } from '../src';

describe('behavior method tracking', () => {
  it('tracks observable reads made through a behavior method', () => {
    class BreakpointBehavior extends Behavior {
      width = 500;

      below(breakpoint: number) {
        return this.width < breakpoint;
      }

      resize(width: number) {
        this.width = width;
      }
    }
    const withBreakpoint = createBehavior(BreakpointBehavior);

    let model!: ResponsiveModel;
    class ResponsiveModel extends Component {
      size = withBreakpoint();

      onCreate() {
        model = this;
      }

      get mode() {
        return this.size.below(640) ? 'compact' : 'wide';
      }

      render() {
        return <span data-testid="mode">{this.mode}</span>;
      }
    }
    const Responsive = createComponent(ResponsiveModel);

    render(<Responsive />);
    expect(screen.getByTestId('mode').textContent).toBe('compact');

    // Detached method use also proves behavior methods remain auto-bound and
    // that mutations outside a tracking context still run as an action.
    const resize = model.size.resize;
    act(() => resize(800));

    expect(screen.getByTestId('mode').textContent).toBe('wide');
  });


  it('batches detached event-handler mutations into one reaction', () => {
    class PairBehavior extends Behavior {
      first = 0;
      second = 0;
      update() { this.first = 1; this.second = 2; }
    }
    const withPair = createBehavior(PairBehavior);
    let pair!: PairBehavior;
    class Host extends Component {
      pair = withPair();
      onCreate() { pair = this.pair; }
      render() { return null; }
    }
    const View = createComponent(Host);
    render(<View />);
    const changes: number[][] = [];
    const dispose = reaction(() => [pair.first, pair.second], value => changes.push(value));
    try {
      const update = pair.update;
      act(() => update());
      expect(changes).toEqual([[1, 2]]);
    } finally { dispose(); }
  });
});
