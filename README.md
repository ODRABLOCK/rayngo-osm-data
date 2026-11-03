# RAYNGO OSM data

Public, route-independent OpenStreetMap extracts for the RAYNGO route preview.
The public HTTPS feed starts at [manifest.json](https://odrablock.github.io/rayngo-osm-data/manifest.json).
Data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
available under the Open Database License (ODbL). The source is the [QLever OSM index](https://qlever.dev/osm-planet).

The extraction covers the geographic box 35–72° N, 25° W–45° E. It includes camera
nodes tagged `highway=speed_camera` and directional average-speed relations with
unambiguous endpoints and connected mapped section ways. Coverage and real-world
operating status are not guaranteed.

GitHub Actions rebuilds the extract Mondays at 04:17 UTC and deploys the dataset and
manifest in one Pages artifact. A failed export skips deployment. An existing
installation keeps its last verified data on failed download or validation.
After each successful deployment, `last-success.json` records the published version
in the repository.

Run locally with Node.js 24: `node export.mjs /tmp/rayngo-osm-output`.
The feed manifest has schema 1, a monotonic UTC timestamp version, bytes and SHA-256.
The payload is named `osm-enforcement-<version>.json` beside the manifest.
