import * as mobx from 'mobx';

/**
 * Symbol key for storing decorator annotations in class metadata.
 * These annotations are read by createComponent() after construction.
 */
export const ANNOTATIONS = Symbol('mantle:annotations');

/**
 * Decorator context type for TC39 decorators
 */
interface DecoratorContext {
  kind: 'field' | 'method' | 'getter' | 'setter' | 'accessor' | 'class';
  name: string | symbol;
  metadata: Record<symbol, unknown>;
}

/**
 * Helper to set annotation metadata
 */
function setAnnotation(context: DecoratorContext, annotation: any): void {
  context.metadata[ANNOTATIONS] ??= {};
  (context.metadata[ANNOTATIONS] as Record<string | symbol, any>)[context.name] = annotation;
}

/**
 * Marks a field as observable. No `accessor` keyword needed.
 * 
 * @example
 * ```tsx
 * class Counter extends Component {
 *   @observable count = 0;
 * }
 * export default createComponent(Counter);
 * ```
 */
export function observable(_value: undefined, context: DecoratorContext): void {
  setAnnotation(context, mobx.observable);
}

/**
 * Observable variants for different observation modes
 */
observable.ref = function(_value: undefined, context: DecoratorContext): void {
  setAnnotation(context, mobx.observable.ref);
};

observable.shallow = function(_value: undefined, context: DecoratorContext): void {
  setAnnotation(context, mobx.observable.shallow);
};

observable.struct = function(_value: undefined, context: DecoratorContext): void {
  setAnnotation(context, mobx.observable.struct);
};

observable.deep = function(_value: undefined, context: DecoratorContext): void {
  setAnnotation(context, mobx.observable.deep);
};

/**
 * Marks a method as an action. Auto-bound by default.
 * 
 * @example
 * ```tsx
 * class Counter extends Component {
 *   @observable count = 0;
 *   
 *   @action increment() {
 *     this.count++;
 *   }
 * }
 * export default createComponent(Counter);
 * ```
 */
export function action(_value: Function, context: DecoratorContext): void {
  setAnnotation(context, mobx.action.bound);
}

/**
 * Marks a getter as computed.
 * Note: Getters are automatically computed in autoObservable mode,
 * but this decorator is useful for explicit annotation.
 * 
 * @example
 * ```tsx
 * class Counter extends Component {
 *   @observable count = 0;
 *   
 *   @computed get doubled() {
 *     return this.count * 2;
 *   }
 * }
 * export default createComponent(Counter);
 * ```
 */
export function computed(_value: Function, context: DecoratorContext): void {
  setAnnotation(context, mobx.computed);
}

/**
 * Retrieves the annotations stored in class metadata.
 * Used by createComponent() to apply MobX observability.
 */
export function getAnnotations(instance: object): Record<string, any> | undefined {
  const metadata = (instance.constructor as any)[Symbol.metadata];
  return metadata?.[ANNOTATIONS] as Record<string, any> | undefined;
}
