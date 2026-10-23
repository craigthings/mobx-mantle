import React, { createRef, memo, type ComponentType, type Ref } from 'react';
import { createRoot } from 'react-dom/client';
import { isObservableProp, runInAction } from 'mobx';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  Component,
  ViewModel,
  createComponent,
  createView,
  createServiceToken,
  ServiceProvider,
  observer,
  type ServiceResolver,
} from '../src';
import { renderStrict } from './helpers';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string }> {
  state = { message: '' };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  render() {
    return this.state.message ? <div data-testid="error">{this.state.message}</div> : this.props.children;
  }
}

describe('createView', () => {
  it('renders with the nearest model and re-renders on its own when the state it reads changes', () => {
    let list!: List;
    let listRenders = 0;
    let summaryRenders = 0;

    class List extends ViewModel {
      count = 0;
      onCreate() {
        list = this;
      }
    }

    const Summary = createView(List, ({ vm, label }: { vm: List; label: string }) => {
      summaryRenders++;
      return <p data-testid="summary">{label} {vm.count}</p>;
    });

    const ListView = createComponent(List, () => {
      listRenders++;
      return <div><Summary label="count:" /></div>;
    });

    render(<ListView />);
    expect(screen.getByTestId('summary').textContent).toBe('count: 0');

    act(() => runInAction(() => { list.count = 2; }));
    expect(screen.getByTestId('summary').textContent).toBe('count: 2');
    expect(summaryRenders).toBe(2);
    expect(listRenders).toBe(1);
  });

  it('skips intermediate models of other types and infers vm with no annotation', () => {
    class Page extends ViewModel {
      title = 'Reports';
    }
    class Panel extends ViewModel {}

    const Heading = createView(Page, ({ vm }) => <h1>{vm.title}</h1>);
    const PanelView = createComponent(Panel, () => <section><Heading /></section>);
    const PageView = createComponent(Page, () => <main><PanelView /></main>);

    render(<PageView />);
    expect(screen.getByRole('heading').textContent).toBe('Reports');
  });

  it('throws a clear error when no matching model is mounted above', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    class Page extends ViewModel {}
    class Other extends ViewModel {}
    const Heading = createView(Page, ({ vm }) => <h1>{String(vm)}</h1>);
    const OtherView = createComponent(Other, () => <Heading />);

    render(<ErrorBoundary><OtherView /></ErrorBoundary>);
    expect(screen.getByTestId('error').textContent).toBe(
      '[mobx-mantle] createView(Page): no Page is mounted above this view.'
    );
  });

  it('forwards refs and survives StrictMode', () => {
    class List extends ViewModel {
      count = 1;
    }
    const Row = createView(List, ({ vm, ref }: { vm: List; ref?: Ref<HTMLLIElement> }) => (
      <li ref={ref}>{vm.count}</li>
    ));
    const rowRef = createRef<HTMLLIElement>();
    const ListView = createComponent(List, () => <ul><Row ref={rowRef} /></ul>);

    renderStrict(<ListView />);
    expect(rowRef.current?.tagName).toBe('LI');
    expect(rowRef.current?.textContent).toBe('1');
  });
});

describe('this.view', () => {
  interface RowProps {
    id: string;
  }

  /** Stands in for a library: owns rendering of the rows and memoizes itself. */
  let libraryRenders = 0;
  const Library = memo(function Library({ rows, components }: { rows: string[]; components: { row: ComponentType<RowProps> } }) {
    libraryRenders++;
    const Row = components.row;
    return <ul>{rows.map((id) => <Row key={id} id={id} />)}</ul>;
  });

  it('has stable identity, is left non-observable, and re-renders only the rows that read changed state', () => {
    libraryRenders = 0;
    let table!: Table;
    let ownerRenders = 0;

    class Table extends Component<{ rows: string[] }> {
      activeId: string | null = null;

      row = this.view(({ id }: RowProps) => (
        <li data-testid={id} className={id === this.activeId ? 'active' : ''}>{id}</li>
      ));

      onCreate() {
        table = this;
      }

      render() {
        ownerRenders++;
        return <Library rows={this.props.rows} components={{ row: this.row }} />;
      }
    }
    const TableView = createComponent(Table);

    render(<TableView rows={['a', 'b']} />);
    const first = table.row;
    expect(isObservableProp(table, 'row')).toBe(false);
    expect(isObservableProp(table, 'activeId')).toBe(true);
    expect(screen.getByTestId('a').className).toBe('');

    act(() => runInAction(() => { table.activeId = 'a'; }));
    expect(screen.getByTestId('a').className).toBe('active');
    expect(screen.getByTestId('b').className).toBe('');
    expect(table.row).toBe(first);
    expect(ownerRenders).toBe(1);
    expect(libraryRenders).toBe(1);
  });

  it('forwards refs', () => {
    class Table extends Component {
      row = this.view(({ id, ref }: RowProps & { ref?: Ref<HTMLLIElement> }) => <li ref={ref}>{id}</li>);
      render() {
        const Row = this.row;
        return <ul><Row id="a" ref={rowRef} /></ul>;
      }
    }
    const rowRef = createRef<HTMLLIElement>();
    const TableView = createComponent(Table);

    renderStrict(<TableView />);
    expect(rowRef.current?.textContent).toBe('a');
  });

  it('carries the model context into a React root the library owns', () => {
    const Token = createServiceToken<{ name: string }>('Token');
    const resolve = (() => ({ name: 'from-provider' })) as ServiceResolver;
    let owner!: Owner;
    let seenParent: Component<any> | undefined;

    class Child extends Component {
      parent = this.findParent(Owner);
      service = this.inject(Token);
      render() {
        seenParent = this.parent;
        return <i>{this.service.name}</i>;
      }
    }
    const ChildView = createComponent(Child);

    class Owner extends Component {
      popup = this.view(() => <ChildView />);
      onCreate() {
        owner = this;
      }
      render() {
        return <div />;
      }
    }
    const OwnerView = createComponent(Owner);

    render(<ServiceProvider resolve={resolve}><OwnerView /></ServiceProvider>);

    // Like a map popup: the library mounts our component in its own root.
    const container = document.createElement('div');
    const root = createRoot(container);
    const Popup = owner.popup;
    act(() => root.render(<Popup />));

    expect(container.textContent).toBe('from-provider');
    expect(seenParent).toBe(owner);
    act(() => root.unmount());
  });

  it('observer() results on a field are also left by reference in auto-observable mode', () => {
    let model!: Model;
    const Label = observer(({ text }: { text: string }) => <b>{text}</b>);
    class Model extends Component {
      label = Label;
      onCreate() {
        model = this;
      }
      render() {
        const L = this.label;
        return <L text="hi" />;
      }
    }
    const View = createComponent(Model);
    render(<View />);
    expect(model.label).toBe(Label);
    expect(isObservableProp(model, 'label')).toBe(false);
    expect(screen.getByText('hi').tagName).toBe('B');
  });
});
