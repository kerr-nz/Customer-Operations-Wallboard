interface Coords {
  lat: number;
  lng: number;
  name: string;
}

const COUNTRY_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
  "1": { lat: 39.8, lng: -98.5, name: "US" },
  "44": { lat: 51.5, lng: -0.1, name: "UK" },
  "61": { lat: -25.3, lng: 133.8, name: "Australia" },
  "64": { lat: -41.3, lng: 174.8, name: "New Zealand" },
  "33": { lat: 46.2, lng: 2.2, name: "France" },
  "49": { lat: 51.2, lng: 10.4, name: "Germany" },
  "81": { lat: 36.2, lng: 138.3, name: "Japan" },
  "86": { lat: 35.9, lng: 104.2, name: "China" },
  "91": { lat: 20.6, lng: 79.0, name: "India" },
  "55": { lat: -14.2, lng: -51.9, name: "Brazil" },
  "52": { lat: 23.6, lng: -102.6, name: "Mexico" },
  "34": { lat: 40.5, lng: -3.7, name: "Spain" },
  "39": { lat: 41.9, lng: 12.6, name: "Italy" },
  "82": { lat: 35.9, lng: 127.8, name: "South Korea" },
  "65": { lat: 1.4, lng: 103.8, name: "Singapore" },
  "971": { lat: 23.4, lng: 53.8, name: "UAE" },
  "27": { lat: -30.6, lng: 22.9, name: "South Africa" },
  "353": { lat: 53.1, lng: -7.7, name: "Ireland" },
  "31": { lat: 52.1, lng: 5.3, name: "Netherlands" },
  "46": { lat: 60.1, lng: 18.6, name: "Sweden" },
  "41": { lat: 46.8, lng: 8.2, name: "Switzerland" },
  "90": { lat: 38.9, lng: 35.2, name: "Turkey" },
  "972": { lat: 31.0, lng: 34.9, name: "Israel" },
  "62": { lat: -0.8, lng: 113.9, name: "Indonesia" },
  "66": { lat: 15.9, lng: 100.9, name: "Thailand" },
  "63": { lat: 12.9, lng: 121.8, name: "Philippines" },
  "84": { lat: 14.1, lng: 108.3, name: "Vietnam" },
  "886": { lat: 23.7, lng: 121.0, name: "Taiwan" },
  "852": { lat: 22.4, lng: 114.1, name: "Hong Kong" },
  "54": { lat: -38.4, lng: -63.6, name: "Argentina" },
  "56": { lat: -35.7, lng: -71.5, name: "Chile" },
  "57": { lat: 4.6, lng: -74.3, name: "Colombia" },
};

const US_AREA_COORDS: Record<string, { lat: number; lng: number; n: string }> = {
  "201": { lat: 40.9, lng: -74.1, n: "NJ" },
  "202": { lat: 38.9, lng: -77.0, n: "DC" },
  "206": { lat: 47.6, lng: -122.3, n: "Seattle" },
  "210": { lat: 29.4, lng: -98.5, n: "San Antonio" },
  "212": { lat: 40.8, lng: -74.0, n: "NYC" },
  "213": { lat: 34.1, lng: -118.2, n: "LA" },
  "214": { lat: 32.8, lng: -96.8, n: "Dallas" },
  "215": { lat: 40.0, lng: -75.2, n: "Philadelphia" },
  "224": { lat: 42.2, lng: -87.8, n: "IL" },
  "240": { lat: 39.1, lng: -77.2, n: "MD" },
  "281": { lat: 29.8, lng: -95.4, n: "Houston" },
  "301": { lat: 39.0, lng: -77.0, n: "MD" },
  "303": { lat: 39.7, lng: -105.0, n: "Denver" },
  "305": { lat: 25.8, lng: -80.2, n: "Miami" },
  "310": { lat: 33.9, lng: -118.4, n: "LA" },
  "312": { lat: 41.9, lng: -87.6, n: "Chicago" },
  "313": { lat: 42.3, lng: -83.0, n: "Detroit" },
  "314": { lat: 38.6, lng: -90.2, n: "St Louis" },
  "317": { lat: 39.8, lng: -86.2, n: "Indianapolis" },
  "321": { lat: 28.5, lng: -80.8, n: "Orlando" },
  "323": { lat: 34.0, lng: -118.3, n: "LA" },
  "330": { lat: 41.1, lng: -81.5, n: "Akron" },
  "347": { lat: 40.7, lng: -73.9, n: "NYC" },
  "404": { lat: 33.7, lng: -84.4, n: "Atlanta" },
  "407": { lat: 28.5, lng: -81.4, n: "Orlando" },
  "408": { lat: 37.3, lng: -121.9, n: "San Jose" },
  "412": { lat: 40.4, lng: -80.0, n: "Pittsburgh" },
  "415": { lat: 37.8, lng: -122.4, n: "SF" },
  "469": { lat: 32.8, lng: -96.8, n: "Dallas" },
  "480": { lat: 33.4, lng: -111.9, n: "Mesa" },
  "501": { lat: 34.7, lng: -92.3, n: "Little Rock" },
  "503": { lat: 45.5, lng: -122.7, n: "Portland" },
  "504": { lat: 30.0, lng: -90.1, n: "New Orleans" },
  "510": { lat: 37.8, lng: -122.3, n: "Oakland" },
  "512": { lat: 30.3, lng: -97.7, n: "Austin" },
  "513": { lat: 39.1, lng: -84.5, n: "Cincinnati" },
  "516": { lat: 40.7, lng: -73.6, n: "Long Island" },
  "571": { lat: 38.9, lng: -77.3, n: "N Virginia" },
  "602": { lat: 33.4, lng: -112.1, n: "Phoenix" },
  "612": { lat: 44.98, lng: -93.27, n: "Minneapolis" },
  "614": { lat: 40.0, lng: -82.9, n: "Columbus" },
  "615": { lat: 36.2, lng: -86.8, n: "Nashville" },
  "617": { lat: 42.4, lng: -71.1, n: "Boston" },
  "619": { lat: 32.7, lng: -117.2, n: "San Diego" },
  "646": { lat: 40.7, lng: -74.0, n: "NYC" },
  "650": { lat: 37.5, lng: -122.2, n: "Silicon Valley" },
  "678": { lat: 33.7, lng: -84.4, n: "Atlanta" },
  "702": { lat: 36.2, lng: -115.1, n: "Las Vegas" },
  "703": { lat: 38.9, lng: -77.2, n: "N Virginia" },
  "704": { lat: 35.2, lng: -80.8, n: "Charlotte" },
  "713": { lat: 29.8, lng: -95.4, n: "Houston" },
  "718": { lat: 40.7, lng: -73.9, n: "NYC" },
  "720": { lat: 39.7, lng: -105.0, n: "Denver" },
  "773": { lat: 41.9, lng: -87.7, n: "Chicago" },
  "786": { lat: 25.8, lng: -80.2, n: "Miami" },
  "801": { lat: 40.8, lng: -111.9, n: "SLC" },
  "813": { lat: 28.0, lng: -82.5, n: "Tampa" },
  "816": { lat: 39.1, lng: -94.6, n: "Kansas City" },
  "832": { lat: 29.8, lng: -95.4, n: "Houston" },
  "858": { lat: 32.9, lng: -117.2, n: "San Diego" },
  "901": { lat: 35.1, lng: -90.0, n: "Memphis" },
  "904": { lat: 30.3, lng: -81.7, n: "Jacksonville" },
  "916": { lat: 38.6, lng: -121.5, n: "Sacramento" },
  "917": { lat: 40.7, lng: -74.0, n: "NYC" },
  "919": { lat: 35.8, lng: -78.6, n: "Raleigh" },
  "929": { lat: 40.7, lng: -73.9, n: "NYC" },
  "949": { lat: 33.7, lng: -117.8, n: "Irvine" },
  "954": { lat: 26.1, lng: -80.1, n: "Fort Lauderdale" },
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

  return { lat: 39.8, lng: -98.5, name: "US" };
}
