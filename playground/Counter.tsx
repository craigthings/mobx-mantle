import { Component, createComponent } from '../src';

interface CounterProps {
  initial?: number;
  label?: string;
}

class Counter extends Component<CounterProps> {
  count = this.props.initial ?? 0;

  onMount() {
    this.effect(() => {
      document.title = `${this.props.label ?? 'Count'}: ${this.count}`;
    });
  }

  increment() {
    this.count++;
  }

  decrement() {
    this.count--;
  }

  render() {
    return (
      <div className="counter">
        <span className="counter-label">{this.props.label ?? 'Count'}</span>
        <button onClick={this.decrement}>−</button>
        <span className="counter-value">{this.count}</span>
        <button onClick={this.increment}>+</button>
      </div>
    );
  }
}

export default createComponent(Counter);
