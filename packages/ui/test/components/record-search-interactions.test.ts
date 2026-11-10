import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('Select, remote bypass, InlineLookup data, and command palette share record search in jsdom', () => {
    runScenario('record-search-interactions');
}, 30_000);
