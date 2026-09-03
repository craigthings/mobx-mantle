import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { autorun, makeAutoObservable } from 'mobx';
import { shareStores, shared, unshare } from '../src/shared';
import { tick } from './helpers';

class Prefs {
  accent = 'indigo';
  density = 'cozy';
  tags: string[] = [];
  _private = 'local';

  constructor() {
    makeAutoObservable(this);
  }

  get label() {
    return `${this.accent}/${this.density}`;
  }

  setAccent(accent: string) {
    this.accent = accent;
  }
}

const KEY = 'test:prefs';
const shared_: object[] = [];

/** Another "window": a distinct instance of the same store module, sharing the key. */
function open(key = KEY, options?: Parameters<typeof shared>[2]) {
  const store = shared(new Prefs(), key, options);
  shared_.push(store);
  return store;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const store of shared_.splice(0)) unshare(store);
  localStorage.clear();
});

describe('shared stores', () => {
  it('restores from storage, publishes changes to storage and the channel, and applies them in another window', async () => {
    localStorage.setItem(KEY, JSON.stringify({ accent: 'rose' }));
    const a = open();
    expect(a.accent).toBe('rose'); // restored
    expect(a.density).toBe('cozy'); // untouched: not in storage
    expect(a._private).toBe('local');

    const b = open();
    expect(b.accent).toBe('rose');

    b.setAccent('teal');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      accent: 'teal',
      density: 'cozy',
      tags: [],
    });
    await tick();
    expect(a.accent).toBe('teal');
    expect(a.label).toBe('teal/cozy');
  });

  it('applies the storage event too, so windows without a channel still follow', () => {
    const a = open();
    window.dispatchEvent(
      new StorageEvent('storage', { key: KEY, newValue: JSON.stringify({ density: 'compact' }) }),
    );
    expect(a.density).toBe('compact');
    expect(a.accent).toBe('indigo');

    // Other keys and malformed writes are ignored.
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '{"accent":"x"}' }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'not json' }));
    expect(a.accent).toBe('indigo');
  });

  it('effects derive from state: a reaction on the receiving window runs on a synced change', async () => {
    const a = open();
    const b = open();
    const applied: string[] = [];
    const stop = autorun(() => applied.push(a.accent));
    try {
      b.setAccent('rose');
      await tick();
      expect(applied).toEqual(['indigo', 'rose']);
    } finally {
      stop();
    }
  });

  it('bounds echoes: a synced change is not re-published as a new change', async () => {
    const a = open();
    const b = open();
    // Assigning a method on localStorage itself would store an item (the
    // Storage named setter); spy on the prototype instead.
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    b.setAccent('teal');
    await tick();
    await tick();
    expect(a.accent).toBe('teal');
    // b published once; a applied without publishing again.
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('shares only the chosen fields, and never persists with persist: false', async () => {
    const a = open(KEY, { fields: ['accent'] });
    const b = open(KEY, { fields: ['accent'] });
    b.setAccent('rose');
    b.density = 'compact';
    await tick();
    expect(a.accent).toBe('rose');
    expect(a.density).toBe('cozy');

    const c = open('test:volatile', { persist: false });
    c.setAccent('teal');
    expect(localStorage.getItem('test:volatile')).toBeNull();
  });

  it('is idempotent per store; unshare stops the sync and keeps the state', async () => {
    const a = open();
    expect(shared(a, KEY)).toBe(a);
    const b = open();
    unshare(a);
    b.setAccent('rose');
    await tick();
    expect(a.accent).toBe('indigo');
  });

  it('shareStores wires several stores under prefixed keys', async () => {
    const theme = new Prefs();
    const nav = new Prefs();
    shareStores({ theme, nav }, { prefix: 'app' });
    shared_.push(theme, nav);
    theme.setAccent('rose');
    nav.density = 'compact';
    expect(JSON.parse(localStorage.getItem('app:theme')!).accent).toBe('rose');
    expect(JSON.parse(localStorage.getItem('app:nav')!).density).toBe('compact');

    const another = open('app:theme');
    expect(another.accent).toBe('rose');
  });
});
