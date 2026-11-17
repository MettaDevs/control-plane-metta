import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import ts from 'typescript';

// Customer membeli Praktik Dokter, Finance saja, atau ERP utuh, jadi teks yang dibaca orang tidak menyebut klinik.
// Konsol menyebutnya tenant, portal menyebutnya organisasi. Yang diperiksa hanya teks: string dan teks JSX, bukan
// komentar, nama, atau data test.
const src = join(import.meta.dir, '..', 'src');

function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return files(path);
        return /\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

const textKinds = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.JsxText,
]);

function texts(path: string): { line: number; text: string }[] {
    const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const found: { line: number; text: string }[] = [];
    const visit = (node: ts.Node) => {
        if (textKinds.has(node.kind))
            found.push({
                line:
                    source.getLineAndCharacterOfPosition(node.getStart()).line +
                    1,
                text: (node as ts.LiteralLikeNode).text,
            });
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

// Kunci seperti 'tenant_id' bukan kalimat; yang dicari hanya teks berspasi di berkas portal.
const isPortal = (path: string) => basename(path).includes('.portal.');

test('teks yang dibaca orang tidak menyebut klinik, dan portal tidak menyebut tenant', () => {
    const violations = files(src).flatMap((path) =>
        texts(path)
            .filter(
                ({ text }) =>
                    /klinik/i.test(text) ||
                    (isPortal(path) &&
                        /\s/.test(text.trim()) &&
                        /\btenant\b/i.test(text)),
            )
            .map(
                ({ line, text }) =>
                    `${relative(src, path)}:${String(line)} ${text.trim()}`,
            ),
    );
    expect(violations).toEqual([]);
});
