import { $ } from 'bun';
import { statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

type Worktree = { path: string; branch: string | null };
type Verdict =
    { kind: 'remove'; branch: string } | { kind: 'keep'; reason: string };
type PullRequest = {
    number: number;
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    headRefOid: string;
};

const dryRun = process.argv.includes('--dry-run');

function parse(porcelain: string): Worktree[] {
    return porcelain
        .trim()
        .split(/\n\n+/)
        .map((block) => {
            const lines = block.split('\n');
            const path =
                lines
                    .find((line) => line.startsWith('worktree '))
                    ?.slice('worktree '.length) ?? '';
            const ref = lines
                .find((line) => line.startsWith('branch '))
                ?.slice('branch '.length);
            return {
                path,
                branch: ref ? ref.replace('refs/heads/', '') : null,
            };
        });
}

async function verdict(worktree: Worktree): Promise<Verdict> {
    if (worktree.branch === null) {
        return { kind: 'keep', reason: 'tidak sedang di branch mana pun' };
    }
    const dirty = await $`git -C ${worktree.path} status --porcelain`.text();
    if (dirty.trim() !== '') {
        return {
            kind: 'keep',
            reason: 'masih ada perubahan yang belum di-commit',
        };
    }
    const inMain =
        await $`git -C ${worktree.path} merge-base --is-ancestor HEAD origin/main`
            .nothrow()
            .quiet();
    if (inMain.exitCode === 0) {
        // Worktree yang baru dibuat dari main juga lolos pemeriksaan ini, jadi ia dihapus hanya sesudah
        // HEAD-nya tidak bergerak sehari penuh. Sesi yang selesai menghapus worktree-nya sendiri.
        const head = (
            await $`git -C ${worktree.path} rev-parse --git-path HEAD`.text()
        ).trim();
        const idleHours =
            (Date.now() - statSync(resolve(worktree.path, head)).mtimeMs) /
            3_600_000;
        if (idleHours < 24) {
            return {
                kind: 'keep',
                reason: 'sudah masuk main; dihapus otomatis sesudah 24 jam tanpa perubahan',
            };
        }
        return { kind: 'remove', branch: worktree.branch };
    }
    const pulls: PullRequest[] =
        await $`gh pr list --head ${worktree.branch} --state all --json number,state,headRefOid --limit 1`.json();
    const pull = pulls[0];
    if (pull === undefined) {
        return { kind: 'keep', reason: 'belum masuk main' };
    }
    switch (pull.state) {
        case 'OPEN':
            return { kind: 'keep', reason: `PR #${pull.number} masih terbuka` };
        case 'MERGED':
        case 'CLOSED': {
            // Dibandingkan dengan commit terakhir PR, bukan upstream: upstream bisa hilang saat branch remote
            // dihapus sesudah merge, dan branch dari origin/main melacak main, bukan dirinya sendiri.
            const head = await $`git -C ${worktree.path} rev-parse HEAD`.text();
            if (head.trim() !== pull.headRefOid) {
                return {
                    kind: 'keep',
                    reason: `ada commit sesudah PR #${pull.number}`,
                };
            }
            return { kind: 'remove', branch: worktree.branch };
        }
        default: {
            const unknown: never = pull.state;
            throw new Error(`Status PR tidak dikenal: ${unknown}`);
        }
    }
}

const worktrees = parse(await $`git worktree list --porcelain`.text());
const [main, ...others] = worktrees;
if (main === undefined) {
    throw new Error('git worktree list tidak memulangkan apa pun.');
}
const root = resolve(main.path, '.worktrees') + sep;
const staleDays = 7;

// Worktree yang dibiarkan ikut dilaporkan jaraknya dari main, supaya pekerjaan yang lupa di-merge terlihat
// sebelum konfliknya menumpuk.
async function drift(worktree: Worktree): Promise<string> {
    const behind = (
        await $`git -C ${worktree.path} rev-list --count HEAD..origin/main`.text()
    ).trim();
    const committed = Number(
        (await $`git -C ${worktree.path} log -1 --format=%ct`.text()).trim(),
    );
    const days = Math.floor((Date.now() / 1000 - committed) / 86400);
    const stale = days >= staleDays ? ' LAMA' : '';
    return `tertinggal ${behind} commit dari main, commit terakhir ${days} hari lalu${stale}`;
}

await $`git fetch --quiet --prune origin`;
for (const worktree of others) {
    if (!resolve(worktree.path).startsWith(root)) {
        continue;
    }
    const name = relative(main.path, worktree.path);
    const result = await verdict(worktree);
    switch (result.kind) {
        case 'keep':
            console.log(
                `tetap    ${name}: ${result.reason} (${await drift(worktree)})`,
            );
            break;
        case 'remove':
            if (dryRun) {
                console.log(`dihapus  ${name} (dry run, tidak diubah)`);
                break;
            }
            await $`git worktree remove ${worktree.path}`;
            await $`git branch -D ${result.branch}`.quiet();
            console.log(`dihapus  ${name} dan branch ${result.branch}`);
            break;
        default: {
            const unknown: never = result;
            throw new Error(
                `Keputusan tidak dikenal: ${JSON.stringify(unknown)}`,
            );
        }
    }
}
await $`git worktree prune`;
