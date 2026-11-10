import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

// Hasil `bun run build` untuk peramban: berkas entry, stylesheet-nya, dan setiap berkas yang boleh disajikan dari
// folder build. Ditulis scripts/build.ts dan dibaca di sini, jadi bentuknya dijaga satu schema.
export const clientManifestSchema = z.object({
    script: z.string(),
    styles: z.array(z.string()),
    files: z.array(z.string()),
});
export type ClientManifest = z.infer<typeof clientManifestSchema>;

export const clientAssetPrefix = '/build/';

// Data hanya di bawah /api/. URL lain milik layar: navigasi peramban ke sana mendapat dokumen yang sama, lalu router
// di peramban yang memilih halamannya. Pengecualiannya alamat yang dibuka peramban tetapi dijawab server: /up untuk
// pemeriksaan hidup, dan /sso/... untuk upacara SSO. POST /login, /login/two-factor, dan /logout tetap jatuh ke oRPC
// karena bukan GET.
export function isServerPath(pathname: string): boolean {
    return (
        pathname === '/api' ||
        pathname.startsWith('/api/') ||
        pathname === '/up' ||
        pathname === '/sso' ||
        pathname.startsWith('/sso/')
    );
}

function documentHtml(manifest: ClientManifest): string {
    const styles = manifest.styles
        .map(
            (file) =>
                `<link rel="stylesheet" href="${clientAssetPrefix}${file}">`,
        )
        .join('');
    // Tema dipasang sebelum stylesheet dipakai, supaya mode gelap tidak berkedip terang dulu. Pilihannya disimpan
    // layar di localStorage `appearance`, sama dengan CoreERP.
    const theme = `<script>(function(){var a=null;try{a=localStorage.getItem('appearance')}catch(e){}if(a==='dark'||((a===null||a==='system')&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}})()</script>`;
    return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title></title>${theme}<style>html{background-color:hsl(210 30% 96%)}html.dark{background-color:oklch(0.145 0 0)}</style>${styles}<script type="module" src="${clientAssetPrefix}${manifest.script}"></script></head><body class="font-sans antialiased"><div id="app"></div></body></html>`;
}

type Build = {
    modified: number;
    manifest: ClientManifest;
    files: Set<string>;
    html: string;
};

// Berkas build peramban dan dokumen layar, dilayani sebelum sesi dan database dibuka: keduanya sama untuk setiap
// operator. Manifest dibaca ulang bila berubah, jadi `bun run dev` cukup membangun ulang tanpa menyalakan ulang server.
export function clientBuild(directory: string) {
    const manifestPath = join(directory, 'manifest.json');
    let cached: Build | null = null;

    async function current(): Promise<Build | null> {
        // stat setiap kali: BunFile menyimpan waktu ubah yang pertama kali dibacanya.
        const modified = await stat(manifestPath).then(
            (found) => found.mtimeMs,
            () => null,
        );
        if (modified === null) return null;
        if (cached?.modified !== modified) {
            const manifest = clientManifestSchema.parse(
                await Bun.file(manifestPath).json(),
            );
            cached = {
                modified,
                manifest,
                files: new Set(manifest.files),
                html: documentHtml(manifest),
            };
        }
        return cached;
    }

    return {
        // Jawaban untuk berkas build dan navigasi layar, atau null bila permintaan ini milik oRPC.
        async serve(request: Request): Promise<Response | null> {
            if (request.method !== 'GET' && request.method !== 'HEAD')
                return null;
            const { pathname } = new URL(request.url);
            if (isServerPath(pathname)) return null;
            const build = await current();
            if (pathname.startsWith(clientAssetPrefix)) {
                const name = decodeURIComponent(
                    pathname.slice(clientAssetPrefix.length),
                );
                // Hanya nama yang tercatat di manifest, jadi path tidak bisa keluar dari folder build.
                if (!build?.files.has(name))
                    return new Response('Not Found', { status: 404 });
                return new Response(Bun.file(join(directory, name)), {
                    headers: {
                        // Nama berkas memuat hash isinya, jadi isinya tidak pernah berubah.
                        'Cache-Control': 'public, max-age=31536000, immutable',
                    },
                });
            }
            if (!build)
                return new Response(
                    'Tampilan belum dibangun. Jalankan `bun run build` atau `bun run dev`.',
                    {
                        status: 503,
                        headers: {
                            'Content-Type': 'text/plain; charset=utf-8',
                        },
                    },
                );
            return new Response(build.html, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-cache, private',
                },
            });
        },
    };
}

export type ClientBuild = ReturnType<typeof clientBuild>;
