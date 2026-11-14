import * as maplibregl from 'maplibre-gl';
import { feature } from 'topojson-client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { observations } from './cases.js';

const asset = file => new URL(`${import.meta.env.BASE_URL}data/${file}`, location.origin).href;
const byId = id => document.getElementById(id);
const filters = ['All', 'Floods', 'Earthquakes', 'Glaciers'];
const colors = { Floods:'#267d8f', Earthquakes:'#bd723e', Glaciers:'#7391ac' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const getQuery = () => new URLSearchParams(location.search);
const selectedFromUrl = () => observations.find(item => item.id === getQuery().get('case')) || observations[0];
const modeFromUrl = item => item.modes.find(mode => mode.id === getQuery().get('layer'))?.id || item.modes[0].id;
const catalog = byId('catalog');
let current = selectedFromUrl();
let mode = modeFromUrl(current);
let filter = 'All';
let map;
let popup;
let markers = [];
let overlay;
let mapReady = false;
let quakePromise;
let numericPromise;
let updateVersion = 0;
let focusedCase;

const background = { version:8, sources:{}, layers:[{id:'water',type:'background',paint:{'background-color':'#d7e2de'}}] };
const attribution = 'NASA Earthdata GIBS · NASA JPL/ARIA · USGS · Natural Earth';

function closeCatalog() {
  catalog.classList.remove('is-open');
  byId('catalog-toggle').setAttribute('aria-expanded','false');
}
byId('catalog-toggle').addEventListener('click', event => {
  event.currentTarget.setAttribute('aria-expanded', String(catalog.classList.toggle('is-open')));
});
byId('search').addEventListener('input', renderCatalog);
byId('search').addEventListener('keydown', event => {
  if (event.key === 'Enter') byId('cases').querySelector('button')?.click();
});
window.addEventListener('popstate', () => {
  current = selectedFromUrl();
  mode = modeFromUrl(current);
  render();
});

function renderCatalog() {
  const query = normalize(byId('search').value.trim());
  const list = observations.filter(item =>
    (filter === 'All' || item.hazard === filter) &&
    normalize([item.place,item.location,...item.aliases].join(' ')).includes(query));
  byId('filters').innerHTML = filters.map(name => `<button type="button" class="filter" data-filter="${name}" aria-pressed="${filter===name}">${name}</button>`).join('');
  byId('cases').innerHTML = list.length ? list.map(item => `
    <button type="button" class="case" data-id="${item.id}" aria-current="${item===current}">
      <span class="case-type"><span class="chip-dot" style="--dot:${colors[item.hazard]}"></span>${item.hazard}</span>
      <strong>${item.place}</strong><span class="arrow" aria-hidden="true">↗</span><small>${item.short}</small>
    </button>`).join('') : '<p class="empty">No mapped observations match this search.</p>';
}

byId('filters').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  filter = button.dataset.filter;
  renderCatalog();
  byId('filters').querySelector(`[data-filter="${filter}"]`)?.focus();
});
byId('cases').addEventListener('click', event => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  current = observations.find(item => item.id === button.dataset.id);
  mode = current.modes[0].id;
  setUrl(false);
  closeCatalog();
  render();
  byId('case-heading').focus({preventScroll:true});
});
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
  renderCatalog();
  byId('record').innerHTML = `<div><div class="location">${current.location}</div><h2 tabindex="-1" id="case-heading">${current.title}</h2><p class="summary">${current.summary}</p></div><div class="time">${current.date}</div>`;
  byId('map-controls').innerHTML = current.modes.map(item => `<button type="button" data-mode="${item.id}" aria-pressed="${item.id===mode}">${item.label}</button>`).join('');
  byId('evidence').innerHTML = `<div class="evidence-details"><div class="label">Observation details</div><h3 id="point-title">${current.measurement}</h3><p id="point-copy" aria-live="polite">${current.evidence}</p></div><div class="evidence-actions"><button type="button" class="quiet" data-sources>Data &amp; methods ↗</button></div>`;
  byId('legend').innerHTML = mode === 'displacement' ? '<strong>Radar line-of-sight displacement</strong><div class="gradient"></div><div class="legend-values"><span>−50 cm</span><span>0</span><span>+50 cm</span></div>' :
    mode === 'shaking' ? '<strong>USGS shaking intensity</strong><br><span>Modified Mercalli (MMI)</span>' : mode === 'compare' ? '' :
    current.hazard === 'Floods' ? '<strong>False-color MODIS</strong><br><span>Water appears dark blue</span>' : '<strong>True-color MODIS</strong>';
  byId('map-note').textContent = mode === 'compare' ? '' :
    current.hazard === 'Floods' ? 'NASA Terra MODIS · 7 / 2 / 1' :
      current.hazard === 'Glaciers' ? 'NASA Terra MODIS · 14 Feb 2026' :
        mode === 'shaking' ? 'USGS ShakeMap · M7.5 event' : 'NASA JPL / ARIA · NISAR GUNW';
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
    map.addLayer({id:'land',type:'fill',source:'land',paint:{'fill-color':'#e9e9d9'}});
    map.addLayer({id:'borders',type:'line',source:'land',paint:{'line-color':'#aaa997','line-width':.7}});
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
  for (const id of ['scene','contours']) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  const [[w,s],[e,n]] = current.bounds;
  if (focusedCase !== current.id) {
    focusedCase = current.id;
    map.fitBounds(current.bounds,{padding:{top:54,right:33,bottom:48,left:33},duration:0,maxZoom:11});
  }
  if (mode === 'compare') return;
  const selected = current.modes.find(item => item.id === mode);
  if (selected?.image) {
    map.addSource('scene',{type:'image',url:asset(selected.image),coordinates:[[w,n],[e,n],[e,s],[w,s]]});
    map.addLayer({id:'scene',source:'scene',type:'raster',paint:{'raster-fade-duration':0,'raster-resampling':mode==='displacement'?'nearest':'linear'}});
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
  if (mode !== 'displacement') {
    showPoint(coords,point,mode==='shaking'?'Use the epicenter markers and MMI contours to inspect this event.':'Satellite imagery at this location. Open Data & methods for the acquisition and source.');
    return;
  }
  try {
    numericPromise ||= Promise.all([json('displacement.json'),fetch(asset('displacement.f32')).then(response=>{
      if (!response.ok) throw new Error('Grid could not load');
      return response.arrayBuffer();
    })]).catch(error=>{numericPromise=null;throw error});
    const [grid,buffer]=await numericPromise;
    if (version !== updateVersion) return;
    const rad=lat*Math.PI/180;
    const x=6378137*lng*Math.PI/180;
    const y=6378137*Math.asinh(Math.tan(rad));
    const [west,south,east,north]=grid.bounds;
    const col=Math.floor(grid.width*(x-west)/(east-west));
    const row=Math.floor(grid.height*(north-y)/(north-south));
    const value=row>=0&&row<grid.height&&col>=0&&col<grid.width ?
      new DataView(buffer).getFloat32(4*(row*grid.width+col),true) : NaN;
    showPoint(coords,Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(1)} cm`:'No valid radar measurement',point+' · 13–25 June 2026');
  } catch {
    if (version === updateVersion) showPoint(coords,'Displacement grid unavailable',point);
  }
}

render();
startMap();
