import React from 'react';
// Import the public core, including in CJS: one construction runtime/context.
import { ModelProvider, ServiceProvider, type ModelClass, type ModelSubstitution, type ServiceToken, type ServiceResolver } from 'mobx-mantle';

/** Test-local registrations. Providers snapshot them at mount; no global mocks. */
export function createTestScope(options: { resolve?: ServiceResolver } = {}) {
  const services = new Map<ServiceToken<any>, object>();
  const models = new Map<ModelClass, ModelSubstitution>();
  return {
    service<T extends object>(token: ServiceToken<T>, value: T) { services.set(token, value); },
    model<C extends InstanceType<ModelClass>>(type: ModelClass<C>, state: () => object, options?: { template?: (model: C) => React.JSX.Element }) {
      models.set(type, { state, template: options?.template } as ModelSubstitution);
    },
    Provider({ children }: { children?: React.ReactNode }) {
      const [snapshot] = React.useState(() => {
        const values = new Map(services);
        const fallback = options.resolve;
        const resolve: ServiceResolver = token => {
          if (values.has(token)) return values.get(token) as any;
          if (fallback) return fallback(token);
          throw new Error(`[mobx-mantle/testing] No service registered for ${String(token)}.`);
        };
        return { resolve, models: new Map(models) };
      });
      return <ServiceProvider resolve={snapshot.resolve}><ModelProvider models={snapshot.models}>{children}</ModelProvider></ServiceProvider>;
    },
  };
}
