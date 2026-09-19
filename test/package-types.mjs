import assert from 'node:assert/strict';
import path from 'node:path';
import ts from 'typescript';
const source = `
import { Component, configure, inject, ServiceProvider, createComponent, createServiceToken, type ServiceResolver } from 'mobx-mantle';
import { createTestScope } from 'mobx-mantle/testing';
import { withTimeout } from 'mobx-mantle/behaviors';
import { container } from 'tsyringe';
class Store { label = 'reports'; }
const resolve: ServiceResolver = token => container.resolve(token);
configure({ resolveService: token => container.resolve(token) });
const Named = createServiceToken<Store>('named');
class Model extends Component { store = inject(Store); named = this.inject(Named); timer = withTimeout(() => {}, 1); }
const scope = createTestScope({ resolve }); scope.service(Store, new Store());
scope.model(Model, () => ({ store: new Store() }));
`;
for (const suffix of ['mts', 'cts']) {
  const file = path.resolve('test/package-consumer.' + suffix);
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, noEmit: true, types: [] };
  const host = ts.createCompilerHost(options), getSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, error, fresh) => path.resolve(name) === file ? ts.createSourceFile(name, source, language, true) : getSource(name, language, error, fresh);
  const program = ts.createProgram([file], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  console.log(`${suffix}: emitted core, behaviors, testing declarations and tsyringe resolver passed`);
}
