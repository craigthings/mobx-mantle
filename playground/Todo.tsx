import type { ChangeEvent } from 'react';
import { Component, createComponent } from '../src';
import Counter from './Counter';
import { withWindowSize } from './withWindowSize';

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

class Todo extends Component<TodoProps> {
  todos: TodoItem[] = this.props.initialTodos ?? [];
  input = '';
  filter = '';
  inputRef = this.ref<HTMLInputElement>();
  windowSize = withWindowSize(768);

  get completedCount() {
    return this.todos.filter(t => t.done).length;
  }

  get filteredTodos() {
    if (!this.filter) return this.todos;
    const q = this.filter.toLowerCase();
    return this.todos.filter(t => t.text.toLowerCase().includes(q));
  }

  onMount() {
    this.inputRef.current?.focus();

    this.watch(
      () => this.completedCount,
      (count) => this.props.onCountChange?.(count)
    );

    this.watch(
      () => this.input,
      (value) => { this.filter = value; },
      { delay: 250 }
    );

    this.effect(() => {
      const total = this.todos.length;
      const done = this.completedCount;
      console.log(`[Todo] ${done}/${total} completed`);
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== this.inputRef.current) {
        e.preventDefault();
        this.inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    this.addCleanup(() => window.removeEventListener('keydown', onKey));
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
        </div>
        <form onSubmit={e => { e.preventDefault(); this.add(); }}>
          <input
            ref={this.inputRef}
            value={this.input}
            onChange={this.setInput}
            placeholder="Add a todo... (press / to focus)"
          />
          <button type="submit">Add</button>
        </form>
        <ul>
          {this.filteredTodos.map(todo => (
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
        <Counter initial={10} label="Things" />
        <p className="window-size">
          {this.windowSize.width}×{this.windowSize.height}
          {this.windowSize.isMobile && ' (mobile)'}
        </p>
      </div>
    );
  }
}

export default createComponent(Todo);
