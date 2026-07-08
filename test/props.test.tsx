// Pins the PropsBox design: silent-sync during render + notify in the layout
// effect, and the render reaction's self-notification skip. Rationale in
// docs/ARCHITECTURE.md → "Props reactivity — the subtle part".
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { Component, createComponent } from '../src';

describe('Props reactivity (PropsBox atom)', () => {
  it('this.props is current during the render where props changed', () => {
    class Show extends Component<{ label: string }> {
      render() {
        return <div data-testid="v">{this.props.label}</div>;
      }
    }
    const El = createComponent(Show);
    const { rerender } = render(<El label="a" />);
    expect(screen.getByTestId('v').textContent).toBe('a');
    rerender(<El label="b" />);
    expect(screen.getByTestId('v').textContent).toBe('b');
  });

  it('watch(() => this.props.x) fires exactly once per change', () => {
    const seen: string[] = [];
    class W extends Component<{ x: string }> {
      onMount() {
        this.watch(
          () => this.props.x,
          (v) => seen.push(v)
        );
      }
      render() {
        return <div>{this.props.x}</div>;
      }
    }
    const El = createComponent(W);
    const { rerender } = render(<El x="a" />);
    rerender(<El x="b" />);
    rerender(<El x="c" />);
    expect(seen).toEqual(['b', 'c']);
  });

  it('two components sharing a parent render without "update while rendering" warnings', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    class Child extends Component<{ n: number }> {
      render() {
        return <span data-testid="c">{this.props.n}</span>;
      }
    }
    const ChildEl = createComponent(Child);
    class Parent extends Component {
      n = 0;
      inc() {
        this.n++;
      }
      render() {
        return (
          <button onClick={this.inc}>
            <ChildEl n={this.n} />
          </button>
        );
      }
    }
    const El = createComponent(Parent);
    render(<El />);
    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(screen.getByTestId('c').textContent).toBe('1');
    const offending = errors.mock.calls.filter((a) =>
      /while rendering|Cannot update a component/.test(String(a[0]))
    );
    expect(offending).toHaveLength(0);
    errors.mockRestore();
  });

  it('prop change on a component reading props directly in render → exactly one render (self-notification skip)', () => {
    let renders = 0;
    class Solo extends Component<{ x: number }> {
      render() {
        renders++;
        return <div data-testid="v">{this.props.x}</div>;
      }
    }
    const El = createComponent(Solo);
    const { rerender } = render(<El x={1} />);
    expect(renders).toBe(1);

    rerender(<El x={2} />);
    // Exactly one additional render: the render reaction does not track the
    // props atom, so the layout-effect reportChanged schedules no second pass.
    expect(renders).toBe(2);
    expect(screen.getByTestId('v').textContent).toBe('2');
  });

  it('computed over props settles to the correct value before paint; at most one extra pre-paint render', () => {
    let renders = 0;
    class Doubler extends Component<{ n: number }> {
      get doubled() {
        return this.props.n * 2;
      }
      render() {
        renders++;
        return <div data-testid="v">{this.doubled}</div>;
      }
    }
    const El = createComponent(Doubler);
    const { rerender } = render(<El n={1} />);
    expect(screen.getByTestId('v').textContent).toBe('2');
    const before = renders;

    rerender(<El n={5} />);
    // Settles correct (the computed invalidates after the layout-effect notify).
    expect(screen.getByTestId('v').textContent).toBe('10');
    // At most one extra pre-paint render beyond the triggering one.
    expect(renders - before).toBeLessThanOrEqual(2);
  });

  it('React.memo skips the child when a parent re-render passes shallow-equal props', () => {
    let childRenders = 0;
    class Child extends Component<{ n: number }> {
      render() {
        childRenders++;
        return <span data-testid="c">{this.props.n}</span>;
      }
    }
    const ChildEl = createComponent(Child);
    class Parent extends Component {
      tick = 0;
      bump() {
        this.tick++;
      }
      render() {
        return (
          <button onClick={this.bump}>
            <ChildEl n={1} />
            <span data-testid="t">{this.tick}</span>
          </button>
        );
      }
    }
    const El = createComponent(Parent);
    render(<El />);
    expect(childRenders).toBe(1);

    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByTestId('t').textContent).toBe('1');
    // Child props unchanged (n={1}) → memo skipped the re-render.
    expect(childRenders).toBe(1);
  });

  it('this.props is usable in field initializers and via the onCreate proxy', () => {
    class Init extends Component<{ start: number }> {
      count = this.props.start;
      seenInOnCreate = -1;
      onCreate(props: { start: number }) {
        this.seenInOnCreate = props.start;
      }
      render() {
        return (
          <div data-testid="v">
            {this.count}-{this.seenInOnCreate}
          </div>
        );
      }
    }
    const El = createComponent(Init);
    render(<El start={7} />);
    expect(screen.getByTestId('v').textContent).toBe('7-7');
  });
});
