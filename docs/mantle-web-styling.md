# Mantle-Web Styling Patterns

This document covers the recommended styling patterns for Mantle-Web components.

---

## Overview

Mantle-Web uses **per-instance style injection** for reactive CSS. Each component with a `get styles()` getter gets its own `<style>` element that updates when observables change.

- **True reactive CSS** — Use observables directly in your styles
- **No CSS-in-JS dependency** — No Goober, Emotion, or styled-components needed
- **Native CSS nesting** — SCSS-like syntax is now standard CSS (all browsers 2023+)
- **Automatic scoping** — Each component instance gets a unique scope class
- **No style leaks** — Styles are replaced, not accumulated
- **~30 lines of framework code**

```tsx
class ColorPicker extends Component {
  hue = 180;
  
  get styles() {
    return `
      .picker {
        background: hsl(${this.hue}, 70%, 50%);
        
        &:hover {
          transform: scale(1.02);
        }
        
        .preview {
          border-radius: 50%;
        }
      }
    `;
  }
}
```

When `this.hue` changes, the component's `<style>` element is updated with the new CSS. No new rules accumulate — the old CSS is replaced entirely.

### Native CSS Nesting (No SCSS Required)

As of 2023, all major browsers support CSS nesting natively. You can write SCSS-style nested selectors directly:

```css
.card {
  background: white;
  
  &:hover { 
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); 
  }
  
  &.highlighted {
    border: 2px solid blue;
  }
  
  .header {
    font-weight: bold;
    
    .title { font-size: 18px; }
  }
  
  @media (max-width: 768px) {
    padding: 8px;
  }
}
```

No build step, no preprocessor — this is valid CSS.

---

## The `get styles()` Pattern

### Basic Example

```tsx
import { Component, createComponent } from 'mantle-web';

class Button extends Component<{ primary?: boolean }> {
  loading = false;
  
  get styles() {
    return `
      .btn {
        background: ${this.props.primary ? '#007bff' : '#6c757d'};
        color: white;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        opacity: ${this.loading ? 0.5 : 1};
        cursor: ${this.loading ? 'wait' : 'pointer'};
      }
      
      .btn:hover {
        filter: brightness(1.1);
      }
      
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `;
  }
  
  async handleClick() {
    this.loading = true;
    await this.props.onAction?.();
    this.loading = false;
  }
  
  render() {
    return (
      <button class="btn" onClick={this.handleClick} disabled={this.loading}>
        {this.props.children}
      </button>
    );
  }
}

export default createComponent(Button);
```

### Multi-Element Example

```tsx
class Card extends Component<Props> {
  get styles() {
    return `
      .card {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
      
      .header {
        padding: 16px;
        font-weight: bold;
        border-bottom: 1px solid #eee;
      }
      
      .body {
        padding: 16px;
      }
      
      .card:hover .actions {
        opacity: 1;
      }
      
      .actions {
        opacity: 0;
        transition: opacity 0.2s;
      }
    `;
  }
  
  render() {
    return (
      <div class="card">
        <div class="header">
          Title
          <span class="actions">
            <button>Edit</button>
          </span>
        </div>
        <div class="body">Content</div>
      </div>
    );
  }
}
```

### Reactive Styles with State

Styles automatically update when any observable state changes:

```tsx
import { Component, createComponent } from 'mantle-web';

class ColorPicker extends Component {
  // Observable state
  hue = 180;
  saturation = 70;
  lightness = 50;
  expanded = false;
  
  get styles() {
    // MobX tracks all state access — styles update when any change
    return `
      .picker {
        background: hsl(${this.hue}, ${this.saturation}%, ${this.lightness}%);
        padding: ${this.expanded ? '24px' : '12px'};
        border-radius: ${this.expanded ? '16px' : '8px'};
        transition: all 0.3s ease;
      }
      
      .preview {
        width: ${this.expanded ? '200px' : '100px'};
        height: ${this.expanded ? '200px' : '100px'};
        border-radius: 50%;
        background: hsl(${this.hue}, ${this.saturation}%, ${this.lightness}%);
        box-shadow: ${this.expanded 
          ? `0 8px 32px hsla(${this.hue}, ${this.saturation}%, 30%, 0.4)`
          : 'none'
        };
      }
      
      .sliders {
        opacity: ${this.expanded ? 1 : 0};
        max-height: ${this.expanded ? '200px' : '0'};
        overflow: hidden;
        transition: all 0.3s ease;
      }
    `;
  }
  
  render() {
    return (
      <div class="picker" onClick={() => this.expanded = !this.expanded}>
        <div class="preview" />
        <div class="sliders">
          <input 
            type="range" 
            min="0" max="360" 
            value={this.hue}
            onInput={e => this.hue = e.target.value} 
          />
          <input 
            type="range" 
            min="0" max="100" 
            value={this.saturation}
            onInput={e => this.saturation = e.target.value} 
          />
          <input 
            type="range" 
            min="0" max="100" 
            value={this.lightness}
            onInput={e => this.lightness = e.target.value} 
          />
        </div>
      </div>
    );
  }
}

export default createComponent(ColorPicker);
```

When any slider moves:
1. Observable changes (e.g., `this.hue = 181`)
2. MobX triggers component re-render
3. `get styles()` returns new CSS string
4. Component's `<style>` element gets updated (not appended!)
5. Browser re-applies styles

**No CSS leak** — there's always exactly one `<style>` element per component instance.

---

## External Style Files

For larger components, move styles to a separate file:

### The Style File

```tsx
// ColorPicker.styles.ts
import type { ColorPicker } from './ColorPicker';

export default (self: ColorPicker) => `
  .picker {
    background: hsl(${self.hue}, ${self.saturation}%, ${self.lightness}%);
    padding: ${self.expanded ? '24px' : '12px'};
    border-radius: ${self.expanded ? '16px' : '8px'};
    transition: all 0.3s ease;
  }
  
  .preview {
    width: ${self.expanded ? '200px' : '100px'};
    height: ${self.expanded ? '200px' : '100px'};
    border-radius: 50%;
    background: hsl(${self.hue}, ${self.saturation}%, ${self.lightness}%);
  }
  
  .sliders {
    opacity: ${self.expanded ? 1 : 0};
    max-height: ${self.expanded ? '200px' : '0'};
    overflow: hidden;
  }
`;
```

### The Component File

```tsx
// ColorPicker.tsx
import { Component, createComponent } from 'mantle-web';
import styles from './ColorPicker.styles';

export class ColorPicker extends Component {
  hue = 180;
  saturation = 70;
  lightness = 50;
  expanded = false;
  
  // Connect external styles
  get styles() {
    return styles(this);
  }
  
  render() {
    return (
      <div class="picker" onClick={() => this.expanded = !this.expanded}>
        <div class="preview" />
        <div class="sliders">
          {/* sliders... */}
        </div>
      </div>
    );
  }
}

export default createComponent(ColorPicker);
```

Same reactive behavior, cleaner separation. Use `self` (or `$`) in the style file to access component state and props.

---

## How It Works

### Per-Instance Style Elements

Each component with styles gets its own `<style>` element in `<head>`:

```html
<head>
  <style data-mantle="m-1">
    .m-1 .picker { background: hsl(180, 70%, 50%); }
    .m-1 .picker:hover { transform: scale(1.02); }
  </style>
  <style data-mantle="m-2">
    .m-2 .picker { background: hsl(220, 60%, 40%); }
    .m-2 .picker:hover { transform: scale(1.02); }
  </style>
</head>
```

### Automatic Scoping

Each component instance gets a unique class (e.g., `m-1`, `m-2`). The framework wraps your CSS in that class, and CSS nesting does the rest:

```tsx
// You write:
get styles() {
  return `
    .card { background: white; }
    .header { font-weight: bold; }
  `;
}

// Framework wraps it:
// .m-42 { .card { background: white; } .header { font-weight: bold; } }

// Browser's CSS nesting expands to:
// .m-42 .card { background: white; }
// .m-42 .header { font-weight: bold; }

// Your root element gets the scope class:
// <div class="m-42 card">...</div>
```

The scope class (`m-42`) is automatically added to the root element by the framework during render.

### Implementation (~30 lines)

```tsx
let instanceId = 0;

class Component<P> {
  private _styleEl: HTMLStyleElement | null = null;
  private _scopeClass = `m-${instanceId++}`;
  
  // Override in subclass
  get styles(): string | null {
    return null;
  }
  
  // Called by framework during render
  _applyStyles() {
    const css = this.styles;
    if (!css) return;
    
    if (!this._styleEl) {
      this._styleEl = document.createElement('style');
      this._styleEl.setAttribute('data-mantle', this._scopeClass);
      document.head.appendChild(this._styleEl);
    }
    
    // Wrap in scope class — CSS nesting handles the rest!
    // .m-42 { .card { ... } } → .m-42 .card { ... }
    const scoped = `.${this._scopeClass} { ${css} }`;
    
    // Replace (not append!) the style content
    this._styleEl.textContent = scoped;
  }
  
  onUnmount() {
    this._styleEl?.remove();
  }
}
```

The key insight: **CSS nesting does the scoping for us**. By wrapping the user's CSS in `.m-42 { ... }`, the browser automatically prefixes all nested selectors with `.m-42`.

### Why Per-Instance Works

| Concern | Reality |
|---------|---------|
| "Too many `<style>` elements?" | Browsers handle hundreds easily. Shadow DOM does this by design. |
| "Performance of textContent update?" | Fast — browser re-parses only that small stylesheet |
| "Memory?" | Minimal — each element is tiny |
| "DevTools clutter?" | Filterable by `data-mantle` attribute |

---

## Full CSS Support

Unlike some CSS-in-JS approaches, you get full CSS:

### Pseudo-Selectors

```tsx
get styles() {
  return `
    .btn { background: blue; }
    .btn:hover { background: darkblue; }
    .btn:focus { outline: 2px solid #007bff; }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.5; }
    .btn::before { content: '→'; }
  `;
}
```

### Media Queries

```tsx
get styles() {
  return `
    .card { padding: 24px; }
    
    @media (max-width: 768px) {
      .card { padding: 12px; }
    }
    
    @media (prefers-color-scheme: dark) {
      .card { background: #1a1a1a; color: white; }
    }
  `;
}
```

### Animations

```tsx
get styles() {
  return `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    
    .spinner {
      animation: spin 1s linear infinite;
    }
  `;
}
```

### Complex Selectors

```tsx
get styles() {
  return `
    .card { }
    .card.highlighted { box-shadow: 0 0 0 2px blue; }
    .card:hover .actions { opacity: 1; }
    .card > .header { }
    .card .header + .body { }
    .list > .item:nth-child(odd) { }
  `;
}
```

---

## React-Style Inline Objects

For simple dynamic values, you can also use React-style inline objects:

```tsx
render() {
  return (
    <div 
      class="card"
      style={{
        opacity: this.loading ? 0.5 : 1,
        transform: this.expanded ? 'scale(1.02)' : 'none',
      }}
    >
      {this.props.children}
    </div>
  );
}
```

The `h()` factory converts style objects to `el.style` assignments:

```ts
// Numbers auto-append 'px' for appropriate properties
style={{ padding: 16 }}        // → padding: 16px
style={{ opacity: 0.5 }}       // → opacity: 0.5 (unitless)
style={{ zIndex: 100 }}        // → z-index: 100 (unitless)
```

### When to Use Each

| Approach | Best For |
|----------|----------|
| `get styles()` | Pseudo-selectors, media queries, animations, complex selectors |
| `style={{}}` | Simple dynamic values, one-off overrides |

You can combine both:

```tsx
get styles() {
  return `
    .card { 
      padding: 16px;
      transition: opacity 0.2s;
    }
    .card:hover { transform: scale(1.02); }
  `;
}

render() {
  return (
    <div 
      class="card"
      style={{ opacity: this.loading ? 0.5 : 1 }}
    >
      ...
    </div>
  );
}
```

---

## SSR Support

### Server-Side

During SSR, component styles are collected and output in the HTML:

```tsx
// Server
import { renderToString, extractStyles } from 'mantle-web/ssr';

const html = renderToString(App, props);
const styles = extractStyles();  // All component styles

res.send(`
  <!DOCTYPE html>
  <html>
    <head>
      <style id="_mantle-ssr">${styles}</style>
    </head>
    <body>${html}</body>
  </html>
`);
```

### Hydration

On the client, components adopt their SSR styles initially. On first state change, they create their own `<style>` elements:

```tsx
// Client behavior:
// 1. Hydration: Uses styles from SSR <style> block
// 2. First update: Creates per-instance <style> element
// 3. Subsequent updates: Updates that element's textContent
```

---

## Comparison

| Feature | Mantle | Goober/Emotion | CSS Modules | Tailwind |
|---------|--------|----------------|-------------|----------|
| Reactive values | ✅ Direct | ✅ Via regeneration | ❌ No | ❌ No |
| SCSS-like nesting | ✅ Native CSS | ✅ Runtime | ✅ Build step | ❌ No |
| Pseudo-selectors | ✅ | ✅ | ✅ | ✅ |
| Media queries | ✅ | ✅ | ✅ | ✅ |
| Animations | ✅ | ✅ | ✅ | ⚠️ Limited |
| No build step | ✅ | ✅ | ❌ | ❌ |
| No runtime | ❌ (~30 lines) | ❌ (~1-6KB) | ✅ | ✅ |
| No style leak | ✅ | ⚠️ Can leak | ✅ | ✅ |
| Bundle size | ~0KB | ~1-6KB | ~0KB | ~0KB |

### Browser Support

CSS nesting is supported in all major browsers since late 2023:
- Chrome 120+ (Dec 2023)
- Firefox 117+ (Aug 2023)
- Safari 17.2+ (Dec 2023)
- Edge 120+ (Dec 2023)

For older browsers, you can either avoid nesting (write flat CSS) or use a PostCSS transform at build time.

---

## Summary

1. **Define styles** with `get styles()` returning a template string
2. **Use observables** directly — styles update automatically
3. **Native CSS nesting** — SCSS-like syntax, no preprocessor
4. **Automatic scoping** — framework wraps CSS in scope class
5. **No leaks** — styles replace, not accumulate
6. **Full CSS** — pseudo-selectors, media queries, animations
7. **Optional inline styles** — `style={{}}` for simple cases
8. **Zero dependencies** — no Goober, Emotion, etc.

The mental model: Each component owns its styles. When state changes, styles update. When the component unmounts, styles are removed. CSS nesting handles scoping. Simple.
