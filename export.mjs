import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const endpoint = "https://qlever.dev/api/osm-planet";
const prefixes = `PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX osmrel: <https://www.openstreetmap.org/relation/>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>`;
async function bindings(query, fixture) {
    if (fixture) return JSON.parse(await readFile(fixture, "utf8")).results.bindings;
    const url = new URL(endpoint);
    url.searchParams.set("query", prefixes + "\n" + query);
    const response = await fetch(url, {
        headers: {
            Accept: "application/sparql-results+json",
            "User-Agent": "RAYNGO-OSM-export/1.0 (https://github.com/ODRABLOCK/rayngo-osm-data)"
        },
        signal: AbortSignal.timeout(120_000)
    });
    if (!response.ok) throw new Error(`QLever HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return (await response.json()).results.bindings;
}

const [cameras, relations] = await Promise.all([
    bindings('SELECT ?n ?wkt WHERE { ?n osmkey:highway "speed_camera"; geo:hasGeometry/geo:asWKT ?wkt . }',
        process.env.RAYNGO_CAMERA_FIXTURE),
    bindings(`SELECT ?r ?role ?id ?wkt WHERE {
        ?r osmkey:type "enforcement"; osmkey:enforcement "average_speed"; osmrel:member ?m .
        ?m osmrel:member_role ?role; osmrel:member_id ?id .
        VALUES ?role { "from" "to" "section" }
        ?id geo:hasGeometry/geo:asWKT ?wkt .
    }`, process.env.RAYNGO_SECTION_FIXTURE)
]);
const inArea = ([lat, lon]) => lat >= 35 && lat <= 72 && lon >= -25 && lon <= 45;
const osmId = value => Number(value.slice(value.lastIndexOf("/") + 1));
function geometry(wkt, type) {
    const match = wkt.match(new RegExp("^" + type + "\\s*\\(([^()]+)\\)$"));
    if (!match) return [];
    return match[1].split(",").map(pair => pair.trim().split(/\s+/).slice(0, 2).map(Number).reverse());
}
const byRelation = new Map();
for (const {r, role, id, wkt} of relations) {
    const key = osmId(r.value);
    if (!byRelation.has(key)) byRelation.set(key, []);
    byRelation.get(key).push({role: role.value, id: id.value, wkt: wkt.value});
}
const pointEntries = new Map();
for (const {n, wkt} of cameras) {
    if (!n.value.includes("/node/")) continue;
    const points = geometry(wkt.value, "POINT");
    if (points.length === 1 && inArea(points[0])) pointEntries.set(osmId(n.value), points);
}
const equal = (a, b) => a && b && Math.abs(a[0]-b[0]) <= 0.0000011 && Math.abs(a[1]-b[1]) <= 0.0000011;
const sectionEntries = new Map();
for (const [id, members] of byRelation) {
    const from = members.filter(m => m.role === "from");
    const to = members.filter(m => m.role === "to");
    if (from.length !== 1 || to.length !== 1) continue;
    const start = geometry(from[0].wkt, "POINT")[0];
    const end = geometry(to[0].wkt, "POINT")[0];
    if (!start || !end || !inArea(start) || !inArea(end) || equal(start,end)) continue;
    const remaining = members.filter(m => m.role === "section" && m.id.includes("/way/"))
        .map(m => geometry(m.wkt, "LINESTRING"));
    if (!remaining.length || remaining.some(points => points.length < 2)) continue;
    const chain = [start];
    while (remaining.length && !equal(chain.at(-1), end)) {
        const matches = remaining.map((line, index) => ({line,index})).filter(({line}) =>
            equal(line[0],chain.at(-1)) || equal(line.at(-1),chain.at(-1)));
        if (matches.length !== 1) break;
        const {line,index} = matches[0];
        remaining.splice(index,1);
        if (!equal(line[0],chain.at(-1))) line.reverse();
        chain.push(...line.slice(1));
    }
    if (!remaining.length && equal(chain.at(-1),end) && chain.every(inArea)) sectionEntries.set(id,chain);
}

if (pointEntries.size < 30000 || sectionEntries.size < 500) {
    throw new Error(`Incomplete export: ${pointEntries.size} camera nodes and ${sectionEntries.size} sections`);
}
const now = new Date();
const version = Number(now.toISOString().slice(0,19).replace(/\D/g,""));
const date = now.toISOString().slice(0,10);
const sorted = map => [...map].sort((a,b) => a[0]-b[0]);
const data = Buffer.from(JSON.stringify({
    sourceDate: date + " (Abruf, UTC)",
    regions: ["Deutschland und europäischer Kartenausschnitt (35–72° N, 25° W–45° O)"],
    source: "https://qlever.dev/osm-planet",
    license: "https://www.openstreetmap.org/copyright",
    entries: [...sorted(pointEntries), ...sorted(sectionEntries)]
}));
if (!Number.isSafeInteger(version) || version <= 2026110300 || data.length > 12 * 1024 * 1024) {
    throw new Error("Export exceeds app limits");
}
const output = process.argv[2] ?? "public";
await mkdir(output, { recursive: true });
await writeFile(join(output,`osm-enforcement-${version}.json`),data);
await writeFile(join(output,"manifest.json"),JSON.stringify({
    schema: 1, version, bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex")
}) + "\n");
await writeFile(join(output,"index.html"),
    '<!doctype html><meta charset="utf-8"><title>RAYNGO OSM data</title><p>© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · ODbL</p><p><a href="manifest.json">Manifest</a></p>\n');
console.log(`Published candidate ${version}: ${pointEntries.size} camera nodes, ${sectionEntries.size} sections, ${data.length} bytes`);
