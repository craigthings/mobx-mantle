import 'reflect-metadata';
import * as tsyringe from 'tsyringe';
import * as ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { isObservable, isObservableProp } from 'mobx';
import * as mantle from '../src';
import { getAnnotations } from '../src/decorators';

describe.each([false, true])('TypeScript compiler experimentalDecorators=%s', experimentalDecorators => {
  it('type-checks and runs inherited components and behaviors with real tsyringe tokens', () => {
    const filename = path.resolve('test/fixtures/decorator-consumer.tsx');
    let source = fs.readFileSync(filename.replace('.tsx', '.txt'), 'utf8');
    if (experimentalDecorators) {
      // Existing services retain real tsyringe constructor injection/metadata.
      source = source.replace("import { container }", "import { container, injectable, inject }");
      source += '\n@injectable() export class ReportingAgency { constructor(@inject(Preferences) public preferences: Preferences) {} }\n';
    }
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10, jsx: ts.JsxEmit.ReactJSX,
      strict: true, skipLibCheck: true, esModuleInterop: true,
      experimentalDecorators, emitDecoratorMetadata: experimentalDecorators,
      paths: { 'mobx-mantle': ['./src/index.ts'] }, noEmit: true,
    };
    const host = ts.createCompilerHost(options);
    const getSource = host.getSourceFile.bind(host);
    host.getSourceFile = (file, language, error, fresh) => path.resolve(file) === filename
      ? ts.createSourceFile(file, source, language, true, ts.ScriptKind.TSX)
      : getSource(file, language, error, fresh);
    const program = ts.createProgram([filename], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
    const code = ts.transpileModule(source, { fileName: filename, compilerOptions: { ...options, noEmit: false } }).outputText;
    const exports: any = {};
    new Function('require', 'exports', code)((id: string) => {
      if (id === 'mobx-mantle') return mantle;
      if (id === 'react/jsx-runtime') return jsxRuntime;
      if (id === 'react') return React;
      if (id === 'tsyringe') return tsyringe;
      throw new Error(`Unexpected import ${id}`);
    }, exports);
    const service = { label: 'injected' };
    const container = tsyringe.container.createChildContainer();
    container.registerInstance(exports.Preferences, service);
    const resolve: mantle.ServiceResolver = token => container.resolve(token);
    if (experimentalDecorators) expect(container.resolve<any>(exports.ReportingAgency).preferences).toBe(service);
    render(<mantle.ServiceProvider resolve={resolve}><exports.View suffix="live" /></mantle.ServiceProvider>);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('injected:3:live')).toBeTruthy();
    const base = mantle.withInjectionScope(resolve, () => new exports.Base({ suffix: '' }));
    const sibling = mantle.withInjectionScope(resolve, () => new exports.Sibling({ suffix: '' }));
    expect(Object.keys(getAnnotations(base)!).sort()).toEqual(['count', 'increment', 'title']);
    expect(getAnnotations(sibling)).not.toHaveProperty('record');
    const flag = mantle.withInjectionScope(resolve, () => exports.withFlag());
    expect(isObservableProp(flag, 'enabled')).toBe(true);
    expect(isObservableProp(flag, 'preferences')).toBe(false);
    expect(flag.preferences).toBe(service);
    const toggle = flag.toggle; toggle();
    expect(flag.label).toBe('injected');
    expect(isObservable(service)).toBe(false);
    container.dispose();
  }, 20000);
});
