import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { feature } from 'topojson-client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { observations } from './cases.js';

maplibregl.setWorkerUrl(workerUrl);

const asset = file => new URL(`${import.meta.env.BASE_URL}data/${file}`, location.origin).href;
const byId = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const getQuery = () => new URLSearchParams(location.search);
const selectedFromUrl = () => observations.find(item => item.id === getQuery().get('case')) || observations.find(item => item.hazard === 'Earthquakes');
const modeFromUrl = item => item.modes.find(mode => mode.id === getQuery().get('layer'))?.id || item.modes[0].id;
let current = selectedFromUrl();
let mode = modeFromUrl(current);
let map;
let popup;
let markers = [];
let overlay;
let mapReady = false;
let quakePromise;
const grids = new Map();
let updateVersion = 0;
let focusedCase;

const background = { version:8, sources:{}, layers:[{id:'water',type:'background',paint:{'background-color':'#101924'}}] };
const attribution = 'NASA GIBS / Blue Marble · NASA JPL/ARIA · USGS · Natural Earth';
const search = byId('search');
const searchResults = byId('search-results');

function selectCase(id) {
  const found = observations.find(item => item.id === id);
  if (!found || found === current) return;
  current = found;
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
  searchResults.innerHTML = matches.length ? matches.map(item =>
    `<button class="search-result" type="button" data-id="${item.id}">${item.place} · ${item.short}</button>`
  ).join('') : '<p class="empty">No observations for this place.</p>';
}
search.addEventListener('input', renderSearch);
search.addEventListener('keydown', event => {
  if (event.key === 'Enter') searchResults.querySelector('button')?.click();
  if (event.key === 'Escape') { search.value = ''; renderSearch(); }
});
function selectFromButton(event) {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  selectCase(button.dataset.id);
  search.value = '';
  renderSearch();
  byId('case-heading').focus({preventScroll:true});
}
searchResults.addEventListener('click', selectFromButton);
byId('cases').addEventListener('click', selectFromButton);
window.addEventListener('popstate', () => {
  current = selectedFromUrl();
  mode = modeFromUrl(current);
  render();
});
function renderTabs() {
  const order=['Earthquakes','Floods','Glaciers'];
  byId('cases').innerHTML = order.map(hazard => {
    const item=observations.find(entry => entry.hazard === hazard);
    return `<button class="tab" type="button" data-id="${item.id}" aria-current="${item===current}">${hazard}</button>`;
  }).join('');
}

byId('map-controls').addEventListener('click', event => {
  const button = event.target.closest('[data-mode]');
  if (!button || button.dataset.mode === mode) return;
  mode = button.dataset.mode;
  setUrl(true);
  render();
  byId('map-controls').querySelector(`[data-mode="${mode}"]`)?.focus();
});
byId('evidence').addEventListener('click', event => {
  if (!event.target.closest('[data-sources]')) return;
  byId('reference-content').innerHTML = `<div class="label">Data and methods</div><h2>${current.place}</h2><p>${current.method}</p><ul>${
    current.sources.map(([label, url]) => `<li><a class="text-link" href="${url}" target="_blank" rel="noopener">${label}</a></li>`).join('')
  }</ul>`;
  byId('reference').showModal();
});

function setUrl(replace) {
  const url = new URL(location.href);
  url.searchParams.set('case',current.id);
  url.searchParams.set('layer',mode);
  history[replace ? 'replaceState' : 'pushState'](null,'',url);
}

function render() {
  renderTabs();
  const selected = current.modes.find(item => item.id === mode);
  byId('record').innerHTML = `<h2 tabindex="-1" id="case-heading">${current.place}</h2><p class="time">${selected.date ?? current.date}</p>`;
  byId('map-controls').innerHTML = current.modes.length > 1 ? current.modes.map(item => `<button type="button" data-mode="${item.id}" aria-pressed="${item.id===mode}">${item.label}</button>`).join('') : '';
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
}

function renderOverlay() {
  overlay?.remove();
  overlay = null;
  const selected = current.modes.find(item => item.id === mode);
  if (mode !== 'compare' && (!selected?.image || byId('map-fallback').hidden)) return;
  overlay = document.createElement('div');
  if (mode === 'compare') {
    overlay.className = 'photo-compare';
    overlay.innerHTML = `<img alt="Lower Limpopo on 17 December" src="${asset('flood-reference.webp')}"><div class="second"><img alt="Lower Limpopo during flooding on 25 January" src="${asset('flood-event.webp')}"></div><label class="swipe"><span>17 Dec · reference</span><input type="range" min="0" max="100" value="50" aria-label="Compare 17 December with 25 January"><span>25 Jan · flooding</span></label>`;
    overlay.querySelector('input').addEventListener('input', event => overlay.style.setProperty('--divider', `${event.target.value}%`));
  } else {
    overlay.className = 'single-photo';
    overlay.innerHTML = `<img alt="${current.title}" src="${asset(selected.image)}">`;
  }
  byId('map-frame').insertBefore(overlay, byId('map-controls'));
}

async function json(file) {
  const response = await fetch(asset(file));
  if (!response.ok) throw new Error(`Could not load ${file}`);
  return response.json();
}

async function startMap() {
  try {
    map = new maplibregl.Map({container:'map',style:background,center:[31,-24],zoom:6,attributionControl:false,maxPitch:0});
    map.addControl(new maplibregl.NavigationControl({showCompass:false}), 'top-right');
    map.addControl(new maplibregl.ScaleControl({unit:'metric'}), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({customAttribution:attribution,compact:true}), 'bottom-right');
    map.on('click', inspectPoint);
    await new Promise(resolve => map.once('load', resolve));
  } catch {
    byId('map-fallback').hidden = false;
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

async function updateMap() {
  const version = ++updateVersion;
  popup?.remove();
  markers.forEach(marker => marker.remove());
  markers = [];
  for (const id of ['scene','contours','regional-context']) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  const [[w,s],[e,n]] = current.bounds;
  if (focusedCase !== current.id) {
    focusedCase = current.id;
    map.fitBounds(current.bounds,{padding:{top:70,right:24,bottom:100,left:24},duration:0,maxZoom:11});
  }
  if (mode === 'compare') return;
  const contexts = {
    Earthquakes: ['ve', [-70, 8.1, -65, 12.65]],
    Floods: ['mo', [31.75, -26.2, 34.95, -23.6]],
    Glaciers: ['pi', [-107, -76.35, -95, -73.6]],
  };
  const [context, [cw, cs, ce, cn]] = contexts[current.hazard];
  map.addSource('regional-context',{type:'image',url:asset(`context-${context}.webp`),coordinates:[[cw,cn],[ce,cn],[ce,cs],[cw,cs]]});
  map.addLayer({id:'regional-context',source:'regional-context',type:'raster',paint:{'raster-fade-duration':0, 'raster-opacity':.92}});
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

async function inspectPoint(event) {
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
