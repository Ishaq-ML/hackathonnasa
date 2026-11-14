const base = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

// Continuous date windows and tile matrix sets from the NASA GIBS WMTS catalog.
export const imagery = {
  radar: {
    title: 'NISAR radar', id: 'NISAR_L2_Geocoded_Polarimetric_Covariance', zoom: 13,
    first: '2026-08-10', latest: '2026-11-11',
    description: 'False-color radar browse imagery. Dark or blank areas can be outside that day’s radar coverage. Compare dated scenes in the detailed cases.',
    source: ['ASF · NISAR imagery and color interpretation', 'https://nisar-docs.asf.alaska.edu/worldview/'],
  },
  rain: {
    title: 'Rainfall', id: 'IMERG_Precipitation_Rate', zoom: 6,
    first: '2026-05-27', latest: '2026-11-13',
    description: 'NASA IMERG daily mean precipitation rate. Use this for rainfall context around flood reports.',
    source: ['NASA · IMERG precipitation', 'https://gpm.nasa.gov/data/imerg'],
  },
  snow: {
    title: 'Snow cover', id: 'MODIS_Terra_NDSI_Snow_Cover', zoom: 8,
    first: '2022-10-23', latest: '2026-11-14',
    description: 'Optical snow detection. Clouds can obscure the surface. Annual mass balance is available at monitored glacier points.',
    source: ['NASA NSIDC · MODIS daily snow cover', 'https://nsidc.org/data/mod10a1/versions/61'],
  },
};

export function drawImagery(map, layer, date) {
  if (!layer) return;
  const url = `${base}/${layer.id}/default/${date}/GoogleMapsCompatible_Level${layer.zoom}/{z}/{y}/{x}.png`;
  map.addSource('satellite-context', { type: 'raster', tiles: [url], tileSize: 256,
    maxzoom: layer.zoom, attribution: 'NASA GIBS' });
  map.addLayer({ id: 'satellite-context', type: 'raster', source: 'satellite-context',
    minzoom: layer === imagery.radar ? 4 : 0,
    paint: { 'raster-opacity': .83, 'raster-fade-duration': 0 },
  });
}
