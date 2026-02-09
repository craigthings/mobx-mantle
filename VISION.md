# mobx-mantle: A Universal Component Model

## The Problem

Every framework creates its own world:

- **React**: useState, useEffect, useContext, useMemo, useCallback...
- **Vue**: ref, computed, onMounted, defineComponent...
- **Svelte**: $:, on:click, export let...
- **Lit**: @property, @state, connectedCallback, super.connectedCallback()...

Different syntax. Different mental models. Different ecosystems. But they're all solving the same problem:

> "I have state. When it changes, update the DOM."

## The Insight

The **MVVM pattern** has existed since 2005. It will outlive every framework.

Frameworks provide value in one area: **DOM management**. Taking a template and efficiently rendering it to the screen. Everything else—state management, lifecycle, reactivity—is overhead that creates lock-in.

## The mobx-mantle Philosophy

**Use frameworks for what they're good at (DOM), nothing else.**

```
┌─────────────────────────────────────────┐
│              Your Code                  │
│                                         │
│   • View lifecycle (onCreate, onMount)  │
│   • Reactive state (MobX)               │
│   • Business logic                      │
│   • Behaviors (composable state)        │
│                                         │
│   → Framework-agnostic, portable        │
├─────────────────────────────────────────┤
│            mobx-mantle                    │
│                                         │
│   → Thin adapter layer                  │
├─────────────────────────────────────────┤
│         Rendering Backend               │
│                                         │
│   React, Lit, Solid, Vanilla...         │
│                                         │
│   → Just DOM plumbing                   │
└─────────────────────────────────────────┘
```

If React dies tomorrow, your code survives. Just swap the renderer.

---

## The Universal View

Every mobx-mantle View has the same shape, regardless of backend:

```tsx
class CounterView extends View<{ initial: number }> {
  // State
  count = 0;

  // Lifecycle
  onCreate() {
    this.count = this.props.initial;
  }

  onMount() {
    console.log('Mounted!');
    return () => console.log('Cleanup!');
  }

  // Actions
  increment() {
    this.count++;
  }

  // Computed
  get doubled() {
    return this.count * 2;
  }

  // Template (syntax varies by backend)
  render() {
    return /* template */;
  }
}
```

**What stays the same across all backends:**
- Class structure
- Lifecycle methods
- Reactive state (MobX)
- Computed getters
- Actions/methods
- Behaviors (`this.use()`)

**What changes:**
- Template syntax inside `render()`
- How `createView()` outputs the component

---

## Backend Examples

### React (`@mantle/react`)

```tsx
import { View, createView } from '@mantle/react';

class CounterView extends View<{ initial: number }> {
  count = 0;

  onCreate() {
    this.count = this.props.initial;
  }

  increment() {
    this.count++;
  }

  render() {
    return (
      <button onClick={this.increment}>
        Count: {this.count}
      </button>
    );
  }
}

export const Counter = createView(CounterView);

// Usage: <Counter initial={5} />
```

**Template syntax:** JSX  
**Output:** React component  
**Ecosystem:** Full React ecosystem (React Router, React Query, etc.)

---

### Lit / Web Components (`@mantle/lit`)

```tsx
import { View, createView } from '@mantle/lit';
import { html } from 'lit';

class CounterView extends View<{ initial: number }> {
  count = 0;

  onCreate() {
    this.count = this.props.initial;
  }

  increment() {
    this.count++;
  }

  render() {
    return html`
      <button @click=${this.increment}>
        Count: ${this.count}
      </button>
    `;
  }
}

export const Counter = createView(CounterView, { tag: 'x-counter' });

// Usage: <x-counter initial="5"></x-counter>
// Works in ANY framework or plain HTML
```

**Template syntax:** Tagged template literals  
**Output:** Web Component (Custom Element)  
**Ecosystem:** Framework-agnostic, works everywhere

---

### Solid (`@mantle/solid`)

```tsx
import { View, createView } from '@mantle/solid';

class CounterView extends View<{ initial: number }> {
  count = 0;

  onCreate() {
    this.count = this.props.initial;
  }

  increment() {
    this.count++;
  }

  render() {
    return (
      <button onClick={this.increment}>
        Count: {this.count}
      </button>
    );
  }
}

export const Counter = createView(CounterView);

// Usage: <Counter initial={5} />
```

**Template syntax:** JSX (compiles to direct DOM operations)  
**Output:** Solid component  
**Ecosystem:** Solid Router, etc.  
**Note:** Could optionally use Solid's signals instead of MobX

---

### Vanilla DOM (`@mantle/vanilla`)

```tsx
import { View, createView } from '@mantle/vanilla';
import { html } from '@mantle/vanilla';  // Tagged template helper

class CounterView extends View<{ initial: number }> {
  count = 0;

  onCreate() {
    this.count = this.props.initial;
  }

  increment() {
    this.count++;
  }

  render() {
    return html`
      <button data-action="increment">
        Count: ${this.count}
      </button>
    `;
  }
}

export const Counter = createView(CounterView);

// Usage: Counter({ initial: 5 }, document.getElementById('root'));
// Zero framework dependencies
```

**Template syntax:** Tagged template literals  
**Output:** Direct DOM manipulation  
**Ecosystem:** None needed—pure web platform

---

## Behaviors Work Everywhere

Behaviors are completely backend-agnostic:

```tsx
// This exact code works with ANY backend
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

class ResponsiveView extends View<{}> {
  windowSize = this.use(WindowSizeBehavior);

  get isMobile() {
    return this.windowSize.width < 768;
  }

  render() {
    // Template syntax varies, but the View/Behavior code is identical
  }
}
```

Your Behaviors are pure TypeScript. They don't know or care what renders the DOM.

---

## Comparison: Same Component, Four Backends

### The View (identical everywhere)

```tsx
class TodoView extends View<{ title: string }> {
  todos: TodoItem[] = [];
  input = '';

  add() {
    if (!this.input.trim()) return;
    this.todos.push({ id: Date.now(), text: this.input, done: false });
    this.input = '';
  }

  toggle(id: number) {
    const todo = this.todos.find(t => t.id === id);
    if (todo) todo.done = !todo.done;
  }

  get remaining() {
    return this.todos.filter(t => !t.done).length;
  }
}
```

### The Template (varies by backend)

**React:**
```tsx
render() {
  return (
    <div>
      <h2>{this.props.title}</h2>
      <input 
        value={this.input} 
        onChange={e => this.input = e.target.value} 
      />
      <button onClick={this.add}>Add</button>
      <ul>
        {this.todos.map(t => (
          <li key={t.id} onClick={() => this.toggle(t.id)}>
            {t.done ? '✓' : '○'} {t.text}
          </li>
        ))}
      </ul>
      <p>{this.remaining} remaining</p>
    </div>
  );
}
```

**Lit:**
```tsx
render() {
  return html`
    <div>
      <h2>${this.props.title}</h2>
      <input 
        .value=${this.input} 
        @input=${e => this.input = e.target.value} 
      />
      <button @click=${this.add}>Add</button>
      <ul>
        ${this.todos.map(t => html`
          <li @click=${() => this.toggle(t.id)}>
            ${t.done ? '✓' : '○'} ${t.text}
          </li>
        `)}
      </ul>
      <p>${this.remaining} remaining</p>
    </div>
  `;
}
```

**Solid:**
```tsx
render() {
  return (
    <div>
      <h2>{this.props.title}</h2>
      <input 
        value={this.input} 
        onInput={e => this.input = e.target.value} 
      />
      <button onClick={this.add}>Add</button>
      <ul>
        <For each={this.todos}>
          {t => (
            <li onClick={() => this.toggle(t.id)}>
              {t.done ? '✓' : '○'} {t.text}
            </li>
          )}
        </For>
      </ul>
      <p>{this.remaining} remaining</p>
    </div>
  );
}
```

---

## Backend Feasibility

| Backend | Feasibility | Template Syntax | Output |
|---------|-------------|-----------------|--------|
| **React** | ✅ Done | JSX | React component |
| **Lit** | ✅ Great fit | Tagged templates | Web Component |
| **Solid** | ✅ Great fit | JSX | Solid component |
| **Vanilla** | ✅ Possible | Tagged templates | Direct DOM |
| **Vue** | ⚠️ Friction | JSX or SFC | Vue component |
| **Svelte** | ❌ Hard | .svelte files | Svelte component |

---

## The Value Proposition

**For developers:**
- Learn one pattern, use it everywhere
- Your skills transfer across frameworks
- Business logic survives framework churn

**For teams:**
- Gradual migration paths between frameworks
- Share Behaviors across projects with different stacks
- Reduce framework-specific tribal knowledge

**For the industry:**
- Break ecosystem lock-in
- Frameworks compete on rendering performance, not API lock-in
- The web platform wins

---

## The Pitch

> "mobx-mantle is a universal component model. Write your Views once—with lifecycle, reactive state, and composable Behaviors—then render through whatever DOM backend makes sense for your project. React today, Web Components tomorrow, something new next year. Your code stays the same."

**The framework is the renderer. The View is the component.**
