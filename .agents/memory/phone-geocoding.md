---
name: Phone geocoding library quirks
description: Behaviors of libphonenumber-geo-carrier + all-the-cities used for call map plotting
---
- `libphonenumber-geo-carrier`'s `geocoder()` is async and often returns REGION names, not cities: Canadian landlines → "Ontario"/"Quebec", rural US area codes → "Kansas"/"Washington State", mobiles/toll-free in most non-NANP countries → null.
- **Why:** naive city-name matching against a gazetteer silently falls through to country-level for all of Canada and much of the US.
- **How to apply:** keep a region-name → geonames adminCode map (US states, CA provinces use numeric codes like Ontario=08) and scatter within the region; treat null as country-level and pick a population-weighted city deterministically (hash of number) so dots never pile at a country's center.
- 555 test prefixes (e.g. +1206555xxxx) geocode to state level only, so demo numbers show "(approx)" labels — real numbers resolve to cities.
- `all-the-cities` has no TS types (use @ts-ignore) and tiny territories (e.g. Guernsey) have no city ≥50k population — need a threshold-free fallback.
