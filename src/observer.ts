import React, { memo, useRef, useSyncExternalStore, useEffect, useLayoutEffect } from 'react';
import { Reaction } from 'mobx';

/**
 * useLayoutEffect that falls back to useEffect on the server, where layout
 * effects never run and React warns during renderToString. Neither runs
 * server-side; the fallback only silences the noise.
 */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Holder linking a component instance to its render reaction, so PropsBox
 * can recognize "my own render is reading me" and skip tracking (React
 * already delivers prop changes through memo — tracking would only schedule
 * a redundant second render). Stable per React component instance; survives
 * HMR instance swaps.
 */
export interface RenderReactionHolder {
  current: Reaction | null;
}

interface ObserverAdmin {
  reaction: Reaction | null;
  onStoreChange: (() => void) | null;
  stateVersion: symbol;
  name: string;
  holder: RenderReactionHolder | undefined;
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => symbol;
}

/**
 * Reactions are created during render, but React may never commit that
 * render (Suspense throws, aborted transitions, StrictMode's discarded
 * pass) — then no cleanup effect ever runs. The registry disposes reactions
 * whose owning component was garbage-collected without committing.
 * Committed components unregister in subscribe() and dispose through the
 * normal unsubscribe path.
 */
const uncommittedReactionRegistry =
  typeof FinalizationRegistry !== 'undefined'
    ? new FinalizationRegistry<ObserverAdmin>((adm) => {
        adm.reaction?.dispose();
        adm.reaction = null;
      })
    : undefined;

if (process.env.NODE_ENV !== 'production' && !uncommittedReactionRegistry) {
  console.warn(
    '[mobx-mantle] FinalizationRegistry is not available in this environment. ' +
    'Reactions created for renders that React discards cannot be cleaned up, ' +
    'which can leak under Suspense and concurrent rendering.'
  );
}

const isServer = typeof window === 'undefined';

function createReaction(adm: ObserverAdmin): void {
  adm.reaction = new Reaction(`mantle-observer(${adm.name})`, () => {
    adm.stateVersion = Symbol();
    adm.onStoreChange?.();
  });
  if (adm.holder) {
    adm.holder.current = adm.reaction;
  }
}

/**
 * Track a render function with a MobX Reaction owned by Mantle (rather than
 * mobx-react-lite's useObserver). Owning the reaction exposes its identity —
 * that is what lets PropsBox skip self-notification (see RenderReactionHolder).
 *
 * On the server this renders untracked: no reaction is ever created, so
 * renderToString leaks nothing by construction.
 */
export function useMantleObserver<T>(render: () => T, name: string, holder?: RenderReactionHolder): T {
  if (isServer) {
    return render();
  }

  const admRef = useRef<ObserverAdmin | null>(null);

  if (!admRef.current) {
    const adm: ObserverAdmin = {
      reaction: null,
      onStoreChange: null,
      stateVersion: Symbol(),
      name,
      holder,
      subscribe(onStoreChange: () => void) {
        // Committed: normal effect lifecycle owns disposal from here on.
        uncommittedReactionRegistry?.unregister(adm);
        adm.onStoreChange = onStoreChange;

        if (!adm.reaction) {
          // The reaction was disposed before this commit (registry cleanup,
          // or a StrictMode unmount pass). Re-create it and force one
          // re-render so it tracks current dependencies.
          createReaction(adm);
          adm.stateVersion = Symbol();
          onStoreChange();
        }

        return () => {
          adm.onStoreChange = null;
          adm.reaction?.dispose();
          adm.reaction = null;
          if (adm.holder) {
            adm.holder.current = null;
          }
        };
      },
      getSnapshot() {
        return adm.stateVersion;
      },
    };
    admRef.current = adm;
  }

  const adm = admRef.current;
  adm.holder = holder;

  if (!adm.reaction) {
    // First render, or first render after disposal. Guard against the
    // never-committed case until subscribe() takes ownership.
    createReaction(adm);
    uncommittedReactionRegistry?.register(admRef, adm, adm);
  }

  useSyncExternalStore(adm.subscribe, adm.getSnapshot, adm.getSnapshot);

  let result!: T;
  let didThrow = false;
  let thrown: unknown;
  adm.reaction!.track(() => {
    try {
      result = render();
    } catch (e) {
      didThrow = true;
      thrown = e;
    }
  });
  if (didThrow) {
    throw thrown;
  }
  return result;
}

/**
 * Minimal observer() for plain function components — re-renders when any
 * observable read during render changes. Useful together with useBehavior()
 * in codebases that don't (or don't yet) use Mantle components.
 *
 * @example
 * ```tsx
 * const Toolbar = observer((props: Props) => {
 *   const size = useBehavior(() => withWindowSize());
 *   return <div>{size.width}px</div>;
 * });
 * ```
 */
export function observer<P extends object>(
  fc: ((props: P) => React.ReactElement | null) & { displayName?: string }
): (props: P) => React.ReactElement | null {
  const name = fc.displayName || fc.name || 'observed';
  const Observed = (props: P) => useMantleObserver(() => fc(props), name);
  Observed.displayName = `observer(${name})`;
  return memo(Observed) as unknown as (props: P) => React.ReactElement | null;
}
