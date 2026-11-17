/**
 * Installs a happy-dom window as the global DOM so that Preact components
 * can be rendered and driven in Node, without a browser.
 */
import { Window } from "happy-dom";

const GLOBALS = [
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "SVGElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLFormElement",
  "Event",
  "MouseEvent",
  "PointerEvent",
  "WheelEvent",
  "KeyboardEvent",
  "FocusEvent",
] as const;

export interface Dom {
  window: Window;
  document: Document;
  close(): Promise<void>;
}

export function installDom(): Dom {
  const window = new Window({ url: "http://localhost:3000/" });
  const g = globalThis as Record<string, unknown>;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", ...GLOBALS]) {
    previous.set(name, Object.getOwnPropertyDescriptor(g, name));
    const value = name === "window" ? window : (window as unknown as Record<string, unknown>)[name];
    Object.defineProperty(g, name, { value, configurable: true, writable: true });
  }
  return {
    window,
    document: window.document as unknown as Document,
    async close() {
      await window.happyDOM.close();
      for (const [name, desc] of previous) {
        if (desc) Object.defineProperty(g, name, desc);
        else delete g[name];
      }
    },
  };
}

type PointerInit = { clientX?: number; clientY?: number; button?: number; shiftKey?: boolean };

/** Dispatches a bubbling pointer event (pointerdown / pointermove / pointerup). */
export function pointer(target: Element, type: string, init: PointerInit = {}): void {
  const Ctor = (globalThis as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent;
  target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...init }));
}

/** Sets an input's value and fires `change`, as when the user leaves the field. */
export function changeValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new (globalThis as unknown as { Event: typeof Event }).Event("change", { bubbles: true }));
}

/** Dispatches a wheel event. happy-dom's WheelEvent ignores clientX/Y, so they are defined by hand. */
export function wheel(target: Element, init: { deltaY: number; clientX: number; clientY: number }): void {
  const Ctor = (globalThis as unknown as { WheelEvent: typeof WheelEvent }).WheelEvent;
  const event = new Ctor("wheel", { deltaY: init.deltaY, bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { value: init.clientX });
  Object.defineProperty(event, "clientY", { value: init.clientY });
  target.dispatchEvent(event);
}
