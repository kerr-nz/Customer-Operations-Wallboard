interface Coords {
  lat: number;
  lng: number;
  name: string;
}

const COUNTRY_COORDS: Record<string, Coords> = {
  "1": { lat: 39.8, lng: -98.5, name: "US" },
  "44": { lat: 51.5, lng: -0.1, name: "London, UK" },
  "61": { lat: -33.9, lng: 151.2, name: "Sydney, AU" },
  "64": { lat: -41.3, lng: 174.8, name: "Wellington, NZ" },
  "33": { lat: 48.9, lng: 2.3, name: "Paris, FR" },
  "49": { lat: 52.5, lng: 13.4, name: "Berlin, DE" },
  "81": { lat: 35.7, lng: 139.7, name: "Tokyo, JP" },
  "86": { lat: 39.9, lng: 116.4, name: "Beijing, CN" },
  "91": { lat: 28.6, lng: 77.2, name: "Delhi, IN" },
  "55": { lat: -23.6, lng: -46.6, name: "Sao Paulo, BR" },
  "52": { lat: 19.4, lng: -99.1, name: "Mexico City, MX" },
  "34": { lat: 40.4, lng: -3.7, name: "Madrid, ES" },
  "39": { lat: 41.9, lng: 12.5, name: "Rome, IT" },
  "82": { lat: 37.6, lng: 127.0, name: "Seoul, KR" },
  "65": { lat: 1.4, lng: 103.8, name: "Singapore" },
  "971": { lat: 25.2, lng: 55.3, name: "Dubai, AE" },
  "27": { lat: -33.9, lng: 18.4, name: "Cape Town, ZA" },
  "353": { lat: 53.3, lng: -6.3, name: "Dublin, IE" },
  "31": { lat: 52.4, lng: 4.9, name: "Amsterdam, NL" },
  "46": { lat: 59.3, lng: 18.1, name: "Stockholm, SE" },
  "41": { lat: 47.4, lng: 8.5, name: "Zurich, CH" },
  "90": { lat: 41.0, lng: 29.0, name: "Istanbul, TR" },
  "972": { lat: 32.1, lng: 34.8, name: "Tel Aviv, IL" },
  "62": { lat: -6.2, lng: 106.8, name: "Jakarta, ID" },
  "66": { lat: 13.8, lng: 100.5, name: "Bangkok, TH" },
  "63": { lat: 14.6, lng: 121.0, name: "Manila, PH" },
  "84": { lat: 21.0, lng: 105.8, name: "Hanoi, VN" },
  "886": { lat: 25.0, lng: 121.6, name: "Taipei, TW" },
  "852": { lat: 22.3, lng: 114.2, name: "Hong Kong" },
  "54": { lat: -34.6, lng: -58.4, name: "Buenos Aires, AR" },
  "56": { lat: -33.4, lng: -70.7, name: "Santiago, CL" },
  "57": { lat: 4.7, lng: -74.1, name: "Bogota, CO" },
};

const UK_AREA_COORDS: Record<string, Coords> = {
  "20": { lat: 51.5, lng: -0.1, name: "London, UK" },
  "121": { lat: 52.5, lng: -1.9, name: "Birmingham, UK" },
  "131": { lat: 55.95, lng: -3.2, name: "Edinburgh, UK" },
  "141": { lat: 55.9, lng: -4.3, name: "Glasgow, UK" },
  "151": { lat: 53.4, lng: -3.0, name: "Liverpool, UK" },
  "161": { lat: 53.5, lng: -2.2, name: "Manchester, UK" },
  "113": { lat: 53.8, lng: -1.5, name: "Leeds, UK" },
  "114": { lat: 53.4, lng: -1.5, name: "Sheffield, UK" },
  "115": { lat: 52.95, lng: -1.15, name: "Nottingham, UK" },
  "116": { lat: 52.6, lng: -1.1, name: "Leicester, UK" },
  "117": { lat: 51.5, lng: -2.6, name: "Bristol, UK" },
  "118": { lat: 51.5, lng: -1.0, name: "Reading, UK" },
  "191": { lat: 54.97, lng: -1.6, name: "Newcastle, UK" },
  "28": { lat: 51.5, lng: -0.1, name: "London, UK" },
  "29": { lat: 51.5, lng: -3.2, name: "Cardiff, UK" },
  "23": { lat: 50.9, lng: -1.4, name: "Southampton, UK" },
  "24": { lat: 51.5, lng: -3.2, name: "Coventry, UK" },
};

const AU_AREA_COORDS: Record<string, Coords> = {
  "2": { lat: -33.9, lng: 151.2, name: "Sydney, AU" },
  "3": { lat: -37.8, lng: 145.0, name: "Melbourne, AU" },
  "7": { lat: -27.5, lng: 153.0, name: "Brisbane, AU" },
  "8": { lat: -31.9, lng: 115.9, name: "Perth, AU" },
};

const NZ_AREA_COORDS: Record<string, Coords> = {
  "9": { lat: -36.9, lng: 174.8, name: "Auckland, NZ" },
  "4": { lat: -41.3, lng: 174.8, name: "Wellington, NZ" },
  "3": { lat: -43.5, lng: 172.6, name: "Christchurch, NZ" },
  "7": { lat: -37.8, lng: 175.3, name: "Hamilton, NZ" },
  "6": { lat: -39.5, lng: 176.9, name: "Napier, NZ" },
};

const US_AREA_COORDS: Record<string, { lat: number; lng: number; n: string }> = {
  "201": { lat: 40.9, lng: -74.1, n: "New Jersey, US" },
  "202": { lat: 38.9, lng: -77.0, n: "Washington DC, US" },
  "206": { lat: 47.6, lng: -122.3, n: "Seattle, US" },
  "210": { lat: 29.4, lng: -98.5, n: "San Antonio, US" },
  "212": { lat: 40.8, lng: -74.0, n: "New York, US" },
  "213": { lat: 34.1, lng: -118.2, n: "Los Angeles, US" },
  "214": { lat: 32.8, lng: -96.8, n: "Dallas, US" },
  "215": { lat: 40.0, lng: -75.2, n: "Philadelphia, US" },
  "224": { lat: 42.2, lng: -87.8, n: "Illinois, US" },
  "240": { lat: 39.1, lng: -77.2, n: "Maryland, US" },
  "281": { lat: 29.8, lng: -95.4, n: "Houston, US" },
  "301": { lat: 39.0, lng: -77.0, n: "Maryland, US" },
  "303": { lat: 39.7, lng: -105.0, n: "Denver, US" },
  "305": { lat: 25.8, lng: -80.2, n: "Miami, US" },
  "310": { lat: 33.9, lng: -118.4, n: "Los Angeles, US" },
  "312": { lat: 41.9, lng: -87.6, n: "Chicago, US" },
  "313": { lat: 42.3, lng: -83.0, n: "Detroit, US" },
  "314": { lat: 38.6, lng: -90.2, n: "St Louis, US" },
  "317": { lat: 39.8, lng: -86.2, n: "Indianapolis, US" },
  "321": { lat: 28.5, lng: -80.8, n: "Orlando, US" },
  "323": { lat: 34.0, lng: -118.3, n: "Los Angeles, US" },
  "330": { lat: 41.1, lng: -81.5, n: "Akron, US" },
  "347": { lat: 40.7, lng: -73.9, n: "New York, US" },
  "404": { lat: 33.7, lng: -84.4, n: "Atlanta, US" },
  "407": { lat: 28.5, lng: -81.4, n: "Orlando, US" },
  "408": { lat: 37.3, lng: -121.9, n: "San Jose, US" },
  "412": { lat: 40.4, lng: -80.0, n: "Pittsburgh, US" },
  "415": { lat: 37.8, lng: -122.4, n: "San Francisco, US" },
  "469": { lat: 32.8, lng: -96.8, n: "Dallas, US" },
  "480": { lat: 33.4, lng: -111.9, n: "Mesa, US" },
  "501": { lat: 34.7, lng: -92.3, n: "Little Rock, US" },
  "503": { lat: 45.5, lng: -122.7, n: "Portland, US" },
  "504": { lat: 30.0, lng: -90.1, n: "New Orleans, US" },
  "510": { lat: 37.8, lng: -122.3, n: "Oakland, US" },
  "512": { lat: 30.3, lng: -97.7, n: "Austin, US" },
  "513": { lat: 39.1, lng: -84.5, n: "Cincinnati, US" },
  "516": { lat: 40.7, lng: -73.6, n: "Long Island, US" },
  "571": { lat: 38.9, lng: -77.3, n: "Virginia, US" },
  "602": { lat: 33.4, lng: -112.1, n: "Phoenix, US" },
  "612": { lat: 44.98, lng: -93.27, n: "Minneapolis, US" },
  "614": { lat: 40.0, lng: -82.9, n: "Columbus, US" },
  "615": { lat: 36.2, lng: -86.8, n: "Nashville, US" },
  "617": { lat: 42.4, lng: -71.1, n: "Boston, US" },
  "619": { lat: 32.7, lng: -117.2, n: "San Diego, US" },
  "646": { lat: 40.7, lng: -74.0, n: "New York, US" },
  "650": { lat: 37.5, lng: -122.2, n: "Silicon Valley, US" },
  "678": { lat: 33.7, lng: -84.4, n: "Atlanta, US" },
  "702": { lat: 36.2, lng: -115.1, n: "Las Vegas, US" },
  "703": { lat: 38.9, lng: -77.2, n: "Virginia, US" },
  "704": { lat: 35.2, lng: -80.8, n: "Charlotte, US" },
  "713": { lat: 29.8, lng: -95.4, n: "Houston, US" },
  "718": { lat: 40.7, lng: -73.9, n: "New York, US" },
  "720": { lat: 39.7, lng: -105.0, n: "Denver, US" },
  "773": { lat: 41.9, lng: -87.7, n: "Chicago, US" },
  "786": { lat: 25.8, lng: -80.2, n: "Miami, US" },
  "800": { lat: 39.8, lng: -98.5, n: "US Toll-Free" },
  "801": { lat: 40.8, lng: -111.9, n: "Salt Lake City, US" },
  "813": { lat: 28.0, lng: -82.5, n: "Tampa, US" },
  "816": { lat: 39.1, lng: -94.6, n: "Kansas City, US" },
  "832": { lat: 29.8, lng: -95.4, n: "Houston, US" },
  "858": { lat: 32.9, lng: -117.2, n: "San Diego, US" },
  "901": { lat: 35.1, lng: -90.0, n: "Memphis, US" },
  "904": { lat: 30.3, lng: -81.7, n: "Jacksonville, US" },
  "916": { lat: 38.6, lng: -121.5, n: "Sacramento, US" },
  "917": { lat: 40.7, lng: -74.0, n: "New York, US" },
  "919": { lat: 35.8, lng: -78.6, n: "Raleigh, US" },
  "929": { lat: 40.7, lng: -73.9, n: "New York, US" },
  "949": { lat: 33.7, lng: -117.8, n: "Irvine, US" },
  "954": { lat: 26.1, lng: -80.1, n: "Fort Lauderdale, US" },
};

export function phoneToCoords(phoneE164: string | null | undefined): Coords {
  if (!phoneE164) return { lat: 39.8, lng: -98.5, name: "Unknown" };
  const num = phoneE164.replace(/[^0-9]/g, "");

  if (num.startsWith("1") && num.length >= 4) {
    const area = num.substring(1, 4);
    if (US_AREA_COORDS[area]) {
      const c = US_AREA_COORDS[area];
      return {
        lat: c.lat + (Math.random() - 0.5) * 0.5,
        lng: c.lng + (Math.random() - 0.5) * 0.5,
        name: c.n,
      };
    }
    return { lat: 39.8, lng: -98.5, name: "US" };
  }

  if (num.startsWith("44")) {
    const afterCode = num.substring(2);
    if (afterCode.startsWith("7")) {
      return { lat: 51.5 + (Math.random() - 0.5) * 2, lng: -0.1 + (Math.random() - 0.5) * 2, name: "UK Mobile" };
    }
    for (const len of [3, 2]) {
      const area = afterCode.substring(0, len);
      if (UK_AREA_COORDS[area]) {
        const c = UK_AREA_COORDS[area];
        return { lat: c.lat + (Math.random() - 0.5) * 0.3, lng: c.lng + (Math.random() - 0.5) * 0.3, name: c.name };
      }
    }
    return { lat: 51.5 + (Math.random() - 0.5), lng: -0.1 + (Math.random() - 0.5), name: "UK" };
  }

  if (num.startsWith("61")) {
    const afterCode = num.substring(2);
    if (afterCode.startsWith("4")) {
      return { lat: -33.9 + (Math.random() - 0.5) * 3, lng: 151.2 + (Math.random() - 0.5) * 3, name: "AU Mobile" };
    }
    const areaDigit = afterCode.substring(0, 1);
    if (AU_AREA_COORDS[areaDigit]) {
      const c = AU_AREA_COORDS[areaDigit];
      return { lat: c.lat + (Math.random() - 0.5) * 0.5, lng: c.lng + (Math.random() - 0.5) * 0.5, name: c.name };
    }
    return { lat: -33.9 + (Math.random() - 0.5), lng: 151.2 + (Math.random() - 0.5), name: "Australia" };
  }

  if (num.startsWith("64")) {
    const afterCode = num.substring(2);
    for (const len of [2, 1]) {
      const area = afterCode.substring(0, len);
      if (NZ_AREA_COORDS[area]) {
        const c = NZ_AREA_COORDS[area];
        return { lat: c.lat + (Math.random() - 0.5) * 0.3, lng: c.lng + (Math.random() - 0.5) * 0.3, name: c.name };
      }
    }
    return { lat: -41.3 + (Math.random() - 0.5), lng: 174.8 + (Math.random() - 0.5), name: "New Zealand" };
  }

  for (const len of [3, 2, 1]) {
    const code = num.substring(0, len);
    if (COUNTRY_COORDS[code]) {
      const c = COUNTRY_COORDS[code];
      return {
        lat: c.lat + (Math.random() - 0.5) * 2,
        lng: c.lng + (Math.random() - 0.5) * 2,
        name: c.name,
      };
    }
  }

  return { lat: 39.8, lng: -98.5, name: "Unknown" };
}
