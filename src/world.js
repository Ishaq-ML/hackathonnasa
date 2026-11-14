const definitions = {
  Earthquakes: {
    file: 'world-quakes.json', label: 'Earthquakes worldwide', color: '#f0ae70',
    source: ['USGS earthquake catalog', 'https://earthquake.usgs.gov/earthquakes/map/'],
    hint: 'Select an epicenter for magnitude and depth.',
  },
  Floods: {
    file: 'world-floods.json', label: 'Flood reports worldwide', color: '#65c5fa',
    source: ['GDACS flood reports', 'https://www.gdacs.org/'],
    hint: 'Select a report or zoom in for the satellite layer.',
  },
  Glaciers: {
    file: 'world-glaciers.json', label: 'Glacier measurements worldwide', color: '#98c4fb',
    source: ['WGMS glacier database · February 2026', 'https://doi.org/10.5904/wgms-fog-2026-02-10'],
    hint: 'Select a monitored glacier for its annual mass balance.',
  },
};

export const globalFloodDate = '2026-11-13';
const namedDay = input => new Date(input).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
});
export const dateLabel = namedDay;
const signed = value => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
const floodTiles = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Combined_Flood_3-Day/default/';
const floodSource = ['NASA LANCE · VIIRS flood classifications','https://lance.modaps.eosdis.nasa.gov/flood/'];

function itemsFrom(hazard, rows) {
  return rows.map(row => {
    const [id, lon, lat, a, b, c, d] = row;
    const entry = { id, coords: [lon, lat] };
    if (hazard === 'Earthquakes') {
      return { ...entry, time: c, name: d, depth: a, magnitude: b, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}` };
    }
    if (hazard === 'Floods') {
      return { ...entry, name:a, start:b, end:c, alert:d, url:`https://www.gdacs.org/report.aspx?eventtype=FL&eventid=${id}` };
    }
    return { ...entry, name:a, country:b, balances:c, url:definitions.Glaciers.source[1] };
  });
}

export function worldExplorer({ json, inspect, chooseCase, onChange }) {
  const catalogs = new Map();
  const pending = new Map();
  let currentMap;
  let layerHazard;
  let entries = new Map();
  const dataSource = 'world-observations';
  const sampleSource = 'world-cases';
  const layers = ['world-markers', 'world-clusters', 'world-cases-ring', 'world-cases-dot', 'world-flood-raster'];

  async function load(hazard) {
    if (catalogs.has(hazard)) return catalogs.get(hazard);
    if (!pending.has(hazard)) pending.set(hazard, json(definitions[hazard].file).then(raw => {
      const data = { ...raw, items: itemsFrom(hazard, raw.items) };
      catalogs.set(hazard, data);
      return data;
    }).finally(() => pending.delete(hazard)));
    return pending.get(hazard);
  }

  function visibleItems(hazard, minMagnitude) {
    const all = catalogs.get(hazard)?.items ?? [];
    return hazard === 'Earthquakes' ? all.filter(q => q.magnitude >= minMagnitude) : all;
  }

  function details(hazard, item) {
    if (hazard === 'Earthquakes') {
      const time = new Date(item.time).toISOString().slice(0, 16).replace('T', ' ');
      return {
        title: `M${item.magnitude.toFixed(1)} earthquake`,
        description: `${item.name} · ${item.depth.toFixed(1)} km deep · ${time} UTC`,
        links: [['USGS event', item.url]],
      };
    }
    if (hazard === 'Floods') return {
      title: `Flood report · ${item.name}`,
      description: `${namedDay(item.start)} – ${namedDay(item.end)} · GDACS report location`,
      links: [['Open GDACS report', item.url]],
    };
    const [year, value] = item.balances.at(-1);
    return {
      title: item.name,
      description: `${year} · ${signed(value)} m water equivalent`,
      links: [definitions.Glaciers.source],
      balances: item.balances,
    };
  }

  function info(hazard, minMagnitude, date) {
    const base = definitions[hazard];
    const catalog = catalogs.get(hazard);
    const count = visibleItems(hazard, minMagnitude).length;
    const notes = {
      Earthquakes: catalog ? `${count.toLocaleString()} earthquakes · 30 days to ${namedDay(catalog.updated)} · M${minMagnitude.toFixed(1)}+` : 'USGS · recent earthquakes',
      Floods: catalog ? `${count} recent GDACS reports · NASA imagery through ${namedDay(date)}` : `NASA imagery through ${namedDay(date)}`,
      Glaciers: catalog ? `${count} glaciers with reported annual mass balance since 2000` : 'World Glacier Monitoring Service',
    };
    return { ...base, caption: notes[hazard], count,
      sources: hazard === 'Floods' ? [base.source, floodSource] : [base.source],
      method: hazard === 'Earthquakes'
        ? 'This view maps the most recent 30 days of earthquakes in the bundled USGS catalog snapshot. Epicenter circles show location and magnitude.'
        : hazard === 'Floods'
          ? 'Points show locations in the bundled GDACS flood-report snapshot. The optional NASA VIIRS layer is a separate, dated three-day composite. Cloud-obscured areas may have insufficient data. Report locations and satellite detections can cover different dates.'
          : 'Points show sites in the WGMS Fluctuations of Glaciers database with annual mass-balance records since 2000. The most recent available year varies by glacier. A negative value means the glacier lost mass over that reporting year. Coverage is limited to the included monitoring records.',
    };
  }

  function remove(map) {
    for (const id of layers) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [dataSource,sampleSource,'world-flood']) if (map.getSource(id)) map.removeSource(id);
    currentMap = null;
    layerHazard = null;
    entries = new Map();
  }

  function draw(map, hazard, minMagnitude, date, cases, includeFloodTiles) {
    currentMap = map;
    layerHazard = hazard;
    const base = definitions[hazard];
    const items = visibleItems(hazard, minMagnitude);
    entries = new Map(items.map(item => [item.id, item]));
    const point = (coords, properties) => ({type:'Feature', geometry:{type:'Point', coordinates:coords},properties});
    if (hazard === 'Floods' && includeFloodTiles) {
      map.addSource('world-flood', {type:'raster', tiles:[`${floodTiles}${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`],
        tileSize:256,maxzoom:9,minzoom:3,attribution:'NASA GIBS · VIIRS'});
      map.addLayer({id:'world-flood-raster',type:'raster',source:'world-flood',minzoom:5,
        paint:{'raster-opacity':.8,'raster-fade-duration':0,'raster-resampling':'nearest'}});
    }
    const data = {type:'FeatureCollection', features:items.map(item => point(item.coords, {
      id:item.id, metric:item.magnitude ?? item.balances?.at(-1)?.[1] ?? 0,
    }))};
    map.addSource(dataSource,{type:'geojson', data, cluster:true,clusterRadius:25,clusterMaxZoom:4});
    map.addLayer({id:'world-clusters',type:'circle',source:dataSource,filter:['has','point_count'],
      paint:{'circle-color':base.color,'circle-radius':['step',['get','point_count'],6,10,9,40,13,120,17],
        'circle-opacity':.55,'circle-stroke-width':1,'circle-stroke-color':base.color}});
    map.addLayer({id:'world-markers',type:'circle',source:dataSource,filter:['!', ['has','point_count']],
      paint:{'circle-color':hazard === 'Glaciers'
        ? ['case',['<',['get','metric'],0],'#f39678','#93bef5'] : base.color,
        'circle-radius':hazard === 'Earthquakes' ? ['interpolate',['linear'],['get','metric'],2.5,3.5,7,9] : 5,
        'circle-opacity':.88,'circle-stroke-color':'#141b22','circle-stroke-width':1}});
    map.addSource(sampleSource,{type:'geojson',data:{type:'FeatureCollection',features:cases.map(item => {
      const [[w,s],[e,n]]=item.bounds;
      return point([(w+e)/2,(s+n)/2],{id:item.id});
    })}});
    map.addLayer({id:'world-cases-ring',type:'circle',source:sampleSource,
      paint:{'circle-color':'#171c23','circle-radius':9,'circle-stroke-width':2,'circle-stroke-color':'#eaf1fd'}});
    map.addLayer({id:'world-cases-dot',type:'circle',source:sampleSource,
      paint:{'circle-color':'#eaf1fd','circle-radius':3}});
    const activeSource = map.getSource(dataSource);
    return load(hazard).then(() => {
      if (currentMap !== map || layerHazard !== hazard || map.getSource(dataSource) !== activeSource) return;
      const updated = visibleItems(hazard,minMagnitude);
      entries = new Map(updated.map(item=>[item.id,item]));
      map.getSource(dataSource)?.setData({type:'FeatureCollection',features:updated.map(item => point(item.coords, {
        id:item.id,metric:item.magnitude ?? item.balances?.at(-1)?.[1] ?? 0,
      }))});
      onChange();
    });
  }

  async function click(event) {
    const map = currentMap;
    if (!map) return;
    const hit = map.queryRenderedFeatures([
      [event.point.x-6,event.point.y-6],[event.point.x+6,event.point.y+6]
    ],{layers:layers.filter(id=>id !== 'world-flood-raster' && map.getLayer(id))})[0];
    if (!hit) {
      if (layerHazard === 'Floods' && map.getLayer('world-flood-raster') && map.getZoom() < 5) {
        inspect(event.lngLat.toArray(),{title:'Zoom in to see flood detections',description:'NASA VIIRS · three-day satellite composite',links:[floodSource]});
      }
      return;
    }
    const { id, cluster_id } = hit.properties;
    const longitude = event.lngLat.lng;
    const near = ([lng,lat]) => [lng+360*Math.round((longitude-lng)/360),lat];
    const center = near(hit.geometry.coordinates);
    if (hit.layer.id.startsWith('world-cases')) {
      chooseCase(id);
    } else if (cluster_id !== undefined) {
      try {
        const zoom = await map.getSource(dataSource).getClusterExpansionZoom(cluster_id);
        if (currentMap === map) map.easeTo({center,zoom});
      } catch {}
    } else if (entries.has(id)) {
      inspect(center,details(layerHazard,entries.get(id)));
    }
  }

  function find(hazard, query, normalize) {
    if (!query) return [];
    return (catalogs.get(hazard)?.items ?? []).filter(item => normalize(item.name).includes(query)).slice(0,7);
  }

  async function open(hazard, id, map) {
    const data = await load(hazard);
    const item = data.items.find(record=>record.id===id);
    if (!item || layerHazard !== hazard) return;
    map.easeTo({center:item.coords,zoom:Math.max(map.getZoom(),6)});
    inspect(item.coords,details(hazard,item));
  }

  return { info, draw, remove, click, find, open, load, details, visibleItems };
}
