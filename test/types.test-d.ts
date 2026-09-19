import { expectTypeOf } from 'expect-type';
import type { ComponentType, ForwardRefExoticComponent, RefAttributes } from 'react';
import {
  Component,
  Behavior,
  createComponent,
  createForwardRef,
  createBehavior,
  inject,
  createServiceToken,
  type ComponentConstructor,
  type MantleComponent,
} from '../src';

class InjectedService { title = 'reports'; }
const InjectedToken = createServiceToken<InjectedService>('service');
class ServiceConsumer extends Component {
  service = inject(InjectedService);
  named = inject(InjectedToken);
  later() { return this.inject(InjectedService); }
}
declare const consumer: ServiceConsumer;
expectTypeOf(consumer.service).toEqualTypeOf<InjectedService>();
expectTypeOf(consumer.named).toEqualTypeOf<InjectedService>();
expectTypeOf(consumer.later).returns.toEqualTypeOf<InjectedService>();
// @ts-expect-error getService was replaced, with no compatibility alias.
consumer.getService(InjectedService);

// ---------------------------------------------------------------------------
// PropsOf inference: createComponent surfaces the class's prop type
// ---------------------------------------------------------------------------
interface FooProps {
  a: number;
  b?: string;
}
class Foo extends Component<FooProps> {
  render() {
    return null;
  }
}
const FooEl = createComponent(Foo);

expectTypeOf(FooEl).toEqualTypeOf<MantleComponent<FooProps>>();
expectTypeOf(FooEl).parameter(0).toEqualTypeOf<FooProps>();

// ---------------------------------------------------------------------------
// MantleComponent is assignable to strict ComponentType consumers
// (react-window / react-virtualized style APIs)
// ---------------------------------------------------------------------------
const asComponentType: ComponentType<FooProps> = FooEl;
expectTypeOf(asComponentType).toMatchTypeOf<ComponentType<FooProps>>();

// ---------------------------------------------------------------------------
// createForwardRef: ref type flows through
// ---------------------------------------------------------------------------
class Field extends Component<{ x: number }> {
  render() {
    return null;
  }
}
const FieldEl = createForwardRef<HTMLInputElement, Field>(Field);

expectTypeOf(FieldEl).toMatchTypeOf<
  ForwardRefExoticComponent<{ x: number } & RefAttributes<HTMLInputElement>>
>();
// A ref of the declared element type is accepted where the component is used.
const refConsumer: ForwardRefExoticComponent<
  { x: number } & RefAttributes<HTMLInputElement>
> = FieldEl;
expectTypeOf(refConsumer).not.toBeAny();

// ---------------------------------------------------------------------------
// Ancestry: direct parent stays honest; class search narrows at runtime
// ---------------------------------------------------------------------------
class AncestryParent extends Component {
  parentOnly = true;
}
const ancestryParentType: ComponentConstructor<AncestryParent> = AncestryParent;
declare const ancestryChild: Component;

expectTypeOf(ancestryParentType).toMatchTypeOf<ComponentConstructor<AncestryParent>>();
expectTypeOf(ancestryChild.getParent()).toEqualTypeOf<Component<any> | undefined>();
expectTypeOf(ancestryChild.getRoot()).toEqualTypeOf<Component<any>>();
expectTypeOf(ancestryChild.findParent(AncestryParent))
  .toEqualTypeOf<AncestryParent | undefined>();
expectTypeOf(ancestryChild.getParents()).toEqualTypeOf<readonly Component<any>[]>();

// ---------------------------------------------------------------------------
// BehaviorArgs: onCreate params drive the factory signature...
// ---------------------------------------------------------------------------
class FromOnCreate extends Behavior {
  onCreate(a: string, b: number) {
    void a;
    void b;
  }
}
const withFromOnCreate = createBehavior(FromOnCreate);
expectTypeOf(withFromOnCreate).parameters.toEqualTypeOf<[string, number]>();

// ...but a constructor signature takes precedence over onCreate.
class FromCtor extends Behavior {
  constructor(public flag: boolean) {
    super();
  }
  onCreate(ignored: string) {
    void ignored;
  }
}
const withFromCtor = createBehavior(FromCtor);
expectTypeOf(withFromCtor).parameters.toEqualTypeOf<[boolean]>();
