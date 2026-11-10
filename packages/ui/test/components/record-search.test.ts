import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    filterRecordSearchItem,
    matchesRecordSearch,
    recordSearchTerms,
    SEARCH_DEBOUNCE_MS,
    SEARCH_MAX_LENGTH,
    type RecordSearchField,
} from '../../src/components/record-search.ts';

type Fixture = {
    name: string;
    query: string;
    fields: RecordSearchField[];
    matches: boolean;
};

test('record search: shared matching fixtures, tolerant query parsing, and label adapters', () => {
    const fixtures = JSON.parse(
        readFileSync(
            new URL('../support/record-search.json', import.meta.url),
            'utf8',
        ),
    ) as Fixture[];
    assert.ok(fixtures.length > 0);

    for (const fixture of fixtures) {
        assert.equal(
            matchesRecordSearch(fixture.query, fixture.fields),
            fixture.matches,
            fixture.name,
        );
    }

    assert.equal(SEARCH_DEBOUNCE_MS, 250);
    assert.equal(SEARCH_MAX_LENGTH, 200);
    assert.deepEqual(recordSearchTerms('sur "jaya abadi" "open tail'), [
        { phrase: false, text: 'sur' },
        { phrase: true, text: 'jaya abadi' },
        { phrase: false, text: 'open' },
        { phrase: false, text: 'tail' },
    ]);
    assert.equal(
        filterRecordSearchItem(
            { label: 'Surya Jaya', value: 'opaque' },
            'ja sur',
        ),
        true,
    );
    assert.equal(
        filterRecordSearchItem(
            { caption: 'Surya Jaya' },
            'ja sur',
            (item) => item.caption,
        ),
        true,
    );
    assert.equal(filterRecordSearchItem('Surya Jaya', 'urya'), false);
});
