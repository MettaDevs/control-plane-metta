import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(import.meta.dir, 'check-boundaries.ts');
const roots: string[] = [];

function check(tree: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'boundaries-'));
    roots.push(root);
    for (const [path, text] of Object.entries(tree)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }
    const result = Bun.spawnSync(['bun', script, root]);
    return { code: result.exitCode, output: result.stderr.toString() };
}

afterEach(() => {
    for (const root of roots.splice(0))
        rmSync(root, { recursive: true, force: true });
});

const sites = {
    'src/sites/index.ts': `export * from './site/site.service.ts';`,
    'src/sites/index.console.ts': `export * from './site/site.console.routes.ts';`,
    'src/sites/index.agent.ts': `export * from './site/site.agent.routes.ts';`,
    'src/sites/site/site.service.ts': `export const site = 1;`,
    'src/sites/site/site.console.routes.ts': `import './site.service.ts';`,
    'src/sites/site/site.agent.routes.ts': `import './site.service.ts';`,
};

describe('check-boundaries', () => {
    test('accepts processes that load their own audience through doors', () => {
        const result = check({
            ...sites,
            'src/console.ts': `import './sites/index.console.ts'; import './sites/index.ts';`,
            'src/agent.ts': `import './sites/index.agent.ts';`,
            'src/console.test.ts': `import './console.ts';`,
        });
        expect(result.output).toBe('');
        expect(result.code).toBe(0);
    });

    test('rejects console routes reaching the agent process through a door', () => {
        const result = check({
            ...sites,
            'src/sites/index.ts': `export * from './site/site.service.ts'; export * from './site/site.console.routes.ts';`,
            'src/agent.ts': `import './sites/index.ts';`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'src/agent.ts loads src/sites/site/site.console.routes.ts; the agent process loads only agent files.',
        );
    });

    test('rejects imports that skip a door', () => {
        const result = check({
            ...sites,
            'src/platform/http/index.ts': `export * from './serve.ts';`,
            'src/platform/http/serve.ts': `export const serve = 1;`,
            'src/customers/index.ts': `import '../platform/http/serve.ts'; import '../sites/site/site.service.ts';`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'src/customers/index.ts:1 imports src/platform/http/serve.ts; outside src/platform/http/ import only its index.ts or index.<audience>.ts.',
        );
        expect(result.output).toContain(
            'src/customers/index.ts:1 imports src/sites/site/site.service.ts; outside src/sites/ import only its index.ts or index.<audience>.ts.',
        );
    });

    test('rejects one audience importing another', () => {
        const result = check({
            ...sites,
            'src/sites/site/site.agent.routes.ts': `import './site.console.routes.ts';`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'agent files must not import console files.',
        );
    });

    test('rejects a process without an audience loading routes', () => {
        const result = check({
            ...sites,
            'src/worker.ts': `import './sites/index.agent.ts';`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'src/worker.ts loads src/sites/index.agent.ts; a process without an audience loads no audience files.',
        );
    });

    test('rejects code that imports a process file', () => {
        const result = check({
            ...sites,
            'src/console.ts': `export const router = 1;`,
            'src/sites/site/site.service.ts': `import '../../console.ts';`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'only tests may import a process file.',
        );
    });
});
