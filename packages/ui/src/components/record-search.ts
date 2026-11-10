export type RecordSearchField = string | { text: string; identifier?: boolean };
export type RecordSearchTerm = { phrase: boolean; text: string };
export const SEARCH_DEBOUNCE_MS = 250;
export const SEARCH_MAX_LENGTH = 200;

const normalize = (text: string) => text.normalize('NFC').toLowerCase();
const words = (text: string) => normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
const compactIdentifier = (text: string) =>
    normalize(text).replace(/[\s.-]+/gu, '');

/** Spasi memisahkan syarat AND; tanda kutip mempertahankan urutan kata satu field. */
export function recordSearchTerms(query: string): RecordSearchTerm[] {
    const terms: RecordSearchTerm[] = [];

    for (const match of query
        .normalize('NFC')
        .matchAll(/"([^"]*)"|([^\s"]+)/gu)) {
        const phrase = match[1] !== undefined;
        const text = (phrase ? match[1] : match[2])!.trim();

        if (words(text).length) {
            terms.push({ phrase, text });
        }
    }

    return terms;
}

function matchesField(
    term: RecordSearchTerm,
    field: RecordSearchField,
): boolean {
    const text = typeof field === 'string' ? field : field.text;
    const tokens = words(text);
    const sought = words(term.text);

    if (term.phrase) {
        const phraseMatches = tokens.some((_, start) =>
            sought.every((token, offset) => tokens[start + offset] === token),
        );

        return (
            phraseMatches ||
            (typeof field !== 'string' &&
                field.identifier === true &&
                compactIdentifier(text) === compactIdentifier(term.text))
        );
    }

    return (
        sought.every((prefix) =>
            tokens.some((token) => token.startsWith(prefix)),
        ) ||
        (typeof field !== 'string' &&
            field.identifier === true &&
            compactIdentifier(text).startsWith(compactIdentifier(term.text)))
    );
}

/** Matcher lokal SDK; resource server tetap dicocokkan oleh engine Core yang memakai kontrak sama. */
export function matchesRecordSearch(
    query: string,
    fields: RecordSearchField | readonly RecordSearchField[],
): boolean {
    if (!query.trim()) {
        return true;
    }

    const terms = recordSearchTerms(query);
    const values: readonly RecordSearchField[] =
        typeof fields === 'string'
            ? [fields]
            : 'text' in fields
              ? [fields]
              : fields;

    const compactQuery = compactIdentifier(query);
    const identifierMatch =
        !query.includes('"') &&
        /^[\p{L}\p{N}]+$/u.test(compactQuery) &&
        values.some(
            (field) =>
                typeof field !== 'string' &&
                field.identifier === true &&
                compactIdentifier(field.text).startsWith(compactQuery),
        );

    return (
        identifierMatch ||
        (terms.length > 0 &&
            terms.every((term) =>
                values.some((field) => matchesField(term, field)),
            ))
    );
}

/** Base UI menyediakan formatter label bila item berbentuk object. */
export function filterRecordSearchItem<T>(
    item: T,
    query: string,
    itemToString?: (item: T) => string,
): boolean {
    const label = itemToString
        ? itemToString(item)
        : typeof item === 'object' && item !== null && 'label' in item
          ? String(item.label)
          : String(item);

    return matchesRecordSearch(query, label);
}
