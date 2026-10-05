"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, prewarm, type ExpressionSpecification, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, LineString } from "geojson";
import type { Topology } from "topojson-specification";
import type { MapCountry } from "@/lib/queries";
import type { LayerId } from "@/lib/ui/labels";
import { CONFIDENCE_ALPHA, NO_DATA, NO_GOV, css, divergingColor, sequentialColor, type RGB } from "@/lib/ui/palette";
import { MapTooltip } from "./MapTooltip";

// Keep MapLibre's shared worker pool alive across map instances. Without this,
// removing a map (React StrictMode remounts, client navigation) can tear the pool
// down while the next map is starting, and that map's style never finishes loading.
if (typeof window !== "undefined") prewarm();

type Props = { countries: MapCountry[]; layer: LayerId; selected: string | null; onSelect: (code: string) => void };
type Props0 = { code: string; n: string; lx: number; ly: number; lr: number };

// Country polygons are drawn by MapLibre itself: it subdivides geometry for the
// globe, which deck.gl's flat tessellation does not (large polygons dip under the
// sphere). Labels are HTML positioned with map.project(). deck.gl comes back in
// Phase 2 for the influence arcs (its globe overlay did not render with
// maplibre-gl 5.24 + deck.gl 9.4 and needs a closer look then).
const STYLE: StyleSpecification = {
  version: 8,
  projection: { type: "globe" },
  sources: { graticule: { type: "geojson", data: graticule(30) } },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0a0e12" } },
    { id: "graticule", type: "line", source: "graticule", paint: { "line-color": "#17212b", "line-width": 0.6 } },
  ],
  sky: { "sky-color": "#07090b", "horizon-color": "#0d1a22", "fog-color": "#07090b", "atmosphere-blend": 0.35 },
};

function graticule(step: number): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  for (let lon = -180; lon < 180; lon += step)
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 37 }, (_, i) => [lon, -90 + i * 5]) } });
  for (let lat = -60; lat <= 60; lat += step)
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } });
  return { type: "FeatureCollection", features };
}

export function fillFor(c: MapCountry | undefined, layer: LayerId): { color: RGB; alpha: number; hatch: boolean } {
  if (!c) return { color: NO_GOV, alpha: 1, hatch: false };
  if (layer === "nobel") {
    const col = sequentialColor(c.nobel);
    return col ? { color: col, alpha: 1, hatch: false } : { color: NO_DATA, alpha: 1, hatch: false };
  }
  const pos = layer === "econ" ? c.econ : c.galtan;
  if (!pos) return { color: NO_GOV, alpha: 1, hatch: false }; // no government (Antarctica, uninhabited territories)
  if (pos.v == null || !pos.c) return { color: NO_DATA, alpha: 1, hatch: true };
  return { color: divergingColor(pos.v), alpha: CONFIDENCE_ALPHA[pos.c], hatch: pos.c === "D" };
}

/** 8×8 diagonal hatch, used for missing data and estimates. */
function hatchImage() {
  const s = 8;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const on = (x + y) % s === 0;
      const i = (y * s + x) * 4;
      data.set(on ? [140, 152, 165, 150] : [0, 0, 0, 0], i);
    }
  return { width: s, height: s, data };
}

/** Great-circle angle (degrees) between two lon/lat points. */
function angle(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const c = Math.sin(a[1] * r) * Math.sin(b[1] * r) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.cos((a[0] - b[0]) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
}

type Label = { code: string; name: string; x: number; y: number; rank: number };

/** Visible-hemisphere labels, more as you zoom in, with greedy collision avoidance. */
function placeLabels(map: MapLibreMap, features: Feature<Geometry, Props0>[], selected: string | null): Label[] {
  const zoom = map.getZoom();
  const c = map.getCenter();
  const center: [number, number] = [c.lng, c.lat];
  const maxRank = zoom < 1.6 ? 2 : zoom < 2.6 ? 3 : zoom < 3.6 ? 4 : 6;
  const candidates = features
    .filter((f) => (f.properties.lr <= maxRank || f.properties.code === selected) && Number.isFinite(f.properties.lx) && angle(center, [f.properties.lx, f.properties.ly]) < 70)
    .map((f) => {
      const p = map.project([f.properties.lx, f.properties.ly]);
      return { code: f.properties.code, name: f.properties.n, x: p.x, y: p.y, rank: f.properties.lr };
    })
    // Selected first, then most important (lowest rank), then shortest names.
    .sort((a, b) => Number(b.code === selected) - Number(a.code === selected) || a.rank - b.rank || a.name.length - b.name.length);
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  return candidates.filter((l) => {
    const w = l.name.length * (l.rank <= 2 ? 7.4 : 6.4) + 6;
    const box = { x0: l.x - w / 2, x1: l.x + w / 2, y0: l.y - 8, y1: l.y + 8 };
    if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) return false;
    placed.push(box);
    return true;
  });
}

export default function AtlasMap({ countries, layer, selected, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [geo, setGeo] = useState<FeatureCollection<Geometry, Props0> | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const byCode = useMemo(() => new Map(countries.map((c) => [c.code, c])), [countries]);

  useEffect(() => {
    let cancelled = false;
    fetch("/geo/countries.topo.json")
      .then((r) => r.json())
      .then((topo: Topology) => {
        if (cancelled) return;
        const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, Omit<Props0, "code">>;
        // promoteId needs the code as a property.
        setGeo({ ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, code: String(f.id) } })) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Map + static layers.
  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: STYLE,
      center: [-25, 12],
      zoom: window.innerWidth < 1200 ? 1.75 : 2,
      minZoom: 0.8,
      maxZoom: 7,
      attributionControl: { compact: true, customAttribution: "Natural Earth · Wikidata · CHES · ParlGov · GPS · Herre · V-Dem · Nobel" },
      renderWorldCopies: false,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      map.addImage("hatch", hatchImage(), { pixelRatio: 2 });
      map.addSource("countries", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "code" });
      map.addLayer({ id: "fill", type: "fill", source: "countries", paint: { "fill-color": "#12171d", "fill-opacity": 1 } });
      map.addLayer({ id: "hatch", type: "fill", source: "countries", filter: ["==", ["get", "code"], ""], paint: { "fill-pattern": "hatch" } });
      map.addLayer({ id: "borders", type: "line", source: "countries", paint: { "line-color": "#080b0e", "line-width": 0.6 } });
      map.addLayer({
        id: "disputed",
        type: "line",
        source: "countries",
        filter: ["==", ["get", "code"], ""],
        paint: { "line-color": "#ffc247", "line-opacity": 0.6, "line-width": 1, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "hover",
        type: "line",
        source: "countries",
        paint: { "line-color": "#e4eaf0", "line-width": 1.2, "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0] },
      });
      map.addLayer({ id: "selected", type: "line", source: "countries", filter: ["==", ["get", "code"], ""], paint: { "line-color": "#3fd8e6", "line-width": 2 } });
      setReady(true);
    });

    let hovered: string | null = null;
    const setHoverState = (code: string | null) => {
      if (hovered) map.setFeatureState({ source: "countries", id: hovered }, { hover: false });
      hovered = code;
      if (code) map.setFeatureState({ source: "countries", id: code }, { hover: true });
    };
    map.on("mousemove", "fill", (e) => {
      const code = e.features?.[0]?.properties?.code as string | undefined;
      if (!code) return;
      map.getCanvas().style.cursor = "pointer";
      if (code !== hovered) setHoverState(code);
      setHover({ code, x: e.point.x, y: e.point.y });
    });
    map.on("mouseleave", "fill", () => {
      map.getCanvas().style.cursor = "";
      setHoverState(null);
      setHover(null);
    });
    map.on("click", "fill", (e) => {
      const code = e.features?.[0]?.properties?.code as string | undefined;
      if (code) onSelectRef.current(code);
    });
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __atlasMap: map });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Geometry → source.
  useEffect(() => {
    if (!ready || !geo) return;
    (mapRef.current?.getSource("countries") as GeoJSONSource | undefined)?.setData(geo);
  }, [ready, geo]);

  // Data-driven paint: one match expression per property, rebuilt on layer/data change.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !geo) return;
    const colorExpr: unknown[] = ["match", ["get", "code"]];
    const alphaExpr: unknown[] = ["match", ["get", "code"]];
    const hatch: string[] = [];
    for (const f of geo.features) {
      const code = f.properties.code;
      const { color, alpha, hatch: h } = fillFor(byCode.get(code), layer);
      colorExpr.push(code, css(color));
      alphaExpr.push(code, alpha);
      if (h) hatch.push(code);
    }
    colorExpr.push(css(NO_GOV));
    alphaExpr.push(1);
    map.setPaintProperty("fill", "fill-color", colorExpr as ExpressionSpecification);
    map.setPaintProperty("fill", "fill-opacity", alphaExpr as ExpressionSpecification);
    map.setFilter("hatch", ["in", ["get", "code"], ["literal", hatch]]);
    map.setFilter("disputed", ["in", ["get", "code"], ["literal", countries.filter((c) => c.disputed).map((c) => c.code)]]);
  }, [ready, geo, byCode, layer, countries]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.setFilter("selected", ["==", ["get", "code"], selected ?? ""]);
  }, [ready, selected]);

  // Fly to the selected country.
  useEffect(() => {
    const map = mapRef.current;
    const f = geo?.features.find((x) => x.properties.code === selected);
    if (!map || !f) return;
    map.easeTo({ center: [f.properties.lx, f.properties.ly], zoom: Math.max(map.getZoom(), 2.2), duration: 900, padding: { right: 470, left: 280, top: 0, bottom: 0 } });
  }, [selected, geo]);

  // Labels follow the camera; recomputed on every move (throttled to one per frame).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !geo) return;
    let raf = requestAnimationFrame(() => setLabels(placeLabels(map, geo.features, selected)));
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLabels(placeLabels(map, geo.features, selected)));
    };
    map.on("move", update);
    map.on("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      map.off("move", update);
      map.off("resize", update);
    };
  }, [ready, geo, selected]);

  const hovered = hover ? byCode.get(hover.code) : undefined;
  const hoveredName = hover ? (hovered?.name ?? geo?.features.find((f) => f.properties.code === hover.code)?.properties.n) : undefined;

  return (
    <div className="absolute inset-0">
      {/* maplibre's own CSS forces position:relative on this node, so size it explicitly */}
      <div ref={container} className="h-full w-full" aria-label="Mapa-múndi interativo" role="application" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {labels.map((l) => (
          <span
            key={l.code}
            className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono uppercase tracking-wider [text-shadow:0_0_3px_#07090b,0_0_2px_#07090b] ${
              l.code === selected ? "text-cyan" : "text-ink/70"
            } ${l.rank <= 2 ? "text-[10.5px]" : "text-[9px]"}`}
            style={{ left: l.x, top: l.y }}
          >
            {l.name}
          </span>
        ))}
      </div>
      {hover && hoveredName && <MapTooltip x={hover.x} y={hover.y} name={hoveredName} country={hovered} layer={layer} />}
      {!geo && <div className="label absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">carregando geometria…</div>}
    </div>
  );
}
