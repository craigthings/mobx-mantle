import { Behavior, createBehavior } from '../src';

/**
 * Example Behavior: tracks window size reactively.
 * 
 * Demonstrates the `with___` factory convention:
 * - Class uses PascalCase: WindowSizeBehavior
 * - Factory uses camelCase with `with` prefix: withWindowSize
 */
class WindowSizeBehavior extends Behavior {
  width = window.innerWidth;
  height = window.innerHeight;
  breakpoint!: number;

  onCreate(breakpoint = 768) {
    this.breakpoint = breakpoint;
  }

  get isMobile() {
    return this.width < this.breakpoint;
  }

  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
  }

  onMount() {
    window.addEventListener('resize', this.handleResize);
    return () => window.removeEventListener('resize', this.handleResize);
  }
}

export const withWindowSize = createBehavior(WindowSizeBehavior);
