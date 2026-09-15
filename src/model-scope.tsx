import React from 'react';
import type { Component } from './mantle';

export type ModelClass<C extends Component<any> = Component<any>> = new (...args: any[]) => C;
export interface ModelSubstitution<C extends Component<any> = Component<any>> {
  /** Runs for each instance instead of its original constructor. Supply data/callbacks only. */
  state: () => object;
  /** Required for integrated render() classes; optional for separate templates. */
  template?: (model: C) => React.JSX.Element;
}
export const ModelContext = React.createContext<ReadonlyMap<ModelClass, ModelSubstitution> | undefined>(undefined);
/** Construction policy. The mounted tree takes a snapshot; remount to change it. */
export function ModelProvider({ models, children }: { models: ReadonlyMap<ModelClass, ModelSubstitution>; children?: React.ReactNode }) {
  const [snapshot] = React.useState(() => new Map(Array.from(models, ([type, replacement]) => [type, { ...replacement }])));
  return <ModelContext.Provider value={snapshot}>{children}</ModelContext.Provider>;
}
const identities = new WeakMap<object, ModelClass>();
export function setModelIdentity(model: object, type: ModelClass): void { identities.set(model, type); }
/** Logical identity works for real and substituted models. It does not fake instanceof. */
export function isModel<C extends Component<any>>(model: object, type: abstract new (...args: any[]) => C): model is C {
  const logical = identities.get(model);
  return model instanceof type || logical === (type as Function) || !!logical && logical.prototype instanceof type;
}
