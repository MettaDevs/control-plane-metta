import { test } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FactBox } from '../../src/components/fact-box.tsx';
import {
    changeRibbonState,
    RecordActionBar,
} from '../../src/components/record-action-bar.tsx';

test('record toolbar: Home commands, DOM order, unchanged plain bar, and external FactBox controls', () => {
    const h = React.createElement;
    const toolbar = renderToStaticMarkup(
        h(RecordActionBar, {
            title: 'Inventarisasi aset',
            groups: [
                {
                    id: 'home',
                    label: 'Home',
                    actions: [
                        {
                            id: 'labels',
                            label: 'Cetak label',
                            onSelect: () => {},
                        },
                    ],
                },
            ],
            search: {
                value: 'mesin',
                onValueChange: () => {},
                label: 'Cari aset',
            },
            children: [
                h('input', {
                    key: 'search',
                    type: 'search',
                    'aria-label': 'Cari aset',
                }),
                h('button', { key: 'new', type: 'button' }, 'Baru'),
            ],
            trailing: h('span', null, 'Kontrol panel'),
        }),
    );
    assert.doesNotMatch(toolbar, /aria-haspopup="menu"/);
    assert.match(toolbar, /data-action-group="home"/);
    assert.match(toolbar, /aria-expanded="false"/);
    assert.doesNotMatch(toolbar, /role="tablist"|role="tabpanel"/);
    assert.match(toolbar, />Home</);
    assert.ok(toolbar.indexOf('type="search"') < toolbar.indexOf('>Baru<'));
    assert.ok(
        toolbar.indexOf('>Baru<') < toolbar.indexOf('>Home<'),
        'New precedes Home on the left',
    );
    assert.ok(
        toolbar.indexOf('>Home<') < toolbar.indexOf('Kontrol panel'),
        'panel controls stay trailing',
    );
    const group = {
        id: 'home',
        label: 'Home',
        actions: [{ id: 'labels', label: 'Cetak label', onSelect: () => {} }],
    };
    const collapsedSearch = renderToStaticMarkup(
        h(RecordActionBar, {
            groups: [group],
            search: { value: '', onValueChange: () => {}, label: 'Cari aset' },
        }),
    );
    assert.match(collapsedSearch, /aria-label="Cari aset"/);
    assert.doesNotMatch(collapsedSearch, /type="search"/);
    const dropdown = renderToStaticMarkup(
        h(RecordActionBar, { mode: 'dropdown', groups: [group] }),
    );
    assert.match(dropdown, /aria-haspopup="menu"/);
    const pinnedToolbar = renderToStaticMarkup(
        h(RecordActionBar, { groups: [group], defaultPinned: true }),
    );
    assert.match(pinnedToolbar, /data-slot="record-action-ribbon"/);
    assert.match(pinnedToolbar, /data-pinned="true"/);
    assert.match(pinnedToolbar, /Lepas sematan toolbar/);
    assert.match(pinnedToolbar, /Cetak label/);
    const closed = { kind: 'closed' } as const;
    const floating = changeRibbonState(closed, {
        type: 'select',
        groupId: 'home',
    });
    assert.deepEqual(floating, { kind: 'floating', groupId: 'home' });
    assert.deepEqual(
        changeRibbonState(floating, { type: 'select', groupId: 'home' }),
        closed,
    );
    const pinned = changeRibbonState(floating, { type: 'pin' });
    assert.deepEqual(pinned, { kind: 'pinned', groupId: 'home' });
    assert.deepEqual(
        changeRibbonState(pinned, { type: 'dismiss' }),
        pinned,
        'outside and Escape leave pinned ribbon in layout',
    );
    assert.deepEqual(
        changeRibbonState(pinned, { type: 'select', groupId: 'manage' }),
        { kind: 'pinned', groupId: 'manage' },
    );
    assert.deepEqual(changeRibbonState(pinned, { type: 'unpin' }), floating);
    assert.deepEqual(changeRibbonState(floating, { type: 'dismiss' }), closed);
    const ordinary = renderToStaticMarkup(
        h(RecordActionBar, { title: 'Form', children: 'Simpan' }),
    );
    assert.doesNotMatch(ordinary, /role="tablist"/);
    assert.match(ordinary, /Simpan/);
    const props = {
        fillHeight: true,
        details: 'Detail aset',
        attachments: 'Lampiran aset',
        children: 'Daftar aset',
    };
    const local = renderToStaticMarkup(h(FactBox, props));
    assert.match(local, /data-slot="fact-box-controls"/);
    assert.match(local, /Sembunyikan detail dan lampiran/);
    const external = renderToStaticMarkup(
        h(FactBox, { ...props, toolbarContainer: null }),
    );
    assert.doesNotMatch(external, /data-slot="fact-box-controls"/);
    assert.match(external, /Detail aset/);
    assert.match(external, /Daftar aset/);
});
