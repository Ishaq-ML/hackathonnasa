import { observations } from './cases.js';
import { imagery } from './imagery.js';

export const normalize = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const hazardTerms = {
  Earthquakes: /\b(quakes?|earthquakes?|seismic|epicenters?)\b/,
  Floods: /\b(floods?|flooding|inundation|floodwater|viirs)\b/,
  Glaciers: /\b(glaciers?|melting|thinning|mass balance|ice)\b/,
};

const matchesPhrase = (question, phrase) => {
  const normalized = normalize(phrase);
  return (` ${question.replace(/[.,?!]/g, ' ')} `).replace(/\s+/g, ' ').includes(` ${normalized.replace(/[,]/g, '')} `);
};

const places = observations.map(item => ({
  item,
  names: [item.place.split(',')[0], ...item.aliases]
    .filter(value => !/^(algeria|algérie|الجزائر|glaciers?|earthquakes?|quakes?|flood|ice loss|thinning|wetland)$/.test(value)),
}));

const methods = [
  [/\b(groundwater|grace|subsidence)\b/, 'GRACE estimates changes in total water storage, including groundwater, soil moisture, snow and surface water. At city scale, use repeated InSAR and independent ground measurements for subsidence.', 'GRACE data catalog', 'https://developers.google.com/earth-engine/datasets/catalog/NASA_GRACE_MASS_GRIDS_V04_MASCON_CRI'],
  [/\b(melting|thinning|ice loss|mass balance)\b/, 'WGMS annual mass balance describes glacier mass gained or lost, expressed in meters of water equivalent. ICESat-2 measures surface height. Radar feature tracking measures ice speed. The three quantities answer different questions.', 'WGMS data', 'https://wgms.ch/data_database/'],
  [/\b(chirps|rainfall|rain rate)\b/, 'CHIRPS estimates past rainfall. A flood forecast needs weather or discharge forecasts available at issue time and verification against later observations.', 'CHIRPS data catalog', 'https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHC_CHIRPS_DAILY'],
  [/\b(earth engine|sentinel-1|backscatter)\b/, 'Sentinel-1 GRD records radar backscatter. Match the relative orbit, pass, mode and polarization before comparing acquisitions. Dark pixels can also be smooth ground or radar shadow.', 'Sentinel-1 Earth Engine catalog', 'https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S1_GRD'],
];

export async function answerMapQuestion(question, view, tools) {
  const q = normalize(question.trim());
  if (/\b(predict|forecast|warning|will .* happen|will .* flood)\b/.test(q)) {
    const earthquake = hazardTerms.Earthquakes.test(q) || (view.hazard === 'Earthquakes' && !hazardTerms.Floods.test(q) && !hazardTerms.Glaciers.test(q));
    return { text: 'TerraPulse shows dated observations. No validated forecast is available in this app.',
      links: earthquake ? [['USGS earthquake prediction FAQ', 'https://www.usgs.gov/faqs/can-you-predict-earthquakes']] : [] };
  }

  const requestedHazard = Object.keys(hazardTerms).find(hazard => hazardTerms[hazard].test(q));
  const requestedPlace = q.match(/\b(?:in|near|around|for)\s+([^?!.]+?)(?:\s+(?:please|since|after|today|last)\b|[?!.]|$)/)?.[1]?.trim();
  const located = places.find(({names}) => names.some(name => matchesPhrase(q, name)))?.item;
  const asksMethod = /\b(why|how|what|explain|measure[ds]?|source[s]?|meaning)\b/.test(q);
  const compare = /\b(compare|before and after)\b/.test(q);
  const modeRequest = compare ? 'compare'
    : /\b(displacement|ground movement)\b/.test(q) ? 'displacement'
    : /\b(shaking|intensity)\b/.test(q) ? 'shaking'
    : /\b(extent|detected floodwater)\b/.test(q) ? 'extent' : null;
  const refersToCase = located || (view.current && !requestedHazard && !requestedPlace);
  const activeCase = located || (refersToCase ? view.current : null);
  const context = /\b(nisar radar|radar layer)\b/.test(q) ? 'radar'
    : /\b(rainfall|rain rate|imerg)\b/.test(q) ? 'rain'
    : /\b(snow cover|snow layer)\b/.test(q) ? 'snow' : null;

  if (context && !asksMethod && !located && !requestedPlace) {
    const target = context === 'rain' ? 'Floods' : context === 'snow' ? 'Glaciers' : requestedHazard ?? view.hazard;
    tools.openImagery(target, context);
    const layer = imagery[context];
    return { text: `${layer.title} · ${layer.latest}. ${layer.description}`, links: [layer.source] };
  }

  if (activeCase && (located || modeRequest || asksMethod)) {
    if (located) tools.openCase(located.id);
    const selected = modeRequest && activeCase.modes.find(mode => mode.id === modeRequest);
    if (selected) tools.openMode(selected.id);
    const prefix = modeRequest && !selected ? 'That layer is unavailable for this case. ' : '';
    return {
      text: `${prefix}${activeCase.place} · ${selected?.date ?? activeCase.date}. ${asksMethod || prefix ? activeCase.method : selected?.hint ?? activeCase.evidence}`,
      links: activeCase.sources.slice(0, 4),
    };
  }
  if (asksMethod) {
    const method = methods.find(([pattern]) => pattern.test(q));
    if (method) return { text: method[1], links: [[method[2], method[3]]] };
  }

  if (requestedHazard || requestedPlace) {
    const hazard = requestedHazard ?? view.hazard;
    const magnitude = hazard === 'Earthquakes'
      ? q.match(/\bm(?:agnitude)?\s*(2\.5|4(?:\.0)?|5(?:\.0)?|6(?:\.0)?)\b/)?.[1] : null;
    await tools.load(hazard);
    if (requestedPlace) {
      const items = tools.find(hazard, requestedPlace).filter(item => !magnitude || item.magnitude >= Number(magnitude));
      if (!items.length) return { text: `The ${hazard.toLowerCase()} catalog has no place-name match for “${requestedPlace}”. Try a nearby region or the Observations list.` };
      tools.openWorld(hazard, magnitude && Number(magnitude));
      await tools.openEntry(hazard, items[0].id);
      const detail = tools.details(hazard, items[0]);
      return { text: `${detail.title} · ${detail.description}${items.length > 1 ? ' · More matches in Observations' : ''}`, links: detail.links };
    }
    const satellite = hazard === 'Floods' && /\b(satellite|viirs)\b/.test(q) && !asksMethod;
    tools.openWorld(hazard, magnitude && Number(magnitude), satellite);
    const info = tools.info(hazard);
    return { text: asksMethod ? info.method : info.caption + (satellite ? '. The VIIRS layer appears when you zoom in.' : '.'), links: info.sources };
  }
  return { text: 'Try “Compare Guelma”, “Show M5+ earthquakes”, “Earthquakes in Japan” or “Open Pine Island”. You can also ask how radar, rainfall or glacier mass balance is measured.' };
}

export function mountAssistant({ view, tools, byId }) {
  const form = byId('ask-form');
  const input = byId('ask-query');
  const log = byId('ask-log');
  const submit = form.querySelector('button');
  function append(text, type, links = []) {
    const message = document.createElement('article');
    message.className = type;
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    message.append(paragraph);
    for (const [label, url] of links) {
      const link = document.createElement('a');
      link.className = 'provider-link';
      link.textContent = label;
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      message.append(link);
    }
    log.append(message);
    log.scrollTop = log.scrollHeight;
  }
  async function ask(question) {
    if (!question || submit.disabled) return;
    append(question, 'ask-user');
    input.value = '';
    submit.disabled = true;
    try {
      const reply = await answerMapQuestion(question, view(), tools);
      append(reply.text, 'ask-reply', reply.links);
    } catch {
      append('The observation catalog could not load. Try again in a moment.', 'ask-reply');
    } finally {
      submit.disabled = false;
      if (!byId('ask-panel').hidden) input.focus();
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    ask(input.value.trim());
  });
  byId('ask-panel').querySelector('.ask-prompts').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button) ask(button.textContent);
  });
}
