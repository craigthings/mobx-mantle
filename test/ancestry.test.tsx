import React, { StrictMode, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hydrateRoot, type Root as ReactRoot } from 'react-dom/client';
import { isObservableProp } from 'mobx';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  Behavior,
  Component,
  ViewModel,
  createBehavior,
  createComponent,
} from '../src';

class ErrorBoundary extends React.Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <div data-testid="construction-error" /> : this.props.children;
  }
}

describe('Mantle component ancestry', () => {
  it('provides parent, ancestor order, typed search, and root semantics', () => {
    let root!: Root;
    let parent!: Parent;
    const children: Child[] = [];

    class Missing extends Component {}

    class Child extends Component<{ id: string }> {
      parentFromField = this.getParent();
      rootFromField = this.getRoot();
      parentFromCreate: Component<any> | undefined = undefined;

      onCreate() {
        this.parentFromCreate = this.getParent();
        children.push(this);
      }

      render() {
        return <span>{this.props.id}</span>;
      }
    }
    const ChildView = createComponent(Child);

    class Parent extends Component {
      onCreate() {
        parent = this;
      }

      render() {
        return (
          <div>
            <ChildView id="one" />
            <ChildView id="two" />
          </div>
        );
      }
    }
    const ParentView = createComponent(Parent);

    class Root extends Component {
      onCreate() {
        root = this;
      }

      render() {
        return <ParentView />;
      }
    }
    const RootView = createComponent(Root);

    render(<RootView />);

    expect(root.getParent()).toBeUndefined();
    expect(root.getRoot()).toBe(root);
    expect(parent.getParent()).toBe(root);
    expect(parent.getRoot()).toBe(root);
    expect(children).toHaveLength(2);

    for (const child of children) {
      expect(child.parentFromField).toBe(parent);
      expect(child.parentFromCreate).toBe(parent);
      expect(child.rootFromField).toBe(root);
      expect(child.getParent()).toBe(parent);
      expect(child.getRoot()).toBe(root);
      expect(child.getParents()).toEqual([parent, root]);
      expect(child.findParent(Parent)).toBe(parent);
      expect(child.findParent(Root)).toBe(root);
      expect(child.findParent(Missing)).toBeUndefined();
    }
  });

  it('works with an external ViewModel template', () => {
    let parent!: CardModel;
    let child!: ButtonModel;

    class ButtonModel extends ViewModel {
      onCreate() {
        child = this;
      }
    }
    const Button = createComponent(ButtonModel, () => <button>Action</button>);

    class CardModel extends ViewModel {
      onCreate() {
        parent = this;
      }
    }
    const Card = createComponent(CardModel, () => (
      <article>
        <Button />
      </article>
    ));

    render(<Card />);

    expect(child.getParent()).toBe(parent);
    expect(child.getRoot()).toBe(parent);
    expect(child.findParent(CardModel)).toBe(parent);
  });

  it('is available to a field-created behavior through its host', () => {
    let parent!: Parent;
    let seenByBehavior: Component<any> | undefined;

    class AncestryReader extends Behavior {
      onCreate(host: Component<any>) {
        seenByBehavior = host.getParent();
      }
    }
    const withAncestryReader = createBehavior(AncestryReader);

    class Child extends Component {
      ancestryReader = withAncestryReader(this);

      render() {
        return <span />;
      }
    }
    const ChildView = createComponent(Child);

    class Parent extends Component {
      onCreate() {
        parent = this;
      }

      render() {
        return <ChildView />;
      }
    }
    const ParentView = createComponent(Parent);

    render(<ParentView />);

    expect(seenByBehavior).toBe(parent);
  });

  it('treats plain React wrappers, fragments, and props.children as transparent', () => {
    let parent!: Parent;
    let child!: Child;

    function PlainWrapper({ children }: { children?: ReactNode }) {
      return <section>{children}</section>;
    }

    class Child extends Component {
      onCreate() {
        child = this;
      }

      render() {
        return <span>child</span>;
      }
    }
    const ChildView = createComponent(Child);

    class Parent extends Component<{ children?: ReactNode }> {
      onCreate() {
        parent = this;
      }

      render() {
        return (
          <PlainWrapper>
            <>{this.props.children}</>
          </PlainWrapper>
        );
      }
    }
    const ParentView = createComponent(Parent);

    render(
      <ParentView>
        <ChildView />
      </ParentView>
    );

    expect(child.getParent()).toBe(parent);
    expect(child.getParents()).toEqual([parent]);
  });

  it('preserves logical ancestry through a React portal', () => {
    const portalHost = document.createElement('aside');
    document.body.appendChild(portalHost);

    let parent!: Parent;
    let child!: Child;

    class Child extends Component {
      onCreate() {
        child = this;
      }

      render() {
        return <span data-testid="portal-child">portal child</span>;
      }
    }
    const ChildView = createComponent(Child);

    class Parent extends Component {
      onCreate() {
        parent = this;
      }

      render() {
        return <div>{createPortal(<ChildView />, portalHost)}</div>;
      }
    }
    const ParentView = createComponent(Parent);

    const mounted = render(<ParentView />);

    expect(child.getParent()).toBe(parent);
    expect(screen.getByTestId('portal-child').parentElement).toBe(portalHost);

    mounted.unmount();
    portalHost.remove();
  });

  it('keeps separate React roots in separate Mantle trees', () => {
    const roots: Root[] = [];
    const children: Child[] = [];

    class Child extends Component {
      onCreate() {
        children.push(this);
      }

      render() {
        return <span />;
      }
    }
    const ChildView = createComponent(Child);

    class Root extends Component {
      onCreate() {
        roots.push(this);
      }

      render() {
        return <ChildView />;
      }
    }
    const RootView = createComponent(Root);

    const first = render(<RootView />);
    const second = render(<RootView />);

    expect(roots).toHaveLength(2);
    expect(children).toHaveLength(2);
    expect(children[0].getParent()).toBe(roots[0]);
    expect(children[1].getParent()).toBe(roots[1]);
    expect(children[0].getRoot()).not.toBe(children[1].getRoot());

    first.unmount();
    second.unmount();
  });

  it('uses the current conditional parent after a subtree moves', () => {
    const parentsA: ParentA[] = [];
    const parentsB: ParentB[] = [];
    const children: Child[] = [];

    class Child extends Component {
      onCreate() {
        children.push(this);
      }

      render() {
        return <span />;
      }
    }
    const ChildView = createComponent(Child);

    class ParentA extends Component<{ children?: ReactNode }> {
      onCreate() {
        parentsA.push(this);
      }

      render() {
        return <div>{this.props.children}</div>;
      }
    }
    const ParentAView = createComponent(ParentA);

    class ParentB extends Component<{ children?: ReactNode }> {
      onCreate() {
        parentsB.push(this);
      }

      render() {
        return <section>{this.props.children}</section>;
      }
    }
    const ParentBView = createComponent(ParentB);

    function Harness({ useA }: { useA: boolean }) {
      return useA ? (
        <ParentAView><ChildView /></ParentAView>
      ) : (
        <ParentBView><ChildView /></ParentBView>
      );
    }

    const mounted = render(<Harness useA />);
    expect(children.at(-1)?.getParent()).toBe(parentsA.at(-1));

    mounted.rerender(<Harness useA={false} />);
    expect(children.at(-1)?.getParent()).toBe(parentsB.at(-1));
    expect(children.at(-1)?.findParent(ParentA)).toBeUndefined();
  });

  it('targets and closes the construction scope without leaking to manual instances', () => {
    let parent!: Parent;
    let child!: Child;
    let manuallyConstructed!: Manual;

    class Manual extends Component {}

    class Child extends Component {
      constructor(props?: {}) {
        manuallyConstructed = new Manual();
        super(props);
      }

      onCreate() {
        child = this;
      }

      render() {
        return <span />;
      }
    }
    const ChildView = createComponent(Child);

    class Parent extends Component {
      onCreate() {
        parent = this;
      }

      render() {
        return <ChildView />;
      }
    }
    const ParentView = createComponent(Parent);

    render(<ParentView />);

    expect(child.getParent()).toBe(parent);
    expect(manuallyConstructed.getParent()).toBeUndefined();
    expect(manuallyConstructed.getRoot()).toBe(manuallyConstructed);
    expect(new Manual().getParent()).toBeUndefined();
  });

  it('closes a failed construction scope before the next component is created', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let standalone!: Standalone;

    class Throwing extends Component {
      constructor(props?: {}) {
        super(props);
        throw new Error('constructor failed');
      }
    }
    const ThrowingView = createComponent(Throwing);

    class Parent extends Component {
      render() {
        return <ThrowingView />;
      }
    }
    const ParentView = createComponent(Parent);

    render(
      <ErrorBoundary>
        <ParentView />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('construction-error')).toBeTruthy();

    class Standalone extends Component {
      parentFromField = this.getParent();

      onCreate() {
        standalone = this;
      }

      render() {
        return <div />;
      }
    }
    const StandaloneView = createComponent(Standalone);
    render(<StandaloneView />);

    expect(standalone.parentFromField).toBeUndefined();
    expect(standalone.getParent()).toBeUndefined();
    errorSpy.mockRestore();
  });

  it('remains correct in StrictMode and adds no DOM element', () => {
    const parents: Parent[] = [];
    const children: Child[] = [];

    class Child extends Component {
      onCreate() {
        children.push(this);
      }

      render() {
        return <span data-child="yes">content</span>;
      }
    }
    const ChildView = createComponent(Child);

    class Parent extends Component {
      onCreate() {
        parents.push(this);
      }

      render() {
        return <main><ChildView /></main>;
      }
    }
    const ParentView = createComponent(Parent);

    const mounted = render(
      <StrictMode>
        <ParentView />
      </StrictMode>
    );

    expect(mounted.container.innerHTML).toBe('<main><span data-child="yes">content</span></main>');
    expect(children.length).toBeGreaterThan(0);
    expect(parents.length).toBeGreaterThan(0);
    expect(children.at(-1)?.getParent()).toBe(parents.at(-1));
  });

  it('establishes ancestry while hydrating existing DOM', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<main><span>hydrated</span></main>';
    document.body.appendChild(container);

    let parent!: Parent;
    let child!: Child;
    let hydratedRoot!: ReactRoot;

    class Child extends Component {
      parentFromField = this.getParent();

      onCreate() {
        child = this;
      }

      render() {
        return <span>hydrated</span>;
      }
    }
    const ChildView = createComponent(Child);

    class Parent extends Component {
      onCreate() {
        parent = this;
      }

      render() {
        return <main><ChildView /></main>;
      }
    }
    const ParentView = createComponent(Parent);

    await act(async () => {
      hydratedRoot = hydrateRoot(container, <ParentView />);
    });

    expect(container.innerHTML).toBe('<main><span>hydrated</span></main>');
    expect(child.parentFromField).toBe(parent);
    expect(child.getParent()).toBe(parent);
    expect(child.getRoot()).toBe(parent);

    act(() => hydratedRoot.unmount());
    container.remove();
  });

  it('keeps ancestry out of observable, enumerable, and serialized state', () => {
    let child!: Child;

    class Child extends Component {
      onCreate() {
        child = this;
      }

      render() {
        return <span />;
      }
    }
    const ChildView = createComponent(Child);

    class Parent extends Component {
      render() {
        return <ChildView />;
      }
    }
    const ParentView = createComponent(Parent);

    render(<ParentView />);

    expect(Object.keys(child)).not.toContain('parent');
    expect(Object.keys(child)).not.toContain('parentComponent');
    expect(Object.prototype.propertyIsEnumerable.call(child, 'getParent')).toBe(false);
    expect(isObservableProp(child, 'getParent')).toBe(false);
    expect(JSON.stringify(child)).not.toContain('parent');
  });
});
