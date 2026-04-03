declare module "leaflet.heat" {
  import * as L from "leaflet";
  
  interface HeatLayerOptions {
    radius?: number;
    blur?: number;
    maxZoom?: number;
    max?: number;
    minOpacity?: number;
    gradient?: Record<number, string>;
  }

  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: HeatLayerOptions
  ): L.Layer & {
    setLatLngs(latlngs: Array<[number, number, number?]>): void;
    addLatLng(latlng: [number, number, number?]): void;
    setOptions(options: HeatLayerOptions): void;
  };

  export = heatLayer;
}

declare namespace L {
  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: any
  ): any;
}
