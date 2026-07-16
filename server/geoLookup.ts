import { parsePhoneNumberFromString, type PhoneNumber } from "libphonenumber-js";
import { geocoder } from "libphonenumber-geo-carrier";
// @ts-ignore - no type declarations shipped
import allCities from "all-the-cities";

interface Coords {
  lat: number;
  lng: number;
  name: string;
}

interface City {
  name: string;
  country: string;
  adminCode: string;
  population: number;
  loc: { coordinates: [number, number] };
}

const CITIES: City[] = allCities as City[];

// Display label suffix per ISO country code — prefer the common short form.
const COUNTRY_LABEL_OVERRIDES: Record<string, string> = {
  GB: "UK",
  US: "US",
};

const regionNames =
  typeof Intl !== "undefined" && (Intl as any).DisplayNames
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

function countryLabel(iso2: string): string {
  if (COUNTRY_LABEL_OVERRIDES[iso2]) return COUNTRY_LABEL_OVERRIDES[iso2];
  try {
    return regionNames?.of(iso2) || iso2;
  } catch {
    return iso2;
  }
}

function shortCountrySuffix(iso2: string): string {
  return COUNTRY_LABEL_OVERRIDES[iso2] || iso2;
}

// Region (state/province) name -> gazetteer adminCode, for countries where
// the phone geocoder resolves only to a region rather than a city.
const REGION_ADMIN_CODES: Record<string, Record<string, string>> = {
  US: {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
    colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
    hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
    kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
    massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
    missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
    oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
    virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
    wyoming: "WY", "district of columbia": "DC", "washington dc": "DC",
    "washington state": "WA", "new york state": "NY",
  },
  CA: {
    alberta: "01", "british columbia": "02", manitoba: "03", "new brunswick": "04",
    "newfoundland and labrador": "05", "northwest territories": "13",
    "nova scotia": "07", nunavut: "14", ontario: "08",
    "prince edward island": "09", quebec: "10", saskatchewan: "11", yukon: "12",
  },
};

// --- Lazy-built indexes over the offline gazetteer ---

// country -> lowercase city name -> largest matching city
let nameIndex: Map<string, Map<string, City>> | null = null;
// country -> top cities by population (for deterministic fallback scatter)
let topCitiesIndex: Map<string, City[]> | null = null;

const FALLBACK_CITY_COUNT = 15;
const MIN_FALLBACK_POPULATION = 50000;

function buildIndexes() {
  if (nameIndex && topCitiesIndex) return;
  nameIndex = new Map();
  topCitiesIndex = new Map();

  for (const city of CITIES) {
    let byName = nameIndex.get(city.country);
    if (!byName) {
      byName = new Map();
      nameIndex.set(city.country, byName);
    }
    const key = city.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || city.population > existing.population) {
      byName.set(key, city);
    }
  }

  const byCountry = new Map<string, City[]>();
  for (const city of CITIES) {
    if (city.population < MIN_FALLBACK_POPULATION) continue;
    let list = byCountry.get(city.country);
    if (!list) {
      list = [];
      byCountry.set(city.country, list);
    }
    list.push(city);
  }
  for (const [country, list] of Array.from(byCountry.entries())) {
    list.sort((a, b) => b.population - a.population);
    topCitiesIndex.set(country, list.slice(0, FALLBACK_CITY_COUNT));
  }
}

function findCityByName(country: string, placeName: string): City | null {
  buildIndexes();
  const byName = nameIndex!.get(country);
  if (!byName) return null;

  // Geocoder descriptions can look like "San Francisco, CA",
  // "Auckland/Waiheke Island", or just "London". Try each candidate part.
  const candidates: string[] = [];
  for (const segment of placeName.split(",")) {
    for (const part of segment.split("/")) {
      const trimmed = part.trim();
      if (trimmed) candidates.push(trimmed);
    }
  }

  for (const candidate of candidates) {
    const match = byName.get(candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

// FNV-1a hash for deterministic per-number city selection.
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Deterministically pick a population-weighted city from a list.
function pickWeightedFromList(list: City[], phoneDigits: string): City | null {
  if (list.length === 0) return null;
  const totalPopulation = list.reduce((sum, c) => sum + c.population, 0) || list.length;
  const target = (hashString(phoneDigits) / 0xffffffff) * totalPopulation;

  let cumulative = 0;
  for (const city of list) {
    cumulative += city.population || 1;
    if (target < cumulative) return city;
  }
  return list[list.length - 1];
}

// Deterministically pick a population-weighted major city in the country.
function pickWeightedCity(country: string, phoneDigits: string): City | null {
  buildIndexes();
  let list = topCitiesIndex!.get(country);
  if (!list || list.length === 0) {
    // Small countries/territories may have no cities above the population
    // threshold — fall back to the largest known places there.
    const byName = nameIndex!.get(country);
    if (!byName) return null;
    list = Array.from(byName.values())
      .sort((a, b) => b.population - a.population)
      .slice(0, FALLBACK_CITY_COUNT);
  }
  return pickWeightedFromList(list, phoneDigits);
}

// Deterministically pick a population-weighted city within a region
// (state/province) when the geocoder resolves only to region level.
function pickWeightedCityInRegion(
  country: string,
  adminCode: string,
  phoneDigits: string
): City | null {
  buildIndexes();
  const byName = nameIndex!.get(country);
  if (!byName) return null;
  const inRegion = Array.from(byName.values())
    .filter((c) => c.adminCode === adminCode && c.population >= MIN_FALLBACK_POPULATION)
    .sort((a, b) => b.population - a.population)
    .slice(0, FALLBACK_CITY_COUNT);
  const list = inRegion.length
    ? inRegion
    : Array.from(byName.values())
        .filter((c) => c.adminCode === adminCode)
        .sort((a, b) => b.population - a.population)
        .slice(0, FALLBACK_CITY_COUNT);
  return pickWeightedFromList(list, phoneDigits);
}

function cityToCoords(city: City, label: string): Coords {
  return {
    lat: city.loc.coordinates[1],
    lng: city.loc.coordinates[0],
    name: label,
  };
}

const UNKNOWN: Coords = { lat: 0, lng: 0, name: "Unknown" };

// Cache resolved (pre-jitter) coordinates keyed by phone prefix so repeated
// webhook lookups for similar numbers stay fast. City-level geocoding data is
// prefix-based, so an 8-digit prefix determines the geocoder result; numbers
// sharing a prefix share a cached resolution, bounding cache cardinality.
const CACHE_PREFIX_LENGTH = 8;
const MAX_CACHE_ENTRIES = 20000;
const lookupCache = new Map<string, Coords>();

function cacheGet(key: string): Coords | undefined {
  return lookupCache.get(key);
}

function cacheSet(key: string, value: Coords) {
  if (lookupCache.size >= MAX_CACHE_ENTRIES) {
    // Drop the oldest entry (Map preserves insertion order).
    const oldest = lookupCache.keys().next().value;
    if (oldest !== undefined) lookupCache.delete(oldest);
  }
  lookupCache.set(key, value);
}

async function resolvePhone(digits: string): Promise<Coords> {
  const parsed: PhoneNumber | undefined = parsePhoneNumberFromString(`+${digits}`);
  if (!parsed || !parsed.country) return UNKNOWN;

  const country = parsed.country;

  // 1. City-level geocoding from Google's libphonenumber offline dataset.
  const placeName = await geocoder(parsed, "en");
  if (placeName) {
    const city = findCityByName(country, placeName);
    if (city) {
      return cityToCoords(city, `${city.name}, ${shortCountrySuffix(country)}`);
    }

    // 1b. Region-only description (e.g. "Ontario", "Kansas"): scatter
    //     deterministically across that region's major cities.
    const regionMap = REGION_ADMIN_CODES[country];
    if (regionMap) {
      const adminCode = regionMap[placeName.trim().toLowerCase()];
      if (adminCode) {
        const regionCity = pickWeightedCityInRegion(country, adminCode, digits);
        if (regionCity) {
          return cityToCoords(
            regionCity,
            `${placeName.trim()}, ${shortCountrySuffix(country)} (approx)`
          );
        }
      }
    }
  }

  // 2. Country-only resolution (mobiles, toll-free, unmatched place names):
  //    deterministic population-weighted scatter across the country's major
  //    cities, labeled as approximate — never the center of the country.
  const fallbackCity = pickWeightedCity(country, digits);
  if (fallbackCity) {
    return cityToCoords(fallbackCity, `${countryLabel(country)} (approx)`);
  }

  return UNKNOWN;
}

function withJitter(coords: Coords): Coords {
  if (coords === UNKNOWN) return { ...coords };
  return {
    lat: coords.lat + (Math.random() - 0.5) * 0.3,
    lng: coords.lng + (Math.random() - 0.5) * 0.3,
    name: coords.name,
  };
}

export async function phoneToCoords(phoneE164: string | null | undefined): Promise<Coords> {
  if (!phoneE164) return { ...UNKNOWN };
  const digits = phoneE164.replace(/[^0-9]/g, "");
  if (!digits) return { ...UNKNOWN };

  const cacheKey = digits.substring(0, CACHE_PREFIX_LENGTH);
  const cached = cacheGet(cacheKey);
  if (cached) return withJitter(cached);

  try {
    const resolved = await resolvePhone(digits);
    cacheSet(cacheKey, resolved);
    return withJitter(resolved);
  } catch {
    return { ...UNKNOWN };
  }
}
