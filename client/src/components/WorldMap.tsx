import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CallData } from "@shared/schema";
import { Globe, MapPin, RotateCw } from "lucide-react";

interface WorldMapProps {
  calls: CallData[];
  activeCount?: number;
}

type CountryFocus = {
  label: string;
  center: [number, number];
  zoom: number;
};

const COUNTRY_PRESETS: Record<string, CountryFocus> = {
  world: { label: "Entire World", center: [30, 20], zoom: 1.3 },
  australia: { label: "Australia", center: [134, -25.5], zoom: 3.8 },
  united_kingdom: { label: "United Kingdom", center: [-3.5, 54.5], zoom: 5 },
  new_zealand: { label: "New Zealand", center: [172, -41], zoom: 5 },
  united_states: { label: "United States", center: [-98, 39], zoom: 3.5 },
  canada: { label: "Canada", center: [-96, 56], zoom: 3 },
  europe: { label: "Europe", center: [15, 50], zoom: 3.5 },
  asia_pacific: { label: "Asia Pacific", center: [115, 5], zoom: 3 },
};

function getCallColor(call: CallData): { color: string; isLive: boolean } {
  if (call.status === "active") return { color: "#22c55e", isLive: true };
  if (call.status === "answered" && call.duration == null) return { color: "#f59e0b", isLive: true };
  if (call.status === "missed") return { color: "#ef4444", isLive: false };
  switch (call.sentiment) {
    case "Happy":
      return { color: "#22c55e", isLive: false };
    case "Angry":
      return { color: "#ef4444", isLive: false };
    case "Normal":
      return { color: "#3b82f6", isLive: false };
    default:
      return { color: "#6366f1", isLive: false };
  }
}

function createArcGeoJSON(
  fromLng: number,
  fromLat: number,
  toLng: number,
  toLat: number,
  steps = 50
): GeoJSON.LineString {
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lng = fromLng + (toLng - fromLng) * t;
    const lat = fromLat + (toLat - fromLat) * t;
    const arcHeight = Math.sin(t * Math.PI) * Math.min(Math.abs(toLng - fromLng) * 0.15, 20);
    coords.push([lng, lat + arcHeight]);
  }
  return { type: "LineString", coordinates: coords };
}

export function WorldMap({ calls, activeCount }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const maplibreRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [mapError, setMapError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [focusRegion, setFocusRegion] = useState("world");

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");

        if (cancelled || !containerRef.current) return;

        maplibreRef.current = maplibregl.default || maplibregl;
        const ml = maplibreRef.current;

        const preset = COUNTRY_PRESETS[focusRegion] || COUNTRY_PRESETS.world;

        const map = new ml.Map({
          container: containerRef.current,
          style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
          center: preset.center,
          zoom: preset.zoom,
          attributionControl: false,
          interactive: true,
          minZoom: 1,
          maxZoom: 10,
        });

        map.scrollZoom.disable();
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();

        map.on("load", () => {
          if (cancelled) return;

          map.addSource("arcs", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });

          map.addLayer({
            id: "arcs-layer",
            type: "line",
            source: "arcs",
            paint: {
              "line-color": ["get", "color"],
              "line-width": ["case", ["get", "active"], 2.5, 1.5],
              "line-opacity": ["case", ["get", "active"], 0.85, 0.45],
            },
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
          });

          map.addSource("points", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });

          map.addLayer({
            id: "points-glow",
            type: "circle",
            source: "points",
            paint: {
              "circle-radius": ["case", ["get", "active"], 10, 6],
              "circle-color": ["get", "color"],
              "circle-opacity": ["case", ["get", "active"], 0.2, 0.1],
              "circle-blur": 1,
            },
          });

          map.addLayer({
            id: "points-layer",
            type: "circle",
            source: "points",
            paint: {
              "circle-radius": ["case", ["get", "active"], 5, 3.5],
              "circle-color": ["get", "color"],
              "circle-opacity": ["case", ["get", "active"], 0.9, 0.6],
              "circle-stroke-width": 1,
              "circle-stroke-color": ["get", "color"],
              "circle-stroke-opacity": 0.3,
            },
          });

          setMapReady(true);
        });

        map.on("error", (e: any) => {
          console.warn("MapLibre error:", e);
        });

        mapRef.current = map;
      } catch (e) {
        console.warn("MapLibre GL failed to initialize:", e);
        if (!cancelled) setMapError(true);
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const autoPanKeys = useMemo(() => Object.keys(COUNTRY_PRESETS), []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (focusRegion !== "auto") {
      const preset = COUNTRY_PRESETS[focusRegion] || COUNTRY_PRESETS.world;
      map.flyTo({
        center: preset.center,
        zoom: preset.zoom,
        duration: 1200,
        essential: true,
      });
      return;
    }

    let index = 0;
    const flyToRegion = () => {
      const key = autoPanKeys[index % autoPanKeys.length];
      const preset = COUNTRY_PRESETS[key];
      map.flyTo({
        center: preset.center,
        zoom: preset.zoom,
        duration: 2000,
        essential: true,
      });
      index++;
    };

    flyToRegion();
    const interval = setInterval(flyToRegion, 10000);
    return () => clearInterval(interval);
  }, [focusRegion, mapReady, autoPanKeys]);

  const updateMapData = useCallback((callsData: CallData[]) => {
    const map = mapRef.current;
    const ml = maplibreRef.current;
    if (!map || !ml || !map.isStyleLoaded()) return;

    markersRef.current.forEach((m: any) => m.remove());
    markersRef.current = [];

    const recentCalls = callsData.slice(0, 30);
    const arcFeatures: GeoJSON.Feature[] = [];
    const pointFeatures: GeoJSON.Feature[] = [];

    recentCalls.forEach((call) => {
      if (!call.from || !call.to) return;
      const { color, isLive } = getCallColor(call);

      arcFeatures.push({
        type: "Feature",
        properties: { color, active: isLive, id: call.id },
        geometry: createArcGeoJSON(call.from.lng, call.from.lat, call.to.lng, call.to.lat),
      });

      pointFeatures.push({
        type: "Feature",
        properties: { color, active: isLive },
        geometry: { type: "Point", coordinates: [call.from.lng, call.from.lat] },
      });
      pointFeatures.push({
        type: "Feature",
        properties: { color, active: isLive },
        geometry: { type: "Point", coordinates: [call.to.lng, call.to.lat] },
      });

      if (isLive) {
        [call.from, call.to].forEach((coord) => {
          const el = document.createElement("div");
          el.className = "maplibre-pulse-marker";
          el.style.cssText = `
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 2px solid ${color};
            opacity: 0;
            animation: pulse-ring 2s ease-out infinite;
            pointer-events: none;
          `;
          const marker = new ml.Marker({ element: el })
            .setLngLat([coord.lng, coord.lat])
            .addTo(map);
          markersRef.current.push(marker);
        });
      }
    });

    const arcSource = map.getSource("arcs");
    if (arcSource) {
      arcSource.setData({ type: "FeatureCollection", features: arcFeatures });
    }

    const pointSource = map.getSource("points");
    if (pointSource) {
      pointSource.setData({ type: "FeatureCollection", features: pointFeatures });
    }
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    updateMapData(calls);
  }, [calls, mapReady, updateMapData]);

  const activeCallsFromList = calls.filter((c) => c.status === "active" || (c.status === "answered" && c.duration == null));
  const displayActiveCount = activeCount !== undefined ? activeCount : activeCallsFromList.length;

  return (
    <Card
      className="relative overflow-hidden p-0 h-full"
      data-testid="world-map"
    >
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.5); opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        .maplibregl-canvas { outline: none; }
      `}</style>

      {mapError ? (
        <div className="w-full h-full min-h-[280px] flex items-center justify-center bg-muted/20" data-testid="map-fallback">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Globe className="w-12 h-12 opacity-40" />
            <span className="text-sm">Map unavailable</span>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-full min-h-[280px]" />
      )}

      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/60 to-transparent pointer-events-none z-10" />

      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm rounded-md px-2 py-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="tabular-nums font-medium" data-testid="text-active-calls">{displayActiveCount}</span>
          <span>active</span>
        </div>
      </div>

      <div className="absolute top-3 right-3 z-20" data-testid="map-region-selector">
        <Select value={focusRegion} onValueChange={setFocusRegion}>
          <SelectTrigger className="min-w-[140px] w-auto bg-background/80 backdrop-blur-sm border-border/50 text-xs" data-testid="select-region-trigger">
            {focusRegion === "auto" ? (
              <RotateCw className="w-3 h-3 mr-1 shrink-0 animate-spin" style={{ animationDuration: "3s" }} />
            ) : (
              <MapPin className="w-3 h-3 mr-1 shrink-0" />
            )}
            <SelectValue />
          </SelectTrigger>
          <SelectContent data-testid="select-region-content">
            <SelectItem value="auto" data-testid="select-region-auto">
              Auto-Pan
            </SelectItem>
            <div className="h-px bg-border my-1" />
            {Object.entries(COUNTRY_PRESETS).map(([key, preset]) => (
              <SelectItem key={key} value={key} data-testid={`select-region-${key}`}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}
