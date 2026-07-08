import { describe, it, expect } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import {
  isObservable,
  isObservableProp,
  runInAction,
  observable as mobxObservable,
} from 'mobx';
import { Component, createComponent, observable, action, computed } from '../src';
import { getAnnotations } from '../src/decorators';

describe('Decorator modes', () => {
  it('mantle decorators: decorated fields reactive, undecorated inert, methods auto-bound', () => {
    let inst!: C;
    class C extends Component {
      @observable count = 0;
      plain = 5; // undecorated → inert
      @computed get doubled() {
        return this.count * 2;
      }
      @action inc() {
        this.count++;
      }
      onCreate() {
        inst = this;
      }
      render() {
        const cb = this.inc; // detached → proves auto-bind
        return (
          <button onClick={cb} data-testid="v">
            {this.doubled}
          </button>
        );
      }
    }
    const El = createComponent(C, { autoObservable: false });
    render(<El />);

    expect(isObservableProp(inst, 'count')).toBe(true);
    expect(isObservableProp(inst, 'plain')).toBe(false);
    expect(screen.getByTestId('v').textContent).toBe('0');

    // decorated field reactive + method auto-bound as a bare callback
    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByTestId('v').textContent).toBe('2');
  });

  it('mantle decorators: ref/shallow/struct variants', () => {
    const fires: string[] = [];
    let inst!: C;
    class C extends Component {
      @observable.ref refObj = { x: 1 };
      @observable.shallow list: number[] = [1, 2];
      @observable.struct point = { x: 0, y: 0 };
      onCreate() {
        inst = this;
      }
      onMount() {
        this.watch(
          () => this.point,
          () => fires.push('point')
        );
      }
      render() {
        return <div />;
      }
    }
    const El = createComponent(C, { autoObservable: false });
    render(<El />);

    // ref: value stored by reference, not deep-wrapped
    expect(isObservableProp(inst, 'refObj')).toBe(true);
    expect(isObservable(inst.refObj)).toBe(false);
    // shallow: the collection is observable but its contents are not deep
    expect(isObservableProp(inst, 'list')).toBe(true);
    expect(isObservable(inst.list[0] as unknown as object)).toBe(false);

    // struct: assigning a structurally-equal value does not fire
    act(() => {
      runInAction(() => {
        inst.point = { x: 0, y: 0 };
      });
    });
    expect(fires).toEqual([]);
    // a different value does fire
    act(() => {
      runInAction(() => {
        inst.point = { x: 1, y: 0 };
      });
    });
    expect(fires).toEqual(['point']);
  });

  it('legacy MobX decorators (accessor form) work with autoObservable:false', () => {
    class C extends Component {
      @mobxObservable accessor count = 0;
      inc() {
        (this as unknown as { count: number }).count++;
      }
      render() {
        return (
          <button onClick={() => this.inc()} data-testid="v">
            {(this as unknown as { count: number }).count}
          </button>
        );
      }
    }
    const El = createComponent(C, { autoObservable: false });
    render(<El />);
    expect(screen.getByTestId('v').textContent).toBe('0');
    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    // makeObservable(instance) picked up MobX's own decorator metadata
    expect(screen.getByTestId('v').textContent).toBe('1');
  });

  it('getAnnotations returns undefined for an undecorated class (auto-observable fallback)', () => {
    class Plain extends Component {
      count = 0;
      render() {
        return <div />;
      }
    }
    const inst = new Plain();
    expect(getAnnotations(inst)).toBeUndefined();
  });

  it('behaves gracefully when Symbol.metadata is absent', () => {
    const original = (Symbol as unknown as { metadata?: symbol }).metadata;
    // Simulate an older runtime with no Symbol.metadata well-known symbol.
    delete (Symbol as unknown as { metadata?: symbol }).metadata;
    try {
      // getAnnotations must not throw when Symbol.metadata is undefined.
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
      expect(() => getAnnotations(new C())).not.toThrow();

      // Auto-observable path still works without the metadata symbol.
      const El = createComponent(C);
      render(<El />);
      act(() => {
        fireEvent.click(screen.getByRole('button'));
      });
      expect(screen.getByTestId('v').textContent).toBe('1');
    } finally {
      Object.defineProperty(Symbol, 'metadata', {
        value: original,
        configurable: true,
        enumerable: false,
        writable: false,
      });
    }
  });
});
