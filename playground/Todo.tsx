import type { ChangeEvent } from 'react';
import { View, createView } from '../src';
import { Counter } from './Counter';
import { withWindowSize } from './withWindowSize';

// ─── HMR Test ───
// To test child edit doesn't affect parent:
// 1. Add a todo here, click the counter below a few times
// 2. Edit Counter.tsx (change its HRM_VERSION) and save
// 3. Verify: Counter resets, but todos SURVIVE (parent unaffected) ✓
const HRM_VERSION = 'v1';

interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

interface TodoProps {
  title: string;
  initialTodos?: TodoItem[];
  onCountChange?: (count: number) => void;
}

class Todo extends View<TodoProps> {
  todos: TodoItem[] = [];
  input = '';
  inputRef = this.ref<HTMLInputElement>();
  // Factory function (no `new`) — View auto-detects behaviors
  windowSize = withWindowSize(768);

  get completedCount() {
    return this.todos.filter(t => t.done).length;
  }

  onCreate() {
    this.todos = this.props.initialTodos ?? [];

    // Watch completedCount and notify parent — auto-disposed on unmount
    this.watch(
      () => this.completedCount,
      (count) => this.props.onCountChange?.(count)
    );
  }

  onMount() {
    this.inputRef.current?.focus();
  }

  add() {
    if (!this.input.trim()) return;
    this.todos.push({ id: Date.now(), text: this.input, done: false });
    this.input = '';
  }

  setInput(e: ChangeEvent<HTMLInputElement>) {
    this.input = e.target.value;
  }

  toggle(id: number) {
    const todo = this.todos.find(t => t.id === id);
    if (todo) todo.done = !todo.done;
  }

  render() {
    return (
      <div className="todo-container">
        <div className="todo-header">
          <h2>{this.props.title}</h2>
          <span className="hmr-version">{HRM_VERSION}</span>
        </div>
        <form onSubmit={e => { e.preventDefault(); this.add(); }}>
          <input
            ref={this.inputRef}
            value={this.input}
            onChange={this.setInput}
            placeholder="Add a todo..."
          />
          <button type="submit">Add</button>
        </form>
        <ul>
          {this.todos.map(todo => (
            <li 
              key={todo.id} 
              onClick={() => this.toggle(todo.id)}
              className={todo.done ? 'done' : ''}
            >
              <span className="checkbox">{todo.done ? '✓' : '○'}</span>
              <span className="text">{todo.text}</span>
            </li>
          ))}
        </ul>
        <p className="count">{this.completedCount} of {this.todos.length} done</p>
        <Counter />
        <p className="window-size">
          {this.windowSize.width}×{this.windowSize.height}
          {this.windowSize.isMobile && ' (mobile)'}
        </p>
      </div>
    );
  }
}

export default createView(Todo);
