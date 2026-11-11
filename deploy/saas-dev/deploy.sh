#!/bin/sh
# Deploy SaaS dev di server dev1 dalam satu perintah, dari laptop:
#
#   ssh dev1 'sudo /opt/metta-saas-dev/deploy.sh'                  # main kedua repo
#   ssh dev1 'sudo /opt/metta-saas-dev/deploy.sh <ref-cp> <ref-ops>'  # branch, tag, atau commit tertentu
#
# Mengunduh source kedua repo publik pada commit yang diminta, membangun image bertag 7 karakter commit, memasang
# compose.yaml dan skrip ini dari commit control-plane yang sama, menjalankan migration database pusat dan database
# runtime dari image (bukan dari source), menyalakan ulang semua proses, lalu memeriksa setiap alamat publik. Database
# lingkungan klinik tidak dimigrasi di sini; itu operasi migrate per lingkungan dari konsol.
set -eu

dir=/opt/metta-saas-dev
cp_ref=${1:-main}
ops_ref=${2:-main}
cd "$dir"

# Commit penuh dari nama ref, lewat API GitHub tanpa token (repo publik).
resolve() {
    curl -fsSL "https://api.github.com/repos/MettaDevs/$1/commits/$2" |
        python3 -c 'import json, sys; print(json.load(sys.stdin)["sha"])'
}

# Source satu repo pada commit itu, di src/<folder>. Salinan lama dibuang; folder ini hanya bahan build.
unpack() {
    rm -rf "src/$2"
    mkdir -p "src/$2"
    curl -fsSL "https://codeload.github.com/MettaDevs/$1/tar.gz/$3" | tar -xz -C "src/$2" --strip-components=1
}

cp_sha=$(resolve control-plane-metta "$cp_ref")
ops_sha=$(resolve operations-metta "$ops_ref")
cp_tag=$(printf %.7s "$cp_sha")
ops_tag=$(printf %.7s "$ops_sha")
echo "control-plane-metta $cp_ref = $cp_tag, operations-metta $ops_ref = $ops_tag"

unpack control-plane-metta control-plane "$cp_sha"
unpack operations-metta operations "$ops_sha"

docker build -q -t "metta-saas-dev/control-plane:$cp_tag" src/control-plane >/dev/null
docker build -q --build-arg "RELEASE=$(printf %s "$ops_ref" | tr / -)-$ops_tag" -t "metta-saas-dev/operations:$ops_tag" src/operations >/dev/null
echo "image dibangun"

install -m 644 src/control-plane/deploy/saas-dev/compose.yaml compose.yaml
install -m 755 src/control-plane/deploy/saas-dev/deploy.sh deploy.sh
printf 'CP_TAG=%s\nOPS_TAG=%s\n' "$cp_tag" "$ops_tag" >.env

docker compose up -d --wait cp-db ops-db
docker compose run --rm --no-deps cp-console bun dist/migrate.js
docker compose run --rm --no-deps ops-app bun dist/migrate.js
docker compose up -d --remove-orphans

# Alamat publik lewat Cloudflare dan Traefik. Proses baru butuh beberapa detik sebelum menjawab.
failed=0
for url in https://console.mettadev.my.id/login https://agent.mettadev.my.id/up https://portal.mettadev.my.id/login; do
    code=000
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        code=$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)
        [ "$code" = 200 ] && break
        sleep 2
    done
    echo "$code $url"
    [ "$code" = 200 ] || failed=1
done
docker compose logs --since 1m ops-worker 2>&1 | grep -E '"event":"(worker-started|host-reported|host-report-error)"' | tail -2
[ "$failed" = 0 ] && echo "deploy selesai: control-plane $cp_tag, operations $ops_tag" || {
    echo "deploy selesai, tetapi ada alamat yang tidak menjawab 200" >&2
    exit 1
}
