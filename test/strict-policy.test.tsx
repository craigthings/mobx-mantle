import { render, act } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import * as mobx from 'mobx';
import { Component, createComponent } from '../src';
import { withAsync, withTimeout, withMediaQuery } from '../src/behaviors';

it('preserves a strict host policy while lifecycle, async behavior and timer writes remain actions', async () => {
  mobx.configure({ enforceActions: 'always' });
  const policy = vi.spyOn(mobx, 'configure');
  const warnings = vi.spyOn(console, 'warn');
  const changes: number[] = [];
  let vm!: Model;
  class Model extends Component {
    count = 0;
    task = withAsync(async () => 'loaded');
    timeout = withTimeout(() => { this.count = 3; }, 1);
    media = withMediaQuery('(min-width: 1px)');
    onCreate() { vm = this; this.count = 1; this.effect(() => { changes.push(this.count); }); }
    onMount() { this.count = 2; return () => { this.count = 4; }; }
    render() { return <div>{this.count}:{this.task.value}:{String(this.timeout.pending)}</div>; }
  }
  const View = createComponent(Model);
  const result = render(<View />);
  await act(async () => { await vm.task.run(); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(vm.task.value).toBe('loaded');
  expect(changes).toContain(3); // Effect reads stayed tracked, not hidden inside an action.
  expect(policy).not.toHaveBeenCalled();
  result.unmount();
  expect(warnings.mock.calls.filter(args => /strict-mode|without using an action/.test(String(args[0])))).toEqual([]);
  policy.mockRestore();
  mobx.configure({ enforceActions: 'observed' });
});
