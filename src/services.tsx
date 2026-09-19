import React from 'react';
import { globalConfig } from './config';

declare const serviceType: unique symbol;
/** Class tokens and typed symbols are also valid tsyringe injection tokens. */
export type ServiceToken<T extends object> = (new (...args: any[]) => T) | (symbol & { readonly [serviceType]: T });
export type ServiceResolver = <T extends object>(token: ServiceToken<T>) => T;
export function createServiceToken<T extends object>(description: string): ServiceToken<T> {
  return Symbol(description) as ServiceToken<T>;
}

export const ServiceContext = React.createContext<ServiceResolver | undefined>(undefined);
export function ServiceProvider({ resolve, children }: { resolve: ServiceResolver; children?: React.ReactNode }) {
  return <ServiceContext.Provider value={resolve}>{children}</ServiceContext.Provider>;
}

interface ServiceScope {
  resolve: ServiceResolver | undefined;
  values: WeakSet<object>;
}
let constructingScope: ServiceScope | undefined;
const scopes = new WeakMap<object, ServiceScope>();

function runWithScope<T>(scope: ServiceScope, construct: () => T): T {
  const previous = constructingScope;
  constructingScope = scope;
  try { return construct(); } finally { constructingScope = previous; }
}

/** Synchronous construction scope, also useful outside React. Does not own services. */
export function withInjectionScope<T>(resolve: ServiceResolver | undefined, construct: () => T): T {
  return runWithScope({ resolve: resolve ?? globalConfig.resolveService, values: new WeakSet() }, construct);
}
export function captureServiceScope(owner: object): void {
  scopes.set(owner, constructingScope ?? { resolve: globalConfig.resolveService, values: new WeakSet() });
}
export function resolveService<T extends object>(owner: object, token: ServiceToken<T>): T {
  return resolveInScope(scopes.get(owner), token);
}

/** Resolve during synchronous construction/onCreate, or inside withInjectionScope(). */
export function inject<T extends object>(token: ServiceToken<T>): T {
  if (!constructingScope) {
    throw new Error('[mobx-mantle] inject() requires an active construction scope. Use this.inject() in later methods, or withInjectionScope() outside React.');
  }
  return resolveInScope(constructingScope, token);
}

function resolveInScope<T extends object>(scope: ServiceScope | undefined, token: ServiceToken<T>): T {
  if (!scope?.resolve) throw new Error('[mobx-mantle] Service injection requires configure({ resolveService }), a ServiceProvider, or withInjectionScope() during construction.');
  const value = scope.resolve(token);
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    throw new Error('[mobx-mantle] Services must be objects or functions; wrap primitive configuration in an object.');
  }
  scope.values.add(value);
  return value;
}
export function isServiceValue(owner: object, value: unknown): boolean {
  return scopes.get(owner)?.values.has(value as object) ?? false;
}
export function withOwnerServiceScope<T>(owner: object, construct: () => T): T {
  const scope = scopes.get(owner);
  if (!scope) throw new Error('[mobx-mantle] Missing owner service scope.');
  return runWithScope(scope, construct);
}
