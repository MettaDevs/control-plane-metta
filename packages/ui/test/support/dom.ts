import { JSDOM } from 'jsdom';

// Dimuat dengan `--preload` sebelum skenario DOM (lihat `scenario.ts`). React DOM dan beberapa pustaka memeriksa
// `document` saat dimuat, misalnya Radix yang mengganti useLayoutEffect dengan fungsi kosong bila `document`
// belum ada, jadi DOM harus terpasang sebelum modul apa pun dimuat.
const dom = new JSDOM(
    '<!doctype html><html><body><div id="toolbar"></div><div id="root"></div></body></html>',
    { url: 'http://sdk-test.invalid', pretendToBeVisual: true },
);

const globals = globalThis as Record<string, unknown>;
const view = dom.window as unknown as Record<string, unknown>;
for (const name of [
    'window',
    'document',
    'HTMLElement',
    'HTMLButtonElement',
    'HTMLInputElement',
    'Element',
    'Node',
    'NodeFilter',
    'DocumentFragment',
    'MutationObserver',
    'Event',
    'PointerEvent',
    'MouseEvent',
    'KeyboardEvent',
    'CustomEvent',
]) {
    globals[name] =
        name === 'window'
            ? dom.window
            : name === 'document'
              ? dom.window.document
              : view[name];
}

globals.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globals.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
    dom.window,
);
globals.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globals.ResizeObserver = class {
    constructor(private readonly callback: (entries: unknown[]) => void) {}
    observe() {
        this.callback([]);
    }
    unobserve() {}
    disconnect() {}
};
const element = dom.window.HTMLElement.prototype;
element.hasPointerCapture = () => false;
element.setPointerCapture = () => {};
element.releasePointerCapture = () => {};
Object.defineProperty(element, 'clientWidth', {
    get() {
        return 1200;
    },
});
globals.IS_REACT_ACT_ENVIRONMENT = true;
