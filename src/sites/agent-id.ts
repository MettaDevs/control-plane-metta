// Agen yang sudah terpasang mengenal id dalam bentuk ULID: ia menyimpan site_id ULID dari pendaftaran di CoreERP, dan
// operasi install menolak tenant_id yang bukan ULID. Database di sini menyimpan uuid dengan nilai 128 bit yang sama
// (pemetaan yang sama dengan 0002_ids_to_uuid.sql operations-metta), jadi API agen menerjemahkan di batasnya: keluar
// sebagai ULID, masuk sebagai ULID atau uuid.
const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toAgentId(uuid: string): string {
    let number = BigInt(`0x${uuid.replaceAll('-', '')}`);
    let ulid = '';
    for (let index = 0; index < 26; index++) {
        ulid = crockford[Number(number & 31n)] + ulid;
        number >>= 5n;
    }
    return ulid;
}

// uuid huruf kecil untuk id agen yang sah, atau null.
export function fromAgentId(value: string): string | null {
    if (uuidPattern.test(value)) return value.toLowerCase();
    if (!ulidPattern.test(value)) return null;
    let number = 0n;
    for (const character of value.toUpperCase())
        number = number * 32n + BigInt(crockford.indexOf(character));
    const hex = number.toString(16).padStart(32, '0');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
