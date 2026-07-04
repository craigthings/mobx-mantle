# Mantle vs React-VVM

This example shows the same small component in Mantle and react-vvm. It covers initial state from props, observable state, computed state, refs, mount lifecycle, a debounced reaction, an auto-bound event handler, and JSX rendering.

## Mantle

```tsx
class SearchBox extends Component<{
  initialQuery?: string;
  placeholder?: string;
  onSearch: (query: string) => void;
}> {
  query = this.props.initialQuery ?? '';
  input = this.ref<HTMLInputElement>();

  get hasQuery() {
    return this.query.trim().length > 0;
  }

  onMount() {
    this.input.current?.focus();

    this.watch(
      () => this.query.trim(),
      query => query && this.props.onSearch(query),
      { delay: 300 }
    );
  }

  clear() {
    this.query = '';
  }

  render() {
    return (
      <label>
        <input
          ref={this.input}
          value={this.query}
          placeholder={this.props.placeholder}
          onChange={e => this.query = e.target.value}
        />

        {this.hasQuery && <button onClick={this.clear}>Clear</button>}
      </label>
    );
  }
}

export default createComponent(SearchBox);
```

## React-VVM

```tsx
@injectable()
class SearchBoxModel extends ViewModel<{
  initialQuery?: string;
  placeholder?: string;
  onSearch: (query: string) => void;
}> {
  @observable query = '';
  input = createRef<HTMLInputElement>();

  constructor(@inject(P) props: Props) {
    super(props);
    this.query = props.initialQuery ?? '';
  }

  @computed get hasQuery() {
    return this.query.trim().length > 0;
  }

  protected onViewMounted() {
    this.input.current?.focus();

    this.reaction(
      () => this.query.trim(),
      query => query && this.props.onSearch(query),
      { delay: 300 }
    );
  }

  @action.bound clear() {
    this.query = '';
  }
}

const SearchBox = view(SearchBoxModel, ({ vm }) => (
  <label>
    <input
      ref={vm.input}
      value={vm.query}
      placeholder={vm.props.placeholder}
      onChange={e => vm.query = e.target.value}
    />

    {vm.hasQuery && <button onClick={vm.clear}>Clear</button>}
  </label>
));
```

## What Mantle Removes

- No `@injectable()` or `@inject(P)` for basic props access.
- No constructor just to initialize state from props.
- No required `@observable`, `@computed`, or `@action.bound` annotations.
- No separate ViewModel/render callback split unless you choose that style.
- No `vm.` prefix throughout the JSX.
- Shorter lifecycle names: `onMount()` instead of `onViewMounted()`.

Mantle's main advantage is the way these features stack together: the component class itself is the reactive ViewModel.
