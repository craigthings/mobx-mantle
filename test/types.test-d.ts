import { expectTypeOf } from 'expect-type';
import type { ComponentType, ForwardRefExoticComponent, RefAttributes } from 'react';
import {
  Component,
  Behavior,
  createComponent,
  createForwardRef,
  createBehavior,
  type MantleComponent,
} from '../src';

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
