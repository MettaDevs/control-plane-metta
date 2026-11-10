import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { useRecordNavigation } from '../../src/components/use-record-navigation.ts';

type Item = { id: string };
type Options = Partial<Parameters<typeof useRecordNavigation<Item>>[0]>;

function navigation(options: Options = {}) {
    const visits: string[] = [];
    let requests = 0;
    let result: ReturnType<typeof useRecordNavigation<Item>> | undefined;
    function Probe() {
        result = useRecordNavigation<Item>({
            items: [{ id: 'c' }, { id: 'a' }, { id: 'b' }],
            currentId: 'a',
            getId: (item) => item.id,
            onNavigate: (id) => visits.push(id),
            scopeKey: 'filtered:name-desc',
            loadMore: () => {
                requests++;
            },
            ...options,
        });

        return null;
    }
    renderToString(createElement(Probe));

    return { result: result!, visits, requests: () => requests };
}

test('record navigation: filtered order, batch boundary, unknown record, loading and draft guards', () => {
    const middle = navigation();
    assert.equal(middle.result.previousDisabled, false);
    assert.equal(middle.result.nextDisabled, false);
    middle.result.previous!();
    middle.result.next!();
    assert.deepEqual(middle.visits, ['c', 'b']);
    const first = navigation({ currentId: 'c' });
    assert.equal(first.result.previousDisabled, true);
    first.result.previous!();
    assert.deepEqual(first.visits, []);
    const last = navigation({ currentId: 'b', hasMore: true });
    assert.equal(last.result.nextDisabled, false);
    last.result.next!();
    last.result.next!();
    assert.equal(last.requests(), 1);
    assert.deepEqual(last.visits, []);

    const failedBatch = navigation({
        currentId: 'b',
        hasMore: true,
        loadMore: () => false,
    });
    failedBatch.result.next!();
    failedBatch.result.previous!();
    assert.deepEqual(failedBatch.visits, ['a']);

    for (const options of [
        { disabled: true },
        { loading: true },
        { currentId: 'outside-filter' },
        { currentId: null },
    ]) {
        const blocked = navigation(options);
        assert.equal(blocked.result.previousDisabled, true);
        assert.equal(blocked.result.nextDisabled, true);
        blocked.result.previous!();
        blocked.result.next!();
        assert.deepEqual(blocked.visits, []);
        assert.equal(blocked.requests(), 0);
    }

    assert.equal(
        navigation({ currentId: 'b', hasMore: false }).result.nextDisabled,
        true,
    );
});
