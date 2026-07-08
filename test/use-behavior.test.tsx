import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { runInAction } from 'mobx';
import { Behavior, createBehavior, useBehavior, observer } from '../src';

class Counter extends Behavior {
  count = 0;
  mounted = false;
  unmounted = false;
  onMount() {
    this.mounted = true;
  }
  onUnmount() {
    this.unmounted = true;
  }
}
const withCounter = createBehavior(Counter);

describe('useBehavior() adapter', () => {
  it('hosts a behavior in a plain function component: mounts, reacts, unmounts', () => {
    let inst!: Counter;
    const Cmp = observer(() => {
      const c = useBehavior(() => {
        inst = withCounter();
        return inst;
      });
      return <span data-testid="v">{c.count}</span>;
    });
    const { unmount } = render(<Cmp />);

    expect(inst.mounted).toBe(true);
    expect(screen.getByTestId('v').textContent).toBe('0');

    // observer() makes the render track the behavior's observables
    act(() => {
      runInAction(() => {
        inst.count++;
      });
    });
    expect(screen.getByTestId('v').textContent).toBe('1');

    act(() => {
      unmount();
    });
    expect(inst.unmounted).toBe(true);
  });

  it('survives a StrictMode double-mount and still reacts', () => {
    let inst!: Counter;
    const Cmp = observer(() => {
      const c = useBehavior(() => {
        inst = withCounter();
        return inst;
      });
      return <span data-testid="v">{c.count}</span>;
    });
    render(
      <StrictMode>
        <Cmp />
      </StrictMode>
    );

    act(() => {
      runInAction(() => {
        inst.count += 2;
      });
    });
    expect(screen.getByTestId('v').textContent).toBe('2');
  });

  it('factory runs exactly once across re-renders', () => {
    let factoryCalls = 0;
    let bump!: () => void;
    const Cmp = observer(() => {
      const c = useBehavior(() => {
        factoryCalls++;
        return withCounter();
      });
      // expose a way to force a re-render from outside
      bump = () =>
        act(() => {
          runInAction(() => {
            c.count++;
          });
        });
      return <span data-testid="v">{c.count}</span>;
    });
    render(<Cmp />);
    expect(factoryCalls).toBe(1);

    bump();
    bump();
    expect(screen.getByTestId('v').textContent).toBe('2');
    // Re-renders did not reconstruct the behavior.
    expect(factoryCalls).toBe(1);
  });
});
