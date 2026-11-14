const outline = 85.05112878;
const baseAttribution = '<a href="https://earthobservatory.nasa.gov/features/BlueMarble" target="_blank" rel="noopener">NASA Blue Marble</a>';
export const plateSource = ['PB2002 plate boundaries · Peter Bird, Hugo Ahlenius / Nordpil · ODC-BY 1.0', 'https://github.com/fraxen/tectonicplates'];

export const basemapStyle = {
  version: 8, sources: {},
  layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': '#10272d' } }],
};

export function addBasemap(map, snapshotUrl) {
  map.addSource('blue-marble-local', { type: 'raster', tiles: [snapshotUrl], tileSize: 1024, maxzoom: 0, attribution: baseAttribution });
  map.addLayer({ id: 'marble-overview', type: 'raster', source: 'blue-marble-local', paint: { 'raster-fade-duration': 0 } });
  map.addSource('blue-marble-detail', { type: 'raster', tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'], tileSize: 256, minzoom: 3, maxzoom: 8 });
  map.addLayer({ id: 'marble-detail', type: 'raster', source: 'blue-marble-detail', minzoom: 3, paint: { 'raster-fade-duration': 0 } });
}

export function setBasemap(map, key) {
  for (const id of ['marble-overview', 'marble-detail']) {
    map.setPaintProperty(id, 'raster-saturation', key === 'atlas' ? -1 : -0.12);
    map.setPaintProperty(id, 'raster-brightness-max', key === 'atlas' ? 0.46 : 0.86);
  }
}

export function addPlates(map, data) {
  if (map.getSource('tectonic-plates')) return;
  map.addSource('tectonic-plates', { type: 'geojson', data, attribution: '<a href="https://github.com/fraxen/tectonicplates" target="_blank" rel="noopener">PB2002 · Bird / Ahlenius / Nordpil</a>' });
  const before = ['satellite-context', 'world-clusters', 'scene'].find(id => map.getLayer(id));
  map.addLayer({ id: 'tectonic-plates', type: 'line', source: 'tectonic-plates',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffc086', 'line-opacity': 0.78, 'line-width': ['interpolate',['linear'],['zoom'],0,.65,5,1.3] },
  }, before);
}

export function projectWorld([lon, lat]) {
  const phi = Math.max(-outline, Math.min(outline, lat)) * Math.PI / 180;
  return [((lon + 180) * (1024 / 360)).toFixed(2), ((.5 - Math.asinh(Math.tan(phi)) / (2 * Math.PI)) * 1024).toFixed(2)];
}
