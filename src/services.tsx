import React from 'react';

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

let constructingResolver: ServiceResolver | undefined;
const scopes = new WeakMap<object, { resolve: ServiceResolver | undefined; values: WeakSet<object> }>();

/** Synchronous construction scope, also useful outside React. Does not own services. */
export function withServiceScope<T>(resolve: ServiceResolver | undefined, construct: () => T): T {
  const previous = constructingResolver;
  constructingResolver = resolve;
  try { return construct(); } finally { constructingResolver = previous; }
}
export function captureServiceScope(owner: object): void {
  scopes.set(owner, { resolve: constructingResolver, values: new WeakSet() });
}
export function resolveService<T extends object>(owner: object, token: ServiceToken<T>): T {
  const scope = scopes.get(owner);
  if (!scope?.resolve) throw new Error('[mobx-mantle] this.getService() requires a ServiceProvider or withServiceScope() during construction.');
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
  return withServiceScope(scopes.get(owner)?.resolve, construct);
}
