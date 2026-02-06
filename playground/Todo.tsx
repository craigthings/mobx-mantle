import { reaction } from 'mobx';
import { View, createView } from '../src';

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

// Example Behavior: tracks window size reactively
class WindowSizeBehavior {
  width = window.innerWidth;
  height = window.innerHeight;

  onMount() {
    const handler = () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }
}

class TodoView extends View<TodoProps> {
  todos: TodoItem[] = [];
  input = '';
  inputRef = this.ref<HTMLInputElement>();
  windowSize = this.use(WindowSizeBehavior);

  get completedCount() {
    return this.todos.filter(t => t.done).length;
  }

  onCreate() {
    this.todos = this.props.initialTodos ?? [];
  }

  onMount() {
    this.inputRef.current?.focus();

    const dispose = reaction(
      () => this.completedCount,
      (count) => this.props.onCountChange?.(count)
    );

    return dispose;
  }

  add() {
    if (!this.input.trim()) return;
    this.todos.push({ id: Date.now(), text: this.input, done: false });
    this.input = '';
  }

  toggle(id: number) {
    const todo = this.todos.find(t => t.id === id);
    if (todo) todo.done = !todo.done;
  }

  render() {
    return (
      <div className="todo-container">
        <h2>{this.props.title}</h2>
        <form onSubmit={e => { e.preventDefault(); this.add(); }}>
          <input
            ref={this.inputRef}
            value={this.input}
            onChange={e => this.input = e.target.value}
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
        <p className="window-size">
          Window: {this.windowSize.width}×{this.windowSize.height}
        </p>
      </div>
    );
  }
}

export const Todo = createView(TodoView);
