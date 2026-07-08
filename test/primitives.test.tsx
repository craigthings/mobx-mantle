import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { runInAction } from 'mobx';
import { Component, createComponent } from '../src';
import { withFetch, withLocalStorage, withAutosave } from '../src/primitives';
import { deferred, tick } from './helpers';

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('primitives', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('withFetch', () => {
    it('refetches on getter-URL change and discards out-of-order completions', async () => {
      const a = deferred<Response>();
      const b = deferred<Response>();
      const fetchMock = vi.fn((url: string) => (url === '/a' ? a.promise : b.promise));
      vi.stubGlobal('fetch', fetchMock);

      let host!: Loader;
      class Loader extends Component {
        url = '/a';
        loader = withFetch<string>(() => this.url);
        onCreate() {
          host = this;
        }
        render() {
          return <div />;
        }
      }
      const El = createComponent(Loader);
      render(<El />);

      // fireImmediately watch fetched the initial URL at commit
      expect(fetchMock).toHaveBeenCalledWith('/a', undefined);

      // Change the URL → second fetch fires
      act(() => {
        runInAction(() => {
          host.url = '/b';
        });
      });
      expect(fetchMock).toHaveBeenCalledWith('/b', undefined);

      // Second request resolves first
      b.resolve(fakeResponse('B'));
      await act(async () => {
        await tick();
      });
      expect(host.loader.data).toBe('B');

      // First (now stale) request resolves late → must be discarded
      a.resolve(fakeResponse('A'));
      await act(async () => {
        await tick();
      });
      expect(host.loader.data).toBe('B');
      expect(host.loader.loading).toBe(false);
    });
  });

  describe('withLocalStorage', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('hydrates from storage, persists on change, and applies cross-tab storage events', () => {
      localStorage.setItem('pref', JSON.stringify('stored'));

      let host!: Prefs;
      class Prefs extends Component {
        pref = withLocalStorage<string>('pref', 'default');
        onCreate() {
          host = this;
        }
        render() {
          return <div />;
        }
      }
      const El = createComponent(Prefs);
      render(<El />);

      // hydrated from existing storage, not the default
      expect(host.pref.value).toBe('stored');

      // persists on change
      act(() => {
        runInAction(() => {
          host.pref.value = 'changed';
        });
      });
      expect(JSON.parse(localStorage.getItem('pref')!)).toBe('changed');

      // cross-tab write arrives as a storage event
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'pref', newValue: JSON.stringify('external') })
        );
      });
      expect(host.pref.value).toBe('external');
    });
  });

  describe('withAutosave (composition: withInterval + withAsync)', () => {
    it('interval tick runs the async save; saving/error state is observable', async () => {
      vi.useFakeTimers();
      const save = deferred<Response>();
      const fetchMock = vi.fn((_url: string, _init?: RequestInit) => save.promise);
      vi.stubGlobal('fetch', fetchMock);

      let host!: Editor;
      class Editor extends Component {
        content = 'hello';
        autosave = withAutosave('/save', () => ({ content: this.content }), 1000);
        onCreate() {
          host = this;
        }
        render() {
          return <div />;
        }
      }
      const El = createComponent(Editor);
      render(<El />);

      expect(host.autosave.saving).toBe(false);

      // interval fires → save() runs (payload differs from never-saved) → POST
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toBe('/save');
      expect(host.autosave.saving).toBe(true);

      // resolve the save → saving clears, no error
      save.resolve(fakeResponse({}, true));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(host.autosave.saving).toBe(false);
      expect(host.autosave.error).toBeUndefined();
    });
  });
});
