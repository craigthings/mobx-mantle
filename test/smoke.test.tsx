import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Component, createComponent, observable, action } from '../src';

describe('toolchain smoke', () => {
  it('auto-observable: field mutation re-renders', () => {
    class Counter extends Component {
      count = 0;
      increment() {
        this.count++;
      }
      render() {
        return (
          <button onClick={this.increment}>count: {this.count}</button>
        );
      }
    }
    const El = createComponent(Counter);
    render(<El />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('count: 0');
    fireEvent.click(btn);
    expect(btn.textContent).toBe('count: 1');
  });

  it('decorator mode: Symbol.metadata annotations apply', () => {
    class Dec extends Component {
      @observable count = 0;
      @action bump() {
        this.count += 2;
      }
      render() {
        return <button onClick={this.bump}>d: {this.count}</button>;
      }
    }
    const El = createComponent(Dec, { autoObservable: false });
    render(<El />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('d: 0');
    fireEvent.click(btn);
    expect(btn.textContent).toBe('d: 2');
  });
});
