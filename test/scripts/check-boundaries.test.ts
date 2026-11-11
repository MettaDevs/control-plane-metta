import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(
    import.meta.dir,
    '..',
    '..',
    'scripts',
    'check-boundaries.ts',
);
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
            'test/console.test.ts': `import '../src/console.ts';`,
            'test/sites/site/site.service.test.ts': `import '../../../src/sites/site/site.service.ts';`,
            'test/support/provider.ts': `export const provider = 1;`,
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

    test('rejects tests outside test/, orphan test folders, and code importing test/', async () => {
        const result = check({
            ...sites,
            'src/sites/site/site.service.test.ts': `import './site.service.ts';`,
            'scripts/tool.test.ts': `export {};`,
            'test/billing/invoice.test.ts': `export {};`,
            'test/support/provider.ts': `export const provider = 1;`,
            'src/sites/site/site.service.ts': `import '../../../test/support/provider.ts';`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'src/sites/site/site.service.test.ts; tests live under test/',
        );
        expect(result.output).toContain(
            'scripts/tool.test.ts; tests live under test/',
        );
        expect(result.output).toContain(
            'test/billing/invoice.test.ts; test/billing mirrors no folder.',
        );
        expect(result.output).toContain(
            'src/sites/site/site.service.ts imports test/support/provider.ts; code under src/ and scripts/ must not import test/.',
        );
    });

    const screens = {
        ...sites,
        'src/console.ts': `import './sites/index.console.ts'; export const router = 1;`,
        'src/client.tsx': `import './sites/site/site.console.page.tsx'; import './platform/shell/index.ts';`,
        'src/platform/shell/index.ts': `export * from './api.ts';`,
        'src/platform/shell/api.ts': `import type { router } from '../../console.ts';`,
        'src/sites/site/site.console.page.tsx': `import '../../platform/shell/index.ts';`,
        'src/portal.ts': `export const router = 1;`,
        'src/portal-client.tsx': `import './sites/site/site.portal.page.tsx'; import './platform/shell/index.portal.ts';`,
        'src/platform/shell/index.portal.ts': `export * from './api.portal.ts';`,
        'src/platform/shell/api.portal.ts': `import type { router } from '../../portal.ts';`,
        'src/sites/site/site.portal.page.tsx': `import '../../platform/shell/index.portal.ts';`,
    };

    test('accepts the browser entry loading pages and the shell taking only types from the server', () => {
        const result = check(screens);
        expect(result.output).toBe('');
        expect(result.code).toBe(0);
    });

    test('rejects pages imported outside the browser entry, and browser and server code mixing', () => {
        const result = check({
            ...screens,
            'src/platform/shell/api.ts': `import { router } from '../../console.ts';`,
            'src/sites/site/site.console.page.tsx': `import './site.service.ts'; import './other.console.page.tsx';`,
            'src/sites/site/other.console.page.tsx': `export {};`,
            'src/sites/site/site.service.ts': `import '../../platform/shell/index.ts';`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'src/platform/shell/api.ts:1 imports src/console.ts; only tests may import a process file.',
        );
        expect(result.output).toContain(
            'src/sites/site/site.console.page.tsx:1 imports src/sites/site/site.service.ts; browser code takes only types from server code (import type).',
        );
        expect(result.output).toContain(
            'src/sites/site/site.console.page.tsx:1 imports src/sites/site/other.console.page.tsx; only src/client.tsx and src/portal-client.tsx import pages',
        );
        expect(result.output).toContain(
            'src/sites/site/site.service.ts:1 imports src/platform/shell/index.ts; server code must not import browser code.',
        );
    });

    test('rejects agent pages reaching the console browser entry', () => {
        const result = check({
            ...screens,
            'src/client.tsx': `import './sites/site/site.agent.page.tsx';`,
            'src/sites/site/site.agent.page.tsx': `export {};`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'src/client.tsx loads src/sites/site/site.agent.page.tsx; the console process loads only console files.',
        );
    });

    test('rejects the portal browser entry loading code typed by the console process', () => {
        const result = check({
            ...screens,
            'src/sites/site/site.portal.page.tsx': `import '../../platform/shell/index.ts';`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'src/portal-client.tsx loads src/platform/shell/api.ts, which imports src/console.ts; the portal process does not load code typed by the console process.',
        );
    });

    test('rejects a package importing src/ or keeping tests outside its test/', () => {
        const result = check({
            ...sites,
            'packages/ui/src/components/button.tsx': `import '../../../../src/sites/index.ts';`,
            'packages/ui/src/components/button.test.ts': `export {};`,
            'packages/ui/test/widgets/widget.test.ts': `export {};`,
            'packages/ui/test/components/button.test.ts': `export {};`,
        });
        expect(result.code).toBe(1);
        expect(result.output).toContain(
            'packages/ui/src/components/button.tsx:1 imports src/sites/index.ts; packages/ must not import src/ or test/.',
        );
        expect(result.output).toContain(
            "packages/ui/src/components/button.test.ts; a package's tests live under its test/",
        );
        expect(result.output).toContain(
            'packages/ui/test/widgets/widget.test.ts; packages/ui/test/widgets mirrors no folder of packages/ui/src.',
        );
        expect(result.output).not.toContain(
            'packages/ui/test/components/button.test.ts;',
        );
    });
});
