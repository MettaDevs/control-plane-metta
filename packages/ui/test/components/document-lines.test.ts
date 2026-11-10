import { test } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    DocumentLines,
    shouldAdvanceDocumentLine,
} from '../../src/components/document-lines.tsx';
import { FormControl } from '../../src/components/form-control.tsx';
import { Input } from '../../src/components/input.tsx';

type Line = { id: string; description: string };

test('Enter advances a document line only from a plain editable field', () => {
    const enter = {
        key: 'Enter',
        defaultPrevented: false,
        isComposing: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
    };
    const field = {
        type: 'text',
        readOnly: false,
        expanded: false,
        combobox: false,
        calendar: false,
    };
    assert.equal(shouldAdvanceDocumentLine(enter, field), true);

    for (const modifier of [
        'altKey',
        'ctrlKey',
        'metaKey',
        'shiftKey',
        'isComposing',
        'defaultPrevented',
    ]) {
        assert.equal(
            shouldAdvanceDocumentLine({ ...enter, [modifier]: true }, field),
            false,
            modifier,
        );
    }

    for (const state of ['readOnly', 'expanded', 'combobox', 'calendar']) {
        assert.equal(
            shouldAdvanceDocumentLine(enter, { ...field, [state]: true }),
            false,
            state,
        );
    }

    for (const type of [
        'date',
        'checkbox',
        'radio',
        'file',
        'button',
        'submit',
    ]) {
        assert.equal(
            shouldAdvanceDocumentLine(enter, { ...field, type }),
            false,
            type,
        );
    }
});

test('DocumentLines SSR: compact labels, accessible row names, required fields, grouped controls, selection, add cells and footer', () => {
    const h = React.createElement;
    const html = renderToStaticMarkup(
        h(DocumentLines<Line>, {
            title: 'Rincian aset',
            columns: [
                {
                    id: 'description',
                    header: 'Spesifikasi',
                    required: true,
                    content: 'control',
                    cell: (row) =>
                        h(FormControl, {
                            error: 'Isi spesifikasi',
                            children: h(Input, {
                                label: 'Spesifikasi',
                                required: true,
                                defaultValue: row.description,
                            }),
                        }),
                },
                {
                    id: 'group',
                    header: 'Rincian',
                    cellMode: 'form',
                    content: 'control',
                    cell: () => h(Input, { label: 'Detail tambahan' }),
                },
            ],
            data: [
                { id: 'first', description: 'Komputer' },
                { id: 'second', description: 'Meja' },
            ],
            getRowKey: (row) => row.id,
            onAddRow: () => {},
            onDeleteRows: () => {},
            footer: h('div', null, 'Total Rp 0'),
            selection: {
                selectedKeys: ['second'],
                onSelectedKeysChange: () => {},
            },
        }),
    );
    assert.match(html, /aria-label="Spesifikasi, baris 1"/);
    assert.match(html, /aria-label="Spesifikasi, baris 2"/);
    assert.doesNotMatch(html, /<label[^>]*>Spesifikasi/);
    assert.match(html, /<label[^>]*>Detail tambahan/);
    assert.match(html, /data-document-cell=""/);
    assert.match(html, /required=""/);
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /aria-describedby="[^"]+"/);
    assert.match(html, /Isi spesifikasi/);
    assert.match(html, /aria-label="Tambah baris pada Spesifikasi"/);
    assert.match(html, /data-slot="document-lines-footer"/);
    assert.match(html, /Total Rp 0/);
    assert.match(html, /aria-label="Buka mode fokus Rincian aset"/);
    assert.match(html, /aria-checked="true"/);
    const ordinary = renderToStaticMarkup(
        h(Input, { label: 'Di luar tabel', required: true }),
    );
    assert.match(ordinary, /<label[^>]*>Di luar tabel/);
});
