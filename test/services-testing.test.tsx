import React, { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { observable as store, isObservable, isObservableProp, runInAction } from 'mobx';
import { Component, Behavior, createBehavior, createComponent, configure, inject, ServiceProvider, createServiceToken, withInjectionScope, useBehavior, observer, isModel, type ServiceResolver } from '../src';
import 'reflect-metadata';
import { container } from 'tsyringe';
import { createTestScope } from '../src/testing';

const Store = createServiceToken<{ name: string }>('Store');
const resolver = (value: { name: string }): ServiceResolver => (() => value) as ServiceResolver;

describe('construction scopes', () => {
  it('uses the configured tsyringe container for both forms and retains the captured resolver', () => {
    class Preferences { name = 'shared'; }
    const services = container.createChildContainer();
    const preferences = new Preferences();
    services.registerInstance(Preferences, preferences);
    configure({ resolveService: token => services.resolve(token) });
    let model!: Model;
    class Model extends Component {
      preferences = inject(Preferences);
      same = this.inject(Preferences);
      onCreate() { model = this; }
      late() { return this.inject(Preferences); }
      render() { return <div>{this.preferences.name}</div>; }
    }
    const View = createComponent(Model);
    render(<View />);
    expect(model.preferences).toBe(services.resolve(Preferences));
    expect(model.same).toBe(preferences);
    expect(isObservableProp(model, 'preferences')).toBe(false);
    expect(isObservable(preferences)).toBe(false);
    configure({ resolveService: () => { throw new Error('new default'); } });
    expect(model.late()).toBe(preferences);
    // The same container can replace a service without changing either framework.
    const mock = new Preferences();
    services.registerInstance(Preferences, mock);
    expect(model.late()).toBe(mock);
    services.reset();
  });

  it('tracks imported injections in nested behaviors, onCreate and inherited fields', () => {
    const service = { name: 'default' };
    configure({ resolveService: resolver(service) });
    class Leaf extends Behavior { store = inject(Store); }
    const leaf = createBehavior(Leaf);
    class Uses extends Behavior {
      child = leaf();
      store = inject(Store);
      created!: { name: string };
      onCreate() { this.created = inject(Store); }
    }
    const use = createBehavior(Uses);
    class Base extends Component { first = inject(Store); }
    let model!: Model;
    class Model extends Base {
      nested = use();
      last = inject(Store);
      created!: { name: string };
      onCreate() { this.created = inject(Store); model = this; }
      render() { return null; }
    }
    const View = createComponent(Model);
    render(<View />);
    for (const [owner, key] of [[model, 'first'], [model, 'last'], [model, 'created'],
      [model.nested, 'store'], [model.nested, 'created'], [model.nested.child, 'store']] as const) {
      expect((owner as any)[key]).toBe(service);
      expect(isObservableProp(owner, key)).toBe(false);
    }
    const Plain = observer(() => {
      const behavior = useBehavior(() => use());
      return <span>{behavior.child.store.name}</span>;
    });
    render(<Plain />);
    expect(screen.getByText('default')).toBeTruthy();
  });

  it('prioritizes provider/test scopes and keeps a test scope strict unless given a fallback', () => {
    configure({ resolveService: resolver({ name: 'default' }) });
    class Model extends Component {
      store = inject(Store);
      render() { return <span>{this.store.name}</span>; }
    }
    const View = createComponent(Model);
    const scope = createTestScope();
    scope.service(Store, { name: 'mock' });
    render(<><View /><ServiceProvider resolve={resolver({ name: 'scoped' })}>
      <View /><scope.Provider><View /></scope.Provider>
    </ServiceProvider></>);
    for (const name of ['default', 'scoped', 'mock']) expect(screen.getByText(name)).toBeTruthy();
    const strict = createTestScope();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { expect(() => render(<strict.Provider><View /></strict.Provider>)).toThrow('No service registered'); }
    finally { error.mockRestore(); }
  });

  it('restores nested scopes after errors and rejects unscoped/async lookups despite a default resolver', async () => {
    const outer = { name: 'outer' }, inner = { name: 'inner' };
    configure({ resolveService: resolver(outer) });
    expect(() => inject(Store)).toThrow('active construction scope');
    withInjectionScope(undefined, () => {
      expect(inject(Store)).toBe(outer);
      expect(() => withInjectionScope(resolver(inner), () => {
        expect(inject(Store)).toBe(inner);
        throw new Error('abort');
      })).toThrow('abort');
      expect(inject(Store)).toBe(outer);
    });
    await expect(withInjectionScope(undefined, async () => {
      await Promise.resolve();
      inject(Store);
    })).rejects.toThrow('active construction scope');
    expect(() => inject(Store)).toThrow('active construction scope');
    configure({ resolveService: undefined });
    expect(() => withInjectionScope(undefined, () => inject(Store))).toThrow('resolveService');
    expect(() => withInjectionScope((() => 7) as unknown as ServiceResolver, () => inject(Store))).toThrow('objects or functions');
  });

  it('retains exact service identity in inherited fields, nested behaviors and later calls; scopes survive exceptions', () => {
    const a = { name: 'A' }, b = { name: 'B' };
    class Uses extends Behavior { store = this.inject(Store); }
    const use = createBehavior(Uses);
    class Base extends Component { store = this.inject(Store); }
    let model!: Model;
    class Model extends Base {
      nested = use();
      onCreate() { model = this; }
      late() { return this.inject(Store); }
      render() { return <div>{this.store.name}/{this.nested.store.name}</div>; }
    }
    const View = createComponent(Model);
    const mounted = render(<ServiceProvider resolve={resolver(a)}><View /></ServiceProvider>);
    expect(screen.getByText('A/A')).toBeTruthy();
    expect(model.store).toBe(a);
    expect(model.nested.store).toBe(a);
    expect(isObservableProp(model, 'store')).toBe(false);
    expect(isObservable(a)).toBe(false);
    mounted.rerender(<ServiceProvider resolve={resolver(b)}><View /></ServiceProvider>);
    expect(model.late()).toBe(a);
    expect(() => withInjectionScope(resolver(b), () => { throw new Error('abort'); })).toThrow('abort');
    expect(() => new Base()).toThrow('ServiceProvider');
    expect(withInjectionScope(resolver(b), () => new Base()).store).toBe(b);
  });

  it('isolates roots and nested providers; plain React behavior hosts use the same scope', () => {
    class Uses extends Behavior { store = this.inject(Store); }
    const use = createBehavior(Uses);
    const View = observer(() => { const vm = useBehavior(() => use()); return <div>{vm.store.name}</div>; });
    render(<ServiceProvider resolve={resolver({ name: 'outer' })}><View /><ServiceProvider resolve={resolver({ name: 'inner' })}><View /></ServiceProvider></ServiceProvider>);
    render(<ServiceProvider resolve={resolver({ name: 'second-root' })}><View /></ServiceProvider>);
    expect(screen.getByText('outer')).toBeTruthy();
    expect(screen.getByText('inner')).toBeTruthy();
    expect(screen.getByText('second-root')).toBeTruthy();
  });
});

describe('model substitution at construction', () => {
  it('uses a real model with fake services or bypasses it entirely, preserving observable state and props', () => {
    const realCreation = vi.fn();
    const lifecycle = vi.fn();
    const fakeStore = store({ name: 'fake' });
    let rendered!: Model;
    class Model extends Component<{ suffix: string }> {
      store = this.inject(Store);
      count = 0;
      field = realCreation();
      onCreate() { lifecycle(); }
      onMount() { lifecycle(); }
      onUnmount() { lifecycle(); }
    }
    const View = createComponent(Model, vm => { rendered = vm; return <div>{vm.store.name}:{vm.count}:{vm.props.suffix}</div>; });
    const real = createTestScope(); real.service(Store, fakeStore);
    const mount = render(<real.Provider><View suffix="real" /></real.Provider>);
    expect(realCreation).toHaveBeenCalledTimes(1);
    expect(rendered.store).toBe(fakeStore);
    mount.unmount(); realCreation.mockClear(); lifecycle.mockClear();

    const isolated = createTestScope();
    isolated.model(Model, () => ({ store: fakeStore, count: 2 }));
    const result = render(<StrictMode><isolated.Provider><View suffix="one" /></isolated.Provider></StrictMode>);
    expect(realCreation).not.toHaveBeenCalled();
    expect(lifecycle).not.toHaveBeenCalled();
    expect(rendered.store).toBe(fakeStore);
    expect(rendered instanceof Model).toBe(false);
    expect(isModel(rendered, Model)).toBe(true);
    const shell = rendered;
    act(() => runInAction(() => { shell.count = 4; fakeStore.name = 'updated'; }));
    expect(screen.getByText('updated:4:one')).toBeTruthy();
    isolated.model(Model, () => ({ count: 999 }));
    result.rerender(<StrictMode><isolated.Provider><View suffix="two" /></isolated.Provider></StrictMode>);
    expect(rendered).toBe(shell);
    expect(screen.getByText('updated:4:two')).toBeTruthy();
    result.unmount(); expect(lifecycle).not.toHaveBeenCalled();
  });

  it('creates independent per-instance data and preserves logical ancestry without original rendering', () => {
    const scope = createTestScope();
    class Parent extends Component { render(): never { throw new Error('original render must not run'); } }
    let parent!: Parent;
    class Child extends Component {
      found = this.findParent(Parent);
      render() { parent = this.found!; return <span>child</span>; }
    }
    const ChildView = createComponent(Child);
    const shells: Parent[] = [];
    scope.model(Parent, () => ({ list: [] }), { template: vm => { shells.push(vm); return <div><ChildView /></div>; } });
    const View = createComponent(Parent);
    render(<scope.Provider><View /><View /></scope.Provider>);
    expect(parent).toBe(shells[1]);
    expect((shells[0] as any).list).not.toBe((shells[1] as any).list);
    expect(isModel(parent, Parent)).toBe(true);
  });
});
