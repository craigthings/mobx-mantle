import { View, createView } from '../src';

// ─── HMR Test ───
// 1. Add todos in the parent Todo component
// 2. Click this counter a few times
// 3. Change HMR_VERSION below and save
// 4. Verify:
//    - Counter HMR_VERSION updates, count resets (this component remounted) ✓
//    - Parent Todo's todos SURVIVE (parent not affected) ✓

const HMR_VERSION = 'v1';

class CounterView extends View {
  count = 0;

  increment() {
    this.count++;
  }

  render() {
    return (
      <div className="counter">
        <button onClick={this.increment}>
          Count: {this.count}
        </button>
        <span className="counter-version">{HMR_VERSION}</span>
      </div>
    );
  }
}

export const Counter = createView(CounterView);
