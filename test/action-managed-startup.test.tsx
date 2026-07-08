import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as mobx from 'mobx';
import { Component, createComponent } from '../src';

/**
 * Positive control for the opt-out test: in a fresh module with the default
 * config, Mantle applies enforceActions: 'never' at the first component
 * creation. This also proves the mobx.configure spy actually intercepts the
 * call Mantle makes — so the opt-out file's "not called" assertion is real.
 */
describe('Action enforcement managed startup', () => {
  it('sets MobX enforceActions to "never" at first component creation', () => {
    const configureSpy = vi.spyOn(mobx, 'configure');
    class C extends Component {
      value = 0;
      render() {
        return <div>{this.value}</div>;
      }
    }
    const El = createComponent(C);
    render(<El />);

    const call = configureSpy.mock.calls.find(
      (c) => c[0] && typeof c[0] === 'object' && 'enforceActions' in c[0]
    );
    expect(call).toBeTruthy();
    expect((call![0] as { enforceActions?: string }).enforceActions).toBe('never');
    configureSpy.mockRestore();
  });
});
