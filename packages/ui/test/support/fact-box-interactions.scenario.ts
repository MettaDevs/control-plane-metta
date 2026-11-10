// Dijalankan lewat `runScenario` dengan `--preload ./dom.ts`, jadi DOM sudah terpasang sebelum modul apa pun dimuat.
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FactBox } from '../../src/components/fact-box.tsx';
import { FilterPane } from '../../src/components/filter-pane.tsx';
import { ListPageLayout } from '../../src/components/list-page-layout.tsx';
import { RecordActionBar } from '../../src/components/record-action-bar.tsx';

const root = createRoot(document.getElementById('root')!);
const h = React.createElement;
const tick = () => new Promise((resolve) => setTimeout(resolve, 35));
const click = async (element: Element | null) =>
    React.act(async () => {
        assert.ok(element, 'expected control to exist');
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
        await tick();
    });

try {
    let uploads = 0;
    const app = h(
        React.Fragment,
        null,
        h(RecordActionBar, {
            title: 'Inventarisasi aset',
            search: { value: '', onValueChange: () => {}, label: 'Cari aset' },
            groups: [
                {
                    id: 'home',
                    label: 'Home',
                    actions: [
                        {
                            id: 'print',
                            label: 'Cetak label',
                            onSelect: () => {},
                        },
                    ],
                },
            ],
        }),
        h(FactBox, {
            fillHeight: true,
            toolbarContainer: document.getElementById('toolbar'),
            details: 'Detail aset',
            attachments: h(
                'button',
                { id: 'upload', onClick: () => uploads++ },
                'Upload',
            ),
            children: 'Daftar aset',
        }),
    );
    await React.act(async () => root.render(app));
    const attachmentTab = () =>
        document.querySelector('[role="tab"][id$="attachments"]');
    const home = () => document.querySelector('[data-action-group="home"]');
    const ribbon = () =>
        document.querySelector<HTMLElement>(
            '[data-slot="record-action-ribbon"]',
        );
    assert.equal(
        document.body.style.pointerEvents,
        '',
        'initial load does not lock the body',
    );
    assert.equal(getComputedStyle(attachmentTab()!).pointerEvents, 'auto');
    await click(attachmentTab());
    assert.equal(attachmentTab()!.getAttribute('aria-selected'), 'true');
    await click(document.getElementById('upload'));
    assert.equal(uploads, 1);
    await click(home());
    assert.ok(ribbon());
    assert.notEqual(ribbon()!.dataset.pinned, 'true');
    assert.equal(
        document.body.style.pointerEvents,
        '',
        'floating ribbon must remain nonmodal',
    );
    await click(attachmentTab());
    assert.equal(attachmentTab()!.getAttribute('aria-selected'), 'true');
    assert.equal(
        ribbon(),
        null,
        'outside interaction closes the floating ribbon',
    );
    await click(home());
    await click(document.querySelector('[aria-label="Sematkan toolbar"]'));
    assert.equal(ribbon()!.dataset.pinned, 'true');
    assert.ok(
        document
            .querySelector('[data-slot="record-action-bar"]')!
            .contains(ribbon()),
        'pinned ribbon occupies normal bar DOM flow',
    );
    await click(document.querySelector('[aria-label="Lepas sematan toolbar"]'));
    assert.notEqual(ribbon()!.dataset.pinned, 'true');
    await React.act(async () => {
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await tick();
    });
    assert.equal(ribbon(), null);
    assert.equal(document.activeElement, home());
    await click(document.querySelector('[aria-label="Cari aset"]'));
    assert.equal(document.activeElement?.getAttribute('type'), 'search');
    await click(
        document.querySelector(
            '#toolbar button[aria-label="Sembunyikan detail dan lampiran"]',
        ),
    );
    await click(
        document.querySelector(
            '#toolbar button[aria-label="Tampilkan detail dan lampiran"]',
        ),
    );
    assert.equal(attachmentTab()!.getAttribute('aria-selected'), 'true');
    function CardToolbarHarness() {
        const [host, setHost] = React.useState<HTMLDivElement | null>(null);

        return h(
            React.Fragment,
            null,
            h(RecordActionBar, {
                trailing: h('div', { ref: setHost }),
                children: h('button', { type: 'button' }, 'Simpan'),
            }),
            h(FactBox, {
                fillHeight: true,
                toolbarContainer: host,
                details: 'Detail card',
                attachments: 'Lampiran card',
                children: 'Form card',
            }),
        );
    }
    await React.act(async () => {
        root.render(h(CardToolbarHarness));
        await tick();
    });
    const cardCommands = document.querySelector(
        '[data-slot="record-action-bar"]',
    );
    assert.ok(
        cardCommands!.querySelector('[data-slot="fact-box-controls"]'),
        'card FactBox controls belong to its command toolbar',
    );
    assert.equal(
        document.querySelector('aside [data-slot="fact-box-controls"]'),
        null,
        'card panel has no duplicate controls',
    );
    await click(document.querySelector('[role="tab"][id$="attachments"]'));
    assert.match(
        document.querySelector('aside')!.textContent!,
        /Lampiran card/,
    );
    let vendorSearches = 0;
    function VendorToolbarHarness() {
        const [open, setOpen] = React.useState(false);
        const toolbar = h(RecordActionBar, {
            title: 'Vendor',
            titleHint: 'Akun vendor per perusahaan.',
            search: {
                value: '',
                onValueChange: () => {},
                onSubmit: () => vendorSearches++,
                label: 'Cari vendor',
            },
            filter: {
                open,
                onOpenChange: setOpen,
                controls: 'vendor-test-filter',
            },
        });

        return h(ListPageLayout, {
            header: toolbar,
            filterPanel: open
                ? h(FilterPane, {
                      id: 'vendor-test-filter',
                      title: 'Filter vendor',
                      onClose: () => setOpen(false),
                      children: h(
                          'select',
                          { 'aria-label': 'Status vendor' },
                          h('option', null, 'Semua'),
                      ),
                  })
                : null,
            children: h('input', {
                'aria-label': 'State daftar',
                defaultValue: 'tetap',
            }),
        });
    }
    await React.act(async () => root.render(h(VendorToolbarHarness)));
    assert.equal(
        document.querySelector('[data-slot="filter-pane"]'),
        null,
        'filters start closed',
    );
    const stableContent = document.querySelector(
        '[data-slot="list-page-content"]',
    );
    await click(document.querySelector('[aria-label="Tampilkan filter"]'));
    assert.equal(
        document.querySelector('[data-slot="list-page-content"]'),
        stableContent,
        'filter toggling retains list state',
    );
    assert.ok(
        document
            .querySelector('[data-slot="filter-pane"]')!
            .compareDocumentPosition(stableContent!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        'filter is on the left',
    );
    assert.ok(document.querySelector('[data-slot="filter-pane"]'));
    assert.equal(
        document
            .querySelector('[aria-label="Sembunyikan filter"]')!
            .getAttribute('aria-expanded'),
        'true',
    );
    await click(document.querySelector('[aria-label="Sembunyikan filter"]'));
    assert.equal(document.querySelector('[data-slot="filter-pane"]'), null);
    await click(document.querySelector('[aria-label="Cari vendor"]'));
    await React.act(async () => {
        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await tick();
    });
    assert.equal(
        vendorSearches,
        1,
        'Enter submits server search without inventing a fetch engine',
    );
    const titleButton = document.querySelector(
        '[data-slot="record-action-bar"] [data-slot="tooltip-trigger"]',
    );
    assert.equal(titleButton!.textContent, 'Vendor');
    assert.ok(titleButton!.className.includes('hover:underline'));
    await click(titleButton);
    assert.match(
        document.querySelector('[role="tooltip"]')!.textContent!,
        /Akun vendor per perusahaan/,
    );
    await click(titleButton);
    assert.equal(
        document.querySelector('[role="tooltip"]'),
        null,
        'title click toggles pinned help',
    );
    console.log(
        'PASS: first-load FactBox tab/button, nonmodal ribbon outside click, pin/unpin, Escape focus, search focus, external panel toggle, closed filters, server-search Enter, title hint toggle. DOM/CSS pointer inheritance only; no browser layout or hit-testing.',
    );
} finally {
    await React.act(async () => root.unmount());
    window.close();
}
