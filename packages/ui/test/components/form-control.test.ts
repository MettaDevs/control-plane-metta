import { test } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormControl, FormGrid } from '../../src/components/form-control.tsx';
import { InlineLookup } from '../../src/components/inline-lookup.tsx';

type Vendor = { id: string; name: string };

test('FormControl: stable help slot, optional help hidden, errors visible, and non-submit help action', () => {
    const render = (
        props: Omit<React.ComponentProps<typeof FormControl>, 'children'>,
    ) =>
        renderToStaticMarkup(
            React.createElement(FormControl, {
                ...props,
                children: React.createElement('input', { name: 'value' }),
            }),
        );
    const plain = render({});
    assert.match(plain, /data-slot="form-control-help" aria-hidden="true"/);
    assert.doesNotMatch(plain, /<button/);
    const helped = render({
        hint: 'Bantuan opsional',
        error: 'Nilai belum valid',
    });
    assert.match(helped, /data-slot="form-control-help"/);
    assert.match(helped, /type="button"/);
    assert.match(helped, /role="alert"/);
    assert.match(helped, /Nilai belum valid/);
    assert.doesNotMatch(helped, /Bantuan opsional/);
    assert.equal((helped.match(/name="value"/g) ?? []).length, 1);
    // Atribut data-* tidak dikenal tipe props React di luar JSX, jadi props-nya disusun sebagai variabel.
    const plainControl = {
        key: 'plain',
        'data-field-name': 'plain',
        children: React.createElement('input'),
    };
    const grid = renderToStaticMarkup(
        React.createElement(FormGrid, {}, [
            React.createElement(FormControl, plainControl),
            React.createElement(FormControl, {
                key: 'helped',
                hint: 'Bantuan',
                children: React.createElement('input'),
            }),
        ]),
    );
    assert.match(grid, /data-slot="form-grid"/);
    assert.match(grid, /data-field-name="plain"/);
    assert.equal(
        (grid.match(/data-slot="form-control-help"/g) ?? []).length,
        2,
    );
});

test('InlineLookup keeps hidden combobox inputs out of the visual height', () => {
    const lookup = renderToStaticMarkup(
        React.createElement(InlineLookup<Vendor>, {
            label: 'Vendor',
            value: { id: 'one', name: 'Vendor pilihan' },
            columns: [
                { id: 'name', header: 'Nama', cell: (item) => item.name },
            ],
            getItemValue: (item) => item.id,
            getItemLabel: (item) => item.name,
            loadItems: async () => ({ items: [], nextCursor: null }),
            onValueChange: () => {},
        }),
    );
    assert.match(
        lookup,
        /<input[^>]*aria-hidden="true"/,
        'Base UI appends its hidden validation input beside the visible control',
    );
    assert.doesNotMatch(
        lookup,
        /space-y-2/,
        'Blanket sibling margins must not let hidden combobox inputs add visual height',
    );
});
