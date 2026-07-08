import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import * as mobx from 'mobx';
import { Component, createComponent, configure } from '../src';

/**
 * This file is isolated (vitest gives each file a fresh module graph), so the
 * opt-out can be set before Mantle ever applies its action policy. It asserts
 * Mantle does not call mobx.configure({ enforceActions }) when the app opts
 * out with manageMobxActions: false.
 */
describe('Action enforcement opt-out (manageMobxActions: false)', () => {
  let configureSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // Opt out before the first component is ever created.
    configure({ manageMobxActions: false });
    configureSpy = vi.spyOn(mobx, 'configure');
  });

  it('Mantle leaves MobX enforceActions untouched', () => {
    class C extends Component {
      value = 0;
      render() {
        return <div>{this.value}</div>;
      }
    }
    const El = createComponent(C); // creation triggers applyMobxActionPolicy
    render(<El />);

    const touchedEnforceActions = configureSpy.mock.calls.some(
      (call) => call[0] && typeof call[0] === 'object' && 'enforceActions' in call[0]
    );
    expect(touchedEnforceActions).toBe(false);
  });
});
