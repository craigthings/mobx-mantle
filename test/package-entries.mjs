import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToString } from 'react-dom/server';
const require = createRequire(import.meta.url);
for (const format of ['esm', 'cjs']) {
  const load = format === 'esm' ? name => import(name) : name => require(name);
  const core = await load('mobx-mantle');
  const { createTestScope } = await load('mobx-mantle/testing');
  const { withTimeout } = await load('mobx-mantle/behaviors');
  assert(withTimeout(() => {}, 1) instanceof core.Behavior, `${format}: stock behaviors share core runtime`);
  const Token = core.createServiceToken('Store');
  class Model extends core.Component { store = core.inject(Token); }
  const View = core.createComponent(Model, vm => React.createElement('b', null, vm.store.label));
  const real = createTestScope(); real.service(Token, { label: 'service' });
  assert.match(renderToString(React.createElement(real.Provider, null, React.createElement(View))), /service/);
  core.configure({ resolveService: () => ({ label: 'configured' }) });
  assert.match(renderToString(React.createElement(View)), /configured/);
  assert.throws(() => core.inject(Token), /active construction scope/);
  assert.equal(core.withInjectionScope(undefined, () => core.inject(Token)).label, 'configured');
  assert.equal('withServiceScope' in core, false);
  core.configure({ resolveService: undefined });
  class Never extends core.Component { constructor() { super(); throw Error('Real constructor ran'); } }
  const Isolated = core.createComponent(Never, vm => React.createElement('b', null, vm.label));
  const mock = createTestScope(); mock.model(Never, () => ({ label: 'substitute' }));
  assert.match(renderToString(React.createElement(mock.Provider, null, React.createElement(Isolated))), /substitute/);
  console.log(`${format}: core, behaviors, testing and provider identity passed`);
}
