// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
    Command,
    CommandInput,
    CommandItem,
    CommandList,
} from '../../src/components/command.tsx';
import { Select } from '../../src/components/select.tsx';
import { useInlineLookupData } from '../../src/components/use-inline-lookup-data.ts';

type LookupItem = { id: string; text: string };
type LoadItems = (request: {
    query: string;
}) => Promise<{ items: LookupItem[]; nextCursor: string | null }>;

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 45));
const click = async (element: Element | null) =>
    React.act(async () => {
        assert.ok(element, 'expected control exists');
        element.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                pointerType: 'mouse',
            }),
        );
        element.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true, button: 0 }),
        );
        (element as HTMLElement).click();
        element.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                button: 0,
                pointerType: 'mouse',
            }),
        );
        await tick();
    });
const enter = async (input: Element | null, value: string) =>
    React.act(async () => {
        assert.ok(input, 'expected search input exists');
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await tick();
    });
window.HTMLElement.prototype.scrollIntoView = () => {};

try {
    await React.act(async () => {
        root.render(
            h(Select, {
                items: ['Surya Jaya', 'Surya Missing'],
                ariaLabel: 'Pilihan lokal',
            }),
        );
        await tick();
    });
    await click(document.querySelector('[data-slot="select-control"] button'));
    await enter(document.querySelector('input[role="combobox"]'), 'ja sur');
    const options = [...document.querySelectorAll('[role="option"]')].map(
        (item) => item.textContent,
    );
    assert.deepEqual(
        options,
        ['Surya Jaya'],
        'Select uses unordered word-prefix matching',
    );
    await enter(document.querySelector('input[role="combobox"]'), 'urya');
    assert.equal(
        document.querySelectorAll('[role="option"]').length,
        0,
        'Select does not retain substring fallback',
    );
    await React.act(async () => {
        root.render(
            h(Select, {
                key: 'remote',
                items: ['Hasil dari NPWP'],
                ariaLabel: 'Pilihan server',
                searchValue: '12 345',
                incremental: {
                    loading: false,
                    error: '',
                    hasMore: false,
                    loadMore: () => {},
                    retry: () => {},
                },
            }),
        );
        await tick();
    });
    await click(document.querySelector('[data-slot="select-control"] button'));
    assert.deepEqual(
        [...document.querySelectorAll('[role="option"]')].map(
            (item) => item.textContent,
        ),
        ['Hasil dari NPWP'],
        'server results are not filtered again by visible label',
    );
    const localItems: LookupItem[] = [
        { id: '1', text: 'Surya Jaya' },
        { id: '2', text: 'Surya Missing' },
    ];
    function LookupProbe({
        query,
        loadItems,
    }: {
        query: string;
        loadItems?: LoadItems;
    }) {
        const data = useInlineLookupData({
            items: localItems,
            query,
            loadItems,
            active: true,
            getItemValue: (item) => item.id,
            getSearchText: (item) => item.text,
        });

        return h('output', null, data.items.map((item) => item.id).join(','));
    }
    await React.act(async () => {
        root.render(h(LookupProbe, { query: 'ja sur' }));
        await tick();
    });
    assert.equal(
        document.querySelector('output')!.textContent,
        '1',
        'local lookup shares matching semantics',
    );
    let requested = '';
    const loadItems: LoadItems = async ({ query }) => {
        requested = query;

        return {
            items: [{ id: 'server', text: 'Label lain' }],
            nextCursor: null,
        };
    };
    await React.act(async () => {
        root.render(h(LookupProbe, { query: '12 345', loadItems }));
        await tick();
    });
    await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
    });
    assert.equal(requested, '12 345');
    assert.equal(
        document.querySelector('output')!.textContent,
        'server',
        'remote lookup bypasses local text matching',
    );
    function Commands() {
        const [query, setQuery] = React.useState('');

        return h(
            Command,
            null,
            h(CommandInput, { value: query, onValueChange: setQuery }),
            h(
                CommandList,
                null,
                h(
                    CommandItem,
                    { value: 'opaque-one', keywords: ['Surya Jaya'] },
                    'Surya Jaya',
                ),
                h(
                    CommandItem,
                    { value: 'opaque-two', keywords: ['Surya Missing'] },
                    'Surya Missing',
                ),
            ),
        );
    }
    await React.act(async () => {
        root.render(h(Commands));
        await tick();
    });
    await enter(document.querySelector('[cmdk-input]'), 'ja sur');
    assert.deepEqual(
        [...document.querySelectorAll('[cmdk-item]')].map(
            (item) => item.textContent,
        ),
        ['Surya Jaya'],
        'command palette uses shared matching',
    );
    await enter(document.querySelector('[cmdk-input]'), 'urya');
    assert.equal(
        document.querySelectorAll('[cmdk-item]').length,
        0,
        'command palette does not apply fuzzy substring fallback',
    );
    await enter(document.querySelector('[cmdk-input]'), 'opaque-one');
    assert.deepEqual(
        [...document.querySelectorAll('[cmdk-item]')].map(
            (item) => item.textContent,
        ),
        ['Surya Jaya'],
        'explicit keywords do not remove the command value from search',
    );
    console.log(
        'Record search interactions: Select, remote bypass, InlineLookup data, and command palette passed.',
    );
} finally {
    await React.act(async () => root.unmount());
    window.close();
}
