import { createHash } from "node:crypto";

const MAX_DATA_BYTES = 12 * 1024 * 1024;
const manifest = new URL(process.argv[2] ?? "https://odrablock.github.io/rayngo-osm-data/manifest.json");
if (manifest.protocol !== "https:" || manifest.username || manifest.password ||
    manifest.search || manifest.hash || !manifest.pathname.endsWith("/manifest.json")) {
    throw new Error("Provide a direct HTTPS manifest.json URL");
}

async function download(url, limit) {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (response.status !== 200 || response.url !== url.href) {
        throw new Error(`${url.href}: HTTP ${response.status}, final URL ${response.url}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error(`${url.href}: exceeds ${limit} bytes`);
    return bytes;
}

const info = JSON.parse((await download(manifest, 4096)).toString("utf8"));
if (info.schema !== 1 || !Number.isSafeInteger(info.version) || info.version <= 2026110300 ||
    !Number.isSafeInteger(info.bytes) || info.bytes < 1 || info.bytes > MAX_DATA_BYTES ||
    typeof info.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(info.sha256)) {
    throw new Error("Invalid manifest fields");
}
const dataUrl = new URL(`osm-enforcement-${info.version}.json`, manifest);
const bytes = await download(dataUrl, MAX_DATA_BYTES);
const digest = createHash("sha256").update(bytes).digest("hex");
if (bytes.length !== info.bytes || digest !== info.sha256) throw new Error("Length or SHA-256 mismatch");

const data = JSON.parse(bytes.toString("utf8"));
if (typeof data.sourceDate !== "string" || !data.sourceDate.trim() ||
    !Array.isArray(data.regions) || !data.regions.length ||
    data.regions.some(region => typeof region !== "string" || !region.trim()) ||
    !Array.isArray(data.entries) || data.entries.length > 150_000) {
    throw new Error("Invalid RAYNGO data metadata");
}
let cameras = 0;
let sections = 0;
for (const row of data.entries) {
    if (!Array.isArray(row) || !Number.isSafeInteger(row[0]) || row[0] <= 0 ||
        !Array.isArray(row[1]) || row[1].length < 1 || row[1].length > 10_000) {
        throw new Error("Invalid RAYNGO entry");
    }
    if (row[1].length === 1) cameras++; else sections++;
    for (const point of row[1]) {
        if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) ||
            !Number.isFinite(point[1]) || point[0] < -90 || point[0] > 90 ||
            point[1] < -180 || point[1] > 180) {
            throw new Error("Invalid RAYNGO coordinate");
        }
    }
}
if (cameras < 30_000 || sections < 500) throw new Error("Incomplete extract");
console.log(JSON.stringify({ manifest: manifest.href, version: info.version, bytes: bytes.length,
    sha256: digest, cameras, sections, sourceDate: data.sourceDate }, null, 2));
