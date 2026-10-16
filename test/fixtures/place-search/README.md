# Saved answers for place search

Used by `test/place-search.test.js`, so the tests never call the real
services.

Real answers, saved on 16 Oct 2026:

- `open-meteo-*.json` (Open-Meteo, no key)
- `nominatim-*.json` (Nominatim, no key)
- `photon-*.json` (Photon, no key)

Written by hand from each service's documentation, because a key is needed
to get a real one and none was available while this was built. The shapes
follow the documentation; the values are close to real but not copied from
a real answer:

- `geonames-*.json`
- `locationiq-*.json`
- `geoapify-*.json`
- `geocode-maps-co-*.json`

When a real key is at hand, replace these with real answers.
