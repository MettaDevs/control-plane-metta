import { test } from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MasterDetailLayout } from '../../src/components/master-detail-layout.tsx';

test('master-detail: both panes retained, plain divider, server rendering, independent panel IDs, and back action', () => {
    const layout = (detailOpen: boolean) =>
        React.createElement(
            MasterDetailLayout,
            {
                detailOpen,
                onDetailOpenChange: () => {},
                list: React.createElement('input', {
                    'data-probe': 'list-search',
                    defaultValue: 'search retained',
                }),
            },
            React.createElement('textarea', {
                'data-probe': 'detail-draft',
                defaultValue: 'draft retained',
            }),
        );

    for (const open of [false, true]) {
        const html = renderToStaticMarkup(layout(open));
        assert.match(html, /data-probe="list-search"/);
        assert.match(html, /data-probe="detail-draft"/);
        assert.match(html, /draft retained/);
        assert.match(html, /data-slot="resizable-handle"/);
        assert.doesNotMatch(html, /lucide-grip-vertical/);
        assert.equal(html.includes('>Daftar</button>'), open);
    }

    const together = renderToStaticMarkup(
        React.createElement(React.Fragment, null, layout(false), layout(true)),
    );
    const ids = [...together.matchAll(/ id="([^"]+)"/g)].map(
        (match) => match[1],
    );
    assert.equal(
        new Set(ids).size,
        ids.length,
        'Two master-detail instances must not share panel IDs.',
    );
});
