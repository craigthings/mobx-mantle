import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { isObservable } from 'mobx';
import { Component, Behavior, createComponent, createBehavior, configure } from '../src';
import { isBehavior } from '../src/behavior';

describe('Core auto-observable semantics', () => {
  it('field mutation re-renders; getter behaves as a cached, invalidating computed', () => {
    let computeCount = 0;
    class C extends Component {
      count = 0;
      get doubled() {
        computeCount++;
        return this.count * 2;
      }
      inc() {
        this.count++;
      }
      render() {
        return (
          <button onClick={this.inc} data-testid="v">
            {this.doubled}/{this.doubled}
          </button>
        );
      }
    }
    const El = createComponent(C);
    render(<El />);
    // read twice in one render → computed cached → one computation
    expect(computeCount).toBe(1);
    expect(screen.getByTestId('v').textContent).toBe('0/0');

    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    // mutation invalidated + recomputed once
    expect(computeCount).toBe(2);
    expect(screen.getByTestId('v').textContent).toBe('2/2');
  });

  it('inheritance: a two-level subclass gets fields/getters/methods from every level', () => {
    class Base extends Component {
      a = 1;
      get ga() {
        return this.a + 10;
      }
      ma() {
        this.a++;
      }
    }
    class Sub extends Base {
      b = 2;
      get gb() {
        return this.b + 20;
      }
      both() {
        this.ma();
        this.b++;
      }
      render() {
        return (
          <button onClick={this.both} data-testid="v">
            {this.a}-{this.b}-{this.ga}-{this.gb}
          </button>
        );
      }
    }
    const El = createComponent(Sub);
    render(<El />);
    expect(screen.getByTestId('v').textContent).toBe('1-2-11-22');

    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    // base field + sub field mutated; both getters recomputed
    expect(screen.getByTestId('v').textContent).toBe('2-3-12-23');
  });

  it('this.ref() objects and behavior instances are observable.ref (identity preserved)', () => {
    class Bhv extends Behavior {
      value = 0;
    }
    const withBhv = createBehavior(Bhv);
    let inst!: C;
    class C extends Component {
      el = this.ref<HTMLDivElement>();
      bhv = withBhv();
      onCreate() {
        inst = this;
      }
      render() {
        return <div ref={this.el} />;
      }
    }
    const El = createComponent(C);
    render(<El />);

    // ref() object is stored by reference, not deep-wrapped
    expect(isObservable(inst.el)).toBe(false);
    expect('current' in inst.el).toBe(true);
    // behavior kept its identity (marker intact) rather than being re-wrapped
    expect(isBehavior(inst.bhv)).toBe(true);
  });

  it('smartBind: multi-field mutation in an event handler batches into one render', () => {
    let renders = 0;
    class C extends Component {
      a = 0;
      b = 0;
      bump() {
        this.a++;
        this.b++;
      }
      render() {
        renders++;
        return (
          <button onClick={this.bump} data-testid="v">
            {this.a + this.b}
          </button>
        );
      }
    }
    const El = createComponent(C);
    render(<El />);
    expect(renders).toBe(1);

    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    // two mutations, one batched render
    expect(renders).toBe(2);
    expect(screen.getByTestId('v').textContent).toBe('2');
  });

  it('smartBind: a method called inside render still tracks observables', () => {
    class C extends Component {
      count = 0;
      double() {
        return this.count * 2;
      }
      inc() {
        this.count++;
      }
      render() {
        return (
          <button onClick={this.inc} data-testid="v">
            {this.double()}
          </button>
        );
      }
    }
    const El = createComponent(C);
    render(<El />);
    expect(screen.getByTestId('v').textContent).toBe('0');

    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    // If double() were action-wrapped it would break tracking and never update.
    expect(screen.getByTestId('v').textContent).toBe('2');
  });

  it('a method passed as a bare callback keeps its `this`', () => {
    class C extends Component {
      count = 0;
      inc() {
        this.count++;
      }
      render() {
        const cb = this.inc; // detached reference
        return (
          <button onClick={cb} data-testid="v">
            {this.count}
          </button>
        );
      }
    }
    const El = createComponent(C);
    render(<El />);
    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByTestId('v').textContent).toBe('1');
  });

  it('dev warning fires for a field first assigned in onCreate without a class-field declaration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class C extends Component {
      onCreate() {
        (this as unknown as { late: number }).late = 5;
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C);
    render(<El />);
    const hit = warn.mock.calls
      .map((a) => String(a[0]))
      .find((m) => m.includes('C.late') && m.includes('not reactive'));
    expect(hit).toBeTruthy();
    warn.mockRestore();
  });
});

describe('Annotation caching', () => {
  it('a second instance behaves identically to the first (cache-hit path)', () => {
    class C extends Component {
      count = 0;
      inc() {
        this.count++;
      }
      render() {
        return (
          <button onClick={this.inc} data-testid="v">
            {this.count}
          </button>
        );
      }
    }
    const El = createComponent(C);
    const first = render(<El />);
    act(() => {
      fireEvent.click(first.getByTestId('v'));
    });
    expect(first.getByTestId('v').textContent).toBe('1');
    first.unmount();

    // Second instance uses the cached prototype info; must behave the same.
    const second = render(<El />);
    expect(second.getByTestId('v').textContent).toBe('0');
    act(() => {
      fireEvent.click(second.getByTestId('v'));
    });
    expect(second.getByTestId('v').textContent).toBe('1');
  });

  it('spyOn a prototype method before instantiation is honored (names, not references)', () => {
    class C extends Component {
      greet() {
        return 'hi';
      }
      render() {
        return <div data-testid="v">{this.greet()}</div>;
      }
    }
    const El = createComponent(C);
    // Spy installed before any instance is constructed.
    const spy = vi.spyOn(C.prototype, 'greet').mockReturnValue('spied');
    render(<El />);
    expect(screen.getByTestId('v').textContent).toBe('spied');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('configure({ cacheAnnotations: false }) produces identical behavior', () => {
    configure({ cacheAnnotations: false });
    class C extends Component {
      count = 0;
      get doubled() {
        return this.count * 2;
      }
      inc() {
        this.count++;
      }
      render() {
        return (
          <button onClick={this.inc} data-testid="v">
            {this.doubled}
          </button>
        );
      }
    }
    const El = createComponent(C);
    render(<El />);
    expect(screen.getByTestId('v').textContent).toBe('0');
    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByTestId('v').textContent).toBe('2');
    // reset handled by global afterEach
  });

  it('subclass and superclass get independent cache entries', () => {
    class Base extends Component {
      a = 1;
      ma() {
        this.a++;
      }
      render() {
        return (
          <button onClick={this.ma} data-testid="base">
            {this.a}
          </button>
        );
      }
    }
    class Sub extends Base {
      b = 10;
      mb() {
        this.b++;
      }
      render() {
        return (
          <button onClick={this.mb} data-testid="sub">
            {this.a}/{this.b}
          </button>
        );
      }
    }
    const BaseEl = createComponent(Base);
    const SubEl = createComponent(Sub);

    const base = render(<BaseEl />);
    expect(base.getByTestId('base').textContent).toBe('1');
    base.unmount();

    const sub = render(<SubEl />);
    // Sub sees both its own field and the inherited one — its own cache entry.
    expect(sub.getByTestId('sub').textContent).toBe('1/10');
    act(() => {
      fireEvent.click(sub.getByTestId('sub'));
    });
    expect(sub.getByTestId('sub').textContent).toBe('1/11');
  });
});
