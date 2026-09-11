import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, createComponent } from '../src';
import { withElementSize, type ElementSizeBehavior } from '../src/behaviors';

afterEach(() => vi.unstubAllGlobals());

describe('withElementSize', () => {
  it('reacquires element measurement during StrictMode effect replay', () => {
    let measured = { width: 720, height: 360 };
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      () => measured.width,
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      () => measured.height,
    );
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          top: 0,
          right: measured.width,
          bottom: measured.height,
          left: 0,
          width: measured.width,
          height: measured.height,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    class ResizeObserverMock implements ResizeObserver {
      static instances: ResizeObserverMock[] = [];

      readonly callback: ResizeObserverCallback;
      readonly observed = new Set<Element>();
      disconnected = false;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        ResizeObserverMock.instances.push(this);
      }

      observe(target: Element) {
        this.observed.add(target);
      }

      unobserve(target: Element) {
        this.observed.delete(target);
      }

      disconnect() {
        this.disconnected = true;
        this.observed.clear();
      }

      emit() {
        const entries = [...this.observed].map(
          (target) =>
            ({
              target,
              borderBoxSize: [
                { inlineSize: measured.width, blockSize: measured.height },
              ],
            }) as unknown as ResizeObserverEntry,
        );
        this.callback(entries, this);
      }
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    let size!: ElementSizeBehavior;
    class MeasuredModel extends Component {
      root = this.ref<HTMLDivElement>();
      elementSize = withElementSize(this.root);

      onCreate() {
        size = this.elementSize;
      }

      render() {
        return (
          <div ref={this.root}>
            <span data-testid="dimensions">
              {this.elementSize.width ?? 'null'}×{this.elementSize.height ?? 'null'}
            </span>
          </div>
        );
      }
    }
    const Measured = createComponent(MeasuredModel);

    const view = render(
      <StrictMode>
        <Measured />
      </StrictMode>,
    );

    expect(ResizeObserverMock.instances).toHaveLength(2);
    expect(ResizeObserverMock.instances[0].disconnected).toBe(true);
    expect(ResizeObserverMock.instances[1].disconnected).toBe(false);
    expect(screen.getByTestId('dimensions').textContent).toBe('720×360');

    measured = { width: 520, height: 280 };
    act(() => ResizeObserverMock.instances[1].emit());
    expect(screen.getByTestId('dimensions').textContent).toBe('520×280');

    view.unmount();
    expect(ResizeObserverMock.instances[1].disconnected).toBe(true);
    expect(size.width).toBeNull();
    expect(size.height).toBeNull();

  });

  it('keeps element measurements in layout space under ancestor CSS transforms', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1023);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(640);
    const visualRect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      {
        x: 0,
        y: 0,
        top: 0,
        right: 788,
        bottom: 493,
        left: 0,
        width: 788,
        height: 493,
        toJSON: () => ({}),
      } as DOMRect,
    );

    class ResizeObserverMock implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              borderBoxSize: [{ inlineSize: 1023, blockSize: 640 }],
            } as unknown as ResizeObserverEntry,
          ],
          this,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    class ZoomedModel extends Component {
      root = this.ref<HTMLDivElement>();
      size = withElementSize(this.root);

      render() {
        return (
          <div ref={this.root} data-testid="zoomed-dimensions">
            {this.size.width}x{this.size.height}
          </div>
        );
      }
    }
    const Zoomed = createComponent(ZoomedModel);

    render(
      <div style={{ transform: 'scale(0.77)' }}>
        <Zoomed />
      </div>,
    );

    expect(screen.getByTestId('zoomed-dimensions').textContent).toBe('1023x640');
    expect(visualRect).not.toHaveBeenCalled();
  });
});
