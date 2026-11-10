import { afterAll, afterEach, beforeAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import {
    getPageDialogRevision,
    getPageDialogStack,
    registerPageDialog,
    subscribePageDialogs,
} from '../../src/lib/page-dialog-stack.ts';

// Elemen tiruan hanya membawa bagian yang dibaca registerPageDialog, jadi bentuknya dipaksakan ke tipe DOM.
type FakeButton = {
    isConnected: boolean;
    focused: number;
    closest: () => object | null;
    focus(): void;
};
const asElement = <T>(value: unknown) => value as T;

const frames: FrameRequestCallback[] = [];
const cleanups = new Set<() => void>();
const previousAnimationFrame = globalThis.requestAnimationFrame;
beforeAll(() => {
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
});
const flushFocus = () => frames.splice(0).forEach((callback) => callback(0));
afterEach(() => {
    [...cleanups].reverse().forEach((cleanup) => cleanup());
    cleanups.clear();
    flushFocus();
});
afterAll(() => {
    if (previousAnimationFrame) {
        globalThis.requestAnimationFrame = previousAnimationFrame;
    } else {
        delete (globalThis as { requestAnimationFrame?: unknown })
            .requestAnimationFrame;
    }
});

function button(isInert = () => false): FakeButton {
    return {
        isConnected: true,
        focused: 0,
        closest: () => (isInert() ? {} : null),
        focus() {
            this.focused++;
        },
    };
}
function shell(initiallyInert = false) {
    const background = { inert: initiallyInert };
    const host = asElement<HTMLElement>({
        closest(selector: string) {
            assert.equal(selector, '[data-shell-content]');

            return {
                querySelector(selector: string) {
                    assert.equal(selector, '[data-shell-page-content]');

                    return background;
                },
            };
        },
    });
    const launcher = button(() => background.inert);

    return { host, background, launcher };
}
function open(host: HTMLElement, opener: FakeButton) {
    const cleanup = registerPageDialog({
        id: Symbol(),
        host,
        opener: asElement<HTMLElement>(opener),
        node: asElement<HTMLDivElement>({ querySelector: () => button() }),
    });
    const close = () => {
        cleanups.delete(close);
        cleanup();
    };
    cleanups.add(close);

    return close;
}

test('closing a child preserves the parent and returns focus before unblocking the shell', () => {
    const { host, background, launcher } = shell();
    const closeParent = open(host, launcher);
    const drillDown = button();
    const closeChild = open(host, drillDown);
    assert.equal(getPageDialogStack(host).length, 2);
    assert.equal(background.inert, true);
    closeChild();
    assert.equal(background.inert, true);
    assert.equal(getPageDialogStack(host).length, 1);
    flushFocus();
    assert.equal(drillDown.focused, 1);
    closeParent();
    assert.equal(background.inert, false);
    flushFocus();
    assert.equal(launcher.focused, 1);
    assert.equal(getPageDialogStack(host).length, 0);
});

test('hosts remain independent and an already inert background stays inert', () => {
    const first = shell();
    const second = shell(true);
    const closeFirst = open(first.host, first.launcher);
    const closeSecond = open(second.host, second.launcher);
    closeFirst();
    assert.equal(first.background.inert, false);
    assert.equal(second.background.inert, true);
    assert.equal(getPageDialogStack(second.host).length, 1);
    closeSecond();
    assert.equal(second.background.inert, true);
});

test('removing a parent before its child restores the original connected launcher', () => {
    const { host, background, launcher } = shell();
    const closeParent = open(host, launcher);
    const nestedLauncher = button();
    const closeChild = open(host, nestedLauncher);
    closeParent();
    nestedLauncher.isConnected = false;
    closeChild();
    flushFocus();
    assert.equal(background.inert, false);
    assert.equal(launcher.focused, 1);
    assert.equal(nestedLauncher.focused, 0);
});

test('the React store revision changes on open and close and subscriptions can detach', () => {
    const { host, launcher } = shell();
    const initialRevision = getPageDialogRevision();
    let notifications = 0;
    const unsubscribe = subscribePageDialogs(() => notifications++);
    const close = open(host, launcher);
    unsubscribe();
    close();
    assert.equal(notifications, 1);
    assert.equal(getPageDialogRevision(), initialRevision + 2);
});
