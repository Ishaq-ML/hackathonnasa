import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { feature } from 'topojson-client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { observations } from './cases.js';
import { worldExplorer, globalFloodDate } from './world.js';

maplibregl.setWorkerUrl(workerUrl);

const asset = file => new URL(`${import.meta.env.BASE_URL}data/${file}`, location.origin).href;
const byId = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const getQuery = () => new URLSearchParams(location.search);
const hazards = ['Earthquakes','Floods','Glaciers'];
const selectedFromUrl = () => observations.find(item => item.id === getQuery().get('case')) ?? null;
const hazardFromUrl = () => hazards.find(item => item.toLowerCase() === getQuery().get('hazard')) ?? 'Earthquakes';
const modeFromUrl = item => item.modes.find(mode => mode.id === getQuery().get('layer'))?.id || item.modes[0].id;
let current = selectedFromUrl();
let hazard = current?.hazard ?? hazardFromUrl();
let mode = current ? modeFromUrl(current) : null;
let minMagnitude = 4;
let floodDate = globalFloodDate;
let floodTiles = false;
let map;
let popup;
let markers = [];
let overlay;
let mapReady = false;
let mapUnavailable = false;
let fallbackVersion = 0;
let quakePromise;
const grids = new Map();
let updateVersion = 0;
let focusedCase;

const background = { version:8, sources:{}, layers:[{id:'water',type:'background',paint:{'background-color':'#101924'}}] };
const attribution = 'NASA GIBS / Blue Marble · NASA JPL/ARIA · USGS · Natural Earth';
const search = byId('search');
const searchResults = byId('search-results');
const world = worldExplorer({
  json, chooseCase:selectCase,
  onChange() {
    if (!current) { renderWorldCard(); renderSearch(); }
  },
  inspect:showWorldPoint
});
function selectWorld(nextHazard) {
  if (hazard === nextHazard && !current) return;
  hazard = nextHazard;
  current = null;
  mode = null;
  search.value = '';
  renderSearch();
  setUrl(false);
  render();
}
function renderWorldCard() {
  const info = world.info(hazard,minMagnitude,floodDate);
  byId('record').innerHTML = `<h2 tabindex="-1" id="case-heading">${info.label}</h2><p class="time">${info.caption}</p>`;
  byId('evidence').innerHTML = `<div class="evidence-details"><h3 id="point-title" hidden></h3><p id="point-copy" aria-live="polite">${info.hint}</p></div><button type="button" class="quiet" data-sources>Sources</button>`;
}

function selectCase(id) {
  const found = observations.find(item => item.id === id);
  if (!found || found === current) return;
  current = found;
  hazard = current.hazard;
  mode = current.modes[0].id;
  setUrl(false);
  search.value = '';
  renderSearch();
  render();
}
function renderSearch() {
  const query = normalize(search.value.trim());
  searchResults.hidden = !query;
  if (!query) return;
  const matches = observations.filter(item => normalize([item.place,item.location,...item.aliases].join(' ')).includes(query));
  const regionMatches = world.find(hazard, query, normalize);
  const buttons = [
    ...matches.map(item => `<button class="search-result" type="button" data-id="${item.id}">${item.place} · detailed case</button>`),
    ...regionMatches.map(item => `<button class="search-result" type="button" data-entry="${escape(item.id)}">${escape(item.name)}</button>`),
  ];
  searchResults.innerHTML = buttons.join('') || '<p class="empty">No matching observations in this tab.</p>';
}
search.addEventListener('input', renderSearch);
search.addEventListener('keydown', event => {
  if (event.key === 'Enter') searchResults.querySelector('button')?.click();
  if (event.key === 'Escape') { search.value = ''; renderSearch(); }
});
searchResults.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.id) selectCase(button.dataset.id);
  if (button.dataset.entry && mapReady) {
    const id = button.dataset.entry;
    if (current) selectWorld(hazard);
    world.open(hazard,id,map).catch(() => {});
  } else if (button.dataset.entry && mapUnavailable) {
    const item = world.visibleItems(hazard,0).find(row=>row.id===button.dataset.entry);
    if (item) showFallbackDetail(world.details(hazard,item));
  }
  search.value = '';
  renderSearch();
  byId('case-heading')?.focus({preventScroll:true});
});
byId('cases').addEventListener('click', event => {
  const button = event.target.closest('[data-hazard]');
  if (!button) return;
  selectWorld(button.dataset.hazard);
  byId('cases').querySelector('[aria-current=true]')?.focus({preventScroll:true});
});
window.addEventListener('popstate', () => {
  current = selectedFromUrl();
  hazard = current?.hazard ?? hazardFromUrl();
  mode = current ? modeFromUrl(current) : null;
  render();
});
function renderTabs() {
  byId('cases').innerHTML = hazards.map(item =>
    `<button class="tab" type="button" data-hazard="${item}" aria-current="${item===hazard}">${item}</button>`
  ).join('');
}
byId('map-controls').addEventListener('change', event => {
  if (event.target.id === 'magnitude') minMagnitude = Number(event.target.value);
  else if (event.target.id === 'flood-date' && event.target.value) floodDate = event.target.value;
  else return;
  if (!current) {
    renderWorldCard();
    if (mapReady) updateMap();
    if (mapUnavailable) drawFallback();
  }
});

byId('map-controls').addEventListener('click', event => {
  if (event.target.closest('[data-world]')) {
    selectWorld(hazard);
    return;
  }
  if (event.target.closest('[data-flood-tiles]')) {
    floodTiles = !floodTiles;
    render();
    if (floodTiles && mapReady && map.getZoom() < 5) {
      byId('point-copy').textContent = 'Zoom in to see the VIIRS flood composite.';
    }
    byId('map-controls').querySelector('[data-flood-tiles]')?.focus();
    return;
  }
  const localCase = event.target.closest('[data-open-case]');
  if (localCase) { selectCase(localCase.dataset.openCase); return; }
  const button = event.target.closest('[data-mode]');
  if (!button || button.dataset.mode === mode) return;
  mode = button.dataset.mode;
  setUrl(true);
  render();
  byId('map-controls').querySelector(`[data-mode="${mode}"]`)?.focus();
});
byId('evidence').addEventListener('click', event => {
  if (!event.target.closest('[data-sources]')) return;
  const source = current ?? {...world.info(hazard,minMagnitude,floodDate),place:hazard};
  byId('reference-content').innerHTML = `<div class="label">Data and methods</div><h2>${source.place}</h2><p>${source.method}</p><ul>${
    source.sources.map(([label, url]) => `<li><a class="text-link" href="${url}" target="_blank" rel="noopener">${label}</a></li>`).join('')
  }</ul>`;
  byId('reference').showModal();
});

function setUrl(replace) {
  const url = new URL(location.href);
  url.searchParams.set('hazard',hazard.toLowerCase());
  if (current) {
    url.searchParams.set('case',current.id);
    url.searchParams.set('layer',mode);
  } else {
    url.searchParams.delete('case');
    url.searchParams.delete('layer');
  }
  history[replace ? 'replaceState' : 'pushState'](null,'',url);
}

function render() {
  renderTabs();
  if (!current) {
    renderWorldCard();
    const options = [2.5,4,5,6].map(value => `<option value="${value}"${value===minMagnitude?' selected':''}>M${value.toFixed(1)}+</option>`).join('');
    const controls = {
      Earthquakes:`<label class="control">Magnitude <select id="magnitude">${options}</select></label>`,
      Floods:`<button type="button" data-open-case="guelma-nisar">Guelma comparison</button><button type="button" data-flood-tiles aria-pressed="${floodTiles}">Satellite layer</button>${floodTiles?`<label class="control">Date <input id="flood-date" type="date" min="2025-04-01" max="${globalFloodDate}" value="${floodDate}"></label>`:''}`,
      Glaciers:'',
    };
    byId('map-controls').innerHTML = controls[hazard];
    const legends = {
      Earthquakes:'<div class="key-list"><span><i style="--key:#f0ae70;border-radius:50%"></i> Earthquake / cluster</span><span>◎ Detailed NISAR case</span></div>',
      Floods:'<div class="key-list"><span><i style="--key:#65c5fa;border-radius:50%"></i> GDACS flood report</span>'
        + (floodTiles ? '<span><i style="--key:#fa1e24"></i> Flood <i style="--key:#32d2f5"></i> Surface water</span><span><i style="--key:#ffff00"></i> Recurring flood <i style="--key:#afafaf"></i> Insufficient data</span>' : '')
        + '<span>◎ Detailed flood case</span></div>',
      Glaciers:'<div class="key-list"><span><i style="--key:#f39678"></i> Latest annual loss</span><span><i style="--key:#93bef5"></i> Latest zero or gain</span><span>◎ Detailed ice imagery</span></div>',
    };
    byId('legend').innerHTML = legends[hazard];
    byId('map-note').textContent = '';
    renderOverlay();
    if (mapReady) updateMap();
    if (mapUnavailable) drawFallback();
    return;
  }
  const selected = current.modes.find(item => item.id === mode);
  byId('record').innerHTML = `<h2 tabindex="-1" id="case-heading">${current.place}</h2><p class="time">${selected.date ?? current.date}</p>`;
  byId('map-controls').innerHTML = '<button type="button" data-world>← Worldwide</button>' +
    (current.modes.length > 1 ? current.modes.map(item => `<button type="button" data-mode="${item.id}" aria-pressed="${item.id===mode}">${item.label}</button>`).join('') : '');
  byId('evidence').innerHTML = `<div class="evidence-details"><h3 id="point-title">${selected.label}</h3><p id="point-copy" aria-live="polite">${selected.hint ?? current.evidence}</p></div><button type="button" class="quiet" data-sources>Sources</button>`;
  const legends = {
    displacement: '<strong>Displacement · cm</strong><div class="gradient"></div><div class="legend-values"><span>−50</span><span>0</span><span>+50</span></div>',
    shaking: '<strong>Shaking · MMI</strong>',
    extent: '<div class="key-list"><span><i style="--key:#ff7957"></i> Flood detected</span><span><i style="--key:#57b9f0"></i> Surface water</span><span><i style="--key:#f0d15f"></i> Recurring flood</span><span><i style="--key:#a5abb2"></i> Insufficient data</span></div>',
  };
  byId('legend').innerHTML = legends[mode] ?? '';
  byId('map-note').textContent = '';
  renderOverlay();
  if (mapReady) updateMap();
  if (mapUnavailable) drawFallback();
}

function renderOverlay() {
  overlay?.remove();
  overlay = null;
  if (!current) return;
  const selected = current.modes.find(item => item.id === mode);
  if (!selected?.compare && (!selected?.image || !mapUnavailable)) return;
  overlay = document.createElement('div');
  if (selected.compare) {
    const [first,second] = selected.compare;
    overlay.className = 'photo-compare';
    overlay.innerHTML = `<img alt="${escape(current.place)} · ${escape(first.label)}" src="${asset(first.image)}"><div class="second"><img alt="${escape(current.place)} · ${escape(second.label)}" src="${asset(second.image)}"></div><label class="swipe"><span>${escape(first.label)}</span><input type="range" min="0" max="100" value="50" aria-label="Compare ${escape(first.label)} with ${escape(second.label)}"><span>${escape(second.label)}</span></label>`;
    overlay.querySelector('input').addEventListener('input', event => overlay.style.setProperty('--divider', `${event.target.value}%`));
  } else {
    overlay.className = 'single-photo';
    overlay.innerHTML = `<img alt="${current.title}" src="${asset(selected.image)}">`;
  }
  byId('map-frame').insertBefore(overlay, byId('map-controls').parentElement);
}

async function json(file) {
  const response = await fetch(asset(file));
  if (!response.ok) throw new Error(`Could not load ${file}`);
  return response.json();
}

async function startMap() {
  try {
    map = new maplibregl.Map({container:'map',style:background,center:[31,-24],zoom:6,attributionControl:false,maxPitch:0,minZoom:-.1});
    map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
    map.addControl(new maplibregl.ScaleControl({unit:'metric'}), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({customAttribution:attribution,compact:true}), 'bottom-right');
    map.on('click', inspectPoint);
    await new Promise(resolve => map.once('load', resolve));
  } catch {
    mapUnavailable = true;
    drawFallback();
    renderOverlay();
    return;
  }
  mapReady = true;
  try {
    const topology = await json('world.json');
    map.addSource('land', {type:'geojson',data:feature(topology,topology.objects.countries)});
    map.addLayer({id:'land',type:'fill',source:'land',paint:{'fill-color':'#242e38'}});
    map.addLayer({id:'borders',type:'line',source:'land',paint:{'line-color':'#4d5864','line-width':.7}});

  } catch (error) {
    console.error(error);
  }
  updateMap();
}

function showFallbackDetail(item) {
  const title = byId('point-title');
  title.hidden = false;
  title.textContent = item.title;
  const description = byId('point-copy');
  description.textContent = item.description;
  for (const [label,url] of item.links) {
    const link = document.createElement('a');
    link.className = 'provider-link';
    link.textContent = label;
    link.href = url;
    description.append(link);
  }
}

let worldOutline;
async function drawFallback() {
  const version = ++fallbackVersion;
  const panel = byId('map-fallback');
  panel.hidden = Boolean(current);
  if (current) return;
  const selected = hazard;
  try {
    worldOutline ||= json('world.json').then(topology=>feature(topology,topology.objects.countries));
    const [land] = await Promise.all([worldOutline,world.load(selected)]);
    if (version !== fallbackVersion || current) return;
    renderWorldCard();
    renderSearch();
    const project = ([lon,lat]) => [((lon+180)*2).toFixed(1), ((88-lat)*2).toFixed(1)];
    const path = rings => rings.map(ring=>ring.map((p,i)=>(i?'L':'M')+project(p).join(',')).join('')+'Z').join('');
    const countries = land.features.map(({geometry})=>geometry.type==='Polygon' ? path(geometry.coordinates)
      : geometry.coordinates.map(path).join('')).join('');
    const markers = world.visibleItems(selected,minMagnitude).map(item=>{
      const [x,y]=project(item.coords);
      const color=selected==='Glaciers'
        ? (item.balances.at(-1)[1]<0?'#f39678':'#93bef5')
        : selected==='Floods'?'#65c5fa':'#f0ae70';
      return `<circle data-entry="${escape(item.id)}" cx="${x}" cy="${y}" r="${selected==='Earthquakes'?2:3}" fill="${color}"><title>${escape(item.name)}</title></circle>`;
    }).join('');
    const samples = observations.filter(item=>item.hazard===selected).map(item=>{
      const [[w,s],[e,n]]=item.bounds;
      const [x,y]=project([(w+e)/2,(s+n)/2]);
      return `<circle data-case="${item.id}" cx="${x}" cy="${y}" r="5" fill="#171c23" stroke="#fff" stroke-width="2"><title>${escape(item.place)} · detailed case</title></circle>`;
    }).join('');
    panel.innerHTML = `<svg viewBox="0 0 720 352" aria-label="${escape(selected)} world map"><path fill="#25303c" stroke="#465768" stroke-width=".45" fill-rule="evenodd" d="${countries}"></path>${markers}${samples}</svg>`;
    if (selected==='Floods' && floodTiles) byId('map-note').textContent='The satellite tile layer requires WebGL.';
  } catch {
    if (version === fallbackVersion) panel.textContent='The observation catalog could not load.';
  }
}
byId('map-fallback').addEventListener('click',event=>{
  if (event.target.dataset.case) selectCase(event.target.dataset.case);
  const hit = world.visibleItems(hazard,minMagnitude).find(item=>item.id===event.target.dataset.entry);
  if (hit) showFallbackDetail(world.details(hazard,hit));
});

async function updateMap() {
  const version = ++updateVersion;
  popup?.remove();
  world.remove(map);
  markers.forEach(marker => marker.remove());
  markers = [];
  for (const id of ['scene','contours','regional-context']) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  if (!current) {
    if (focusedCase !== 'world') {
      focusedCase = 'world';
      const width = map.getContainer().clientWidth;
      map.jumpTo({center:[0,16],zoom:Math.max(-.1,Math.min(2,Math.log2(width/525)))});
    }
    world.draw(map,hazard,minMagnitude,floodDate,observations.filter(entry=>entry.hazard===hazard),floodTiles)
      .catch(() => { if (version === updateVersion) byId('map-note').textContent='The observation catalog could not load.'; });
    return;
  }
  const [[w,s],[e,n]] = current.bounds;
  if (focusedCase !== current.id) {
    focusedCase = current.id;
    map.fitBounds(current.bounds,{padding:{top:70,right:24,bottom:100,left:24},duration:0,maxZoom:11});
  }
  if (mode === 'compare') return;
  const contexts = {
    'venezuela-earthquakes': ['ve', [-70, 8.1, -65, 12.65]],
    'mozambique-floods': ['mo', [31.75, -26.2, 34.95, -23.6]],
    'pine-island-glacier': ['pi', [-107, -76.35, -95, -73.6]],
  };
  const region = contexts[current.id];
  if (region) {
    const [context, [cw, cs, ce, cn]] = region;
    map.addSource('regional-context',{type:'image',url:asset(`context-${context}.webp`),coordinates:[[cw,cn],[ce,cn],[ce,cs],[cw,cs]]});
    map.addLayer({id:'regional-context',source:'regional-context',type:'raster',paint:{'raster-fade-duration':0, 'raster-opacity':.92}});
  }
  const selected = current.modes.find(item => item.id === mode);
  if (selected?.image) {
    map.addSource('scene',{type:'image',url:asset(selected.image),coordinates:[[w,n],[e,n],[e,s],[w,s]]});
    map.addLayer({id:'scene',source:'scene',type:'raster',paint:{'raster-fade-duration':0,'raster-opacity':mode==='displacement'?.84:1,'raster-resampling':['displacement','extent'].includes(mode)?'nearest':'linear'}});
  }
  for (const [lng,lat,label] of current.markers) {
    const element=document.createElement('div');
    element.className='place-marker';
    element.textContent=label;
    markers.push(new maplibregl.Marker({element,anchor:'left'}).setLngLat([lng,lat]).addTo(map));
  }
  if (current.hazard !== 'Earthquakes') return;
  try {
    if (mode === 'shaking') {
      const contours = await json('shaking.json');
      if (version !== updateVersion) return;
      map.addSource('contours',{type:'geojson',data:contours});
      map.addLayer({id:'contours',type:'line',source:'contours',paint:{'line-color':['coalesce',['get','color'],'#b46537'],'line-width':2.4}});
    }
    quakePromise ||= json('events.json').catch(error => {quakePromise=null; throw error});
    const data=await quakePromise;
    if (version !== updateVersion) return;
    for (const event of data.features) {
      const info=event.properties;
      const button=document.createElement('button');
      button.type='button';
      button.className='epicenter';
      button.title=`M${info.mag} · ${info.place}`;
      button.textContent=`M${info.mag}`;
      button.addEventListener('click', e=>{
        e.stopPropagation();
        const date=new Date(info.time).toISOString().replace('T',' ').slice(0,16);
        showPoint(event.geometry.coordinates.slice(0,2),`M${info.mag} earthquake`,`${info.place} · ${info.depth} km deep · ${date} UTC`);
      });
      markers.push(new maplibregl.Marker({element:button}).setLngLat(event.geometry.coordinates.slice(0,2)).addTo(map));
    }
  } catch (error) {
    if (version === updateVersion) byId('map-note').textContent='An observation layer could not be loaded.';
    console.error(error);
  }
}

function showPoint(coords,title,copy) {
  byId('point-title').textContent=title;
  byId('point-copy').textContent=copy;
  popup?.remove();
  popup=new maplibregl.Popup({offset:8,maxWidth:'240px'}).setLngLat(coords)
    .setHTML(`<strong>${escape(title)}</strong><p>${escape(copy)}</p>`).addTo(map);
}

function showWorldPoint(coords, item) {
  if (current) return;
  const title = byId('point-title');
  title.hidden = false;
  showPoint(coords,item.title,item.description);
  const content = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = item.title;
  const detail = document.createElement('p');
  detail.textContent = item.description;
  content.append(name, detail);
  if (item.balances?.length) {
    const history = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Annual history · m w.e.';
    const list = document.createElement('ul');
    for (const [year, value] of [...item.balances].reverse()) {
      const row = document.createElement('li');
      row.textContent = `${year} · ${value > 0 ? '+' : ''}${value.toFixed(2)}`;
      list.append(row);
    }
    history.append(summary,list);
    content.append(history);
  }
  for (const [label, url] of item.links) {
    const link = document.createElement('a');
    link.textContent = label;
    link.className = 'provider-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    content.append(link);
  }
  popup.setDOMContent(content);
}

async function inspectPoint(event) {
  if (!current) return world.click(event);
  const version = updateVersion;
  const {lng,lat}=event.lngLat;
  const coords=[lng,lat];
  const [[w,s],[e,n]]=current.bounds;
  const point=`${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;
  if (lng < w || lng > e || lat < s || lat > n) {
    showPoint(coords,'Outside the observation',point);
    return;
  }
  if (!['displacement','extent'].includes(mode)) {
    showPoint(coords,point,mode==='shaking'?'Use the epicenter markers and MMI contours to inspect this event.':'Satellite imagery at this location. Open Data & methods for the acquisition and source.');
    return;
  }
  try {
    const isFlood = mode === 'extent';
    const key = isFlood ? 'flood-extent' : 'displacement';
    if (!grids.has(key)) {
      const loadGrid = Promise.all([json(key + '.json'), fetch(asset(key + (isFlood ? '.u8' : '.f32'))).then(response => {
        if (!response.ok) throw new Error('Grid could not load');
        return response.arrayBuffer();
      })]).catch(error => { grids.delete(key); throw error; });
      grids.set(key, loadGrid);
    }
    const [grid,buffer] = await grids.get(key);
    if (version !== updateVersion) return;
    const rad=lat*Math.PI/180;
    const x=6378137*lng*Math.PI/180;
    const y=6378137*Math.asinh(Math.tan(rad));
    const [west,south,east,north]=grid.bounds;
    const col=Math.floor(grid.width*(x-west)/(east-west));
    const row=Math.floor(grid.height*(north-y)/(north-south));
    const index = row>=0 && row<grid.height && col>=0 && col<grid.width ? row*grid.width+col : -1;
    const view = new DataView(buffer);
    if (isFlood) {
      const classes = ['No visible flood class', 'Surface water', 'Recurring flood', 'Flood detected', 'Insufficient data'];
      showPoint(coords, classes[index < 0 ? 0 : view.getUint8(index)], point + ' · NASA VIIRS · 23–25 Jan 2026');
    } else {
      const value = index < 0 ? NaN : view.getFloat32(4*index,true);
      showPoint(coords, Number.isFinite(value) ? `${value>0?'+':''}${value.toFixed(1)} cm` : 'No valid radar measurement', point + ' · 13–25 June 2026');
    }
  } catch {
    if (version === updateVersion) showPoint(coords,'Measurement unavailable',point);
  }
}

render();
startMap();
