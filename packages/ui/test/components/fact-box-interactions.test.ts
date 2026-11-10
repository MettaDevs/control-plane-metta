import { test } from 'bun:test';
import { runScenario } from '../support/scenario.ts';

test('FactBox, ribbon, filter pane, search, and title hint interactions in jsdom', () => {
    runScenario('fact-box-interactions');
}, 30_000);
