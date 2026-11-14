const granule = id => `https://cmr.earthdata.nasa.gov/search/granules.umm_json?concept_id=${id}`;
const gibs = ['NASA GIBS · NISAR false-color radar', 'https://nisar-docs.asf.alaska.edu/worldview/'];
const radar = (place, date, label) => ({id:date,label,date:label + ' 2026',image:`nisar-${place}-${date}.webp`});

const guelmaPasses = [
  radar('guelma','2026-09-06','6 Sep'),
  radar('guelma','2026-09-18','18 Sep'),
  radar('guelma','2026-09-30','30 Sep'),
];
const reghaiaPasses = [
  radar('reghaia','2026-09-20','20 Sep'),
  radar('reghaia','2026-10-02','2 Oct'),
  radar('reghaia','2026-10-14','14 Oct'),
];
const pinePasses = [
  radar('pine','2026-10-03','3 Oct'),
  radar('pine','2026-10-15','15 Oct'),
];
const compare = (before, after, date) => ({id:'compare',label:'Compare',compare:[before,after],date});

export const observations = [
  {
    id:'guelma-nisar', hazard:'Floods', place:'Guelma, Algeria', short:'Algeria',
    location:'Guelma, Algeria', title:'Radar observations over Guelma',
    bounds:[[7.37,36.43],[7.48,36.53]], date:'6–30 Sep 2026',
    aliases:['algeria','algérie','guelma','قالمة','الجزائر','seybouse'],
    modes:[compare(guelmaPasses[0],guelmaPasses[1],'6–18 Sep 2026'), ...guelmaPasses],
    markers:[[7.426,36.464,'Guelma']],
    evidence:'NISAR radar on 6, 18 and 30 September. Flooding was reported in Guelma on 18 September.',
    method:'NASA GIBS daily false-color imagery over the same map extent. Catalog records show descending track 008, frame 070 for all three dates. The 18 September acquisition was at 18:20 UTC. The browse colors show radar response. A measured flood extent would require calibrated backscatter and a reference check.',
    sources:[
      gibs,
      ['NISAR GCOV · 6 September',granule('G4308222206-ASF')],
      ['NISAR GCOV · 18 September',granule('G4319026791-ASF')],
      ['NISAR GCOV · 30 September',granule('G4334451089-ASF')],
      ['GDACS · September flooding in Algeria','https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1104179'],
      ['Local reporting · Civil Protection interventions in Guelma','https://www.tsa-algerie.com/inondations-en-algerie-une-fillette-une-famille-et-un-homme-sauves/'],
    ],
  },
  {
    id:'reghaia-nisar', hazard:'Floods', place:'Lake Réghaïa, Algeria', short:'Algeria',
    location:'Algiers, Algeria', title:'Radar observations over Lake Réghaïa',
    bounds:[[3.31,36.76],[3.37,36.82]], date:'20 Sep–14 Oct 2026',
    aliases:['algeria','algérie','algiers','reghaia','réghaïa','wetland','الرغاية','الجزائر'],
    modes:[compare(reghaiaPasses[0],reghaiaPasses[2],'20 Sep–14 Oct 2026'), ...reghaiaPasses],
    markers:[[3.343,36.78,'Lake Réghaïa']],
    evidence:'A coastal wetland seen on three NISAR passes.',
    method:'These are NASA GIBS radar browse images. The matching CMR records are descending track 037, frame 070. Compare the visible lake and shore. No surface-water trend has been calculated from these images.',
    sources:[
      gibs,
      ['NISAR GCOV · 20 September',granule('G4320104146-ASF')],
      ['NISAR GCOV · 2 October',granule('G4339390226-ASF')],
      ['NISAR GCOV · 14 October',granule('G4370318723-ASF')],
      ['Ramsar · Réghaïa coastal wetland','https://rsis.ramsar.org/RISapp/files/RISrep/DZ1304RISformer_161020.pdf'],
    ],
  },
  {
    id: 'mozambique-floods', hazard: 'Floods', place: 'Lower Limpopo', location: 'Gaza Province, Mozambique',
    short: 'Mozambique', title: 'Flooding along the Limpopo',
    date: '17 Dec 2025 / 25 Jan 2026', bounds: [[32.65,-25.33],[34.20,-24.28]],
    summary: 'Compare the lower Limpopo before the rainy-season floods and during widespread inundation.',
    aliases: ['chokwe','chókwè','xai xai','flood','limpopo','incomati','gaza','mozambique'],
    modes: [{id:'extent',label:'Detected floodwater',image:'flood-extent.webp',date:'23–25 Jan 2026',hint:'Click to inspect the satellite flood classification.'}, {id:'event',label:'Satellite image',image:'flood-event.webp',date:'25 Jan 2026'}, compare({image:'flood-reference.webp',label:'17 Dec 2025'}, {image:'flood-event.webp',label:'25 Jan 2026'}, '17 Dec 2025–25 Jan 2026')],
    markers: [[33.00,-24.53,'Chókwè'],[33.64,-25.05,'Xai-Xai']],
    measurement: 'Flood extent in satellite imagery',
    evidence: 'Dark blue water extends across the floodplain in the January view. Cloud and vegetation can obscure water.',
    method: 'The flood layer displays the published NASA LANCE VIIRS three-day flood classification ending 25 January. The background imagery compares Terra MODIS observations from 17 December and 25 January. NASA also documented the event with NISAR on 5 and 17 January. The linked radar images cover different dates. The app reads the displayed categories and displays the coverage limits.',
    sources: [
      ['NASA LANCE · VIIRS flood product','https://lance.modaps.eosdis.nasa.gov/flood/'],
      ['NASA Earth Observatory · event analysis','https://science.nasa.gov/earth/earth-observatory/floods-inundate-southern-mozambique/'],
      ['NASA SVS · NISAR before and during the flood','https://svs.gsfc.nasa.gov/5661'],
      ['NISAR GCOV · 5 January','https://cmr.earthdata.nasa.gov/search/granules.umm_json?concept_id=G4058657013-ASF'],
      ['NISAR GCOV · 17 January','https://cmr.earthdata.nasa.gov/search/granules.umm_json?concept_id=G4059040862-ASF'],
      ['Copernicus EMS · independent response mapping','https://mapping.emergency.copernicus.eu/activations/EMSR857/'],
    ],
  },
  {
    id:'venezuela-earthquakes', hazard:'Earthquakes', place:'Northern Venezuela', short:'Venezuela',
    location:'Caribbean coast, Venezuela', title:'Where the ground moved', date:'13–25 Jun 2026',
    bounds:[[-68.8,9.9],[-66.5,10.85]],
    summary:'Explore the surface displacement measured across the two earthquakes of 24 June.',
    aliases:['caracas','venezuela','san felipe','catia la mar','earthquake','quake','la guaira'],
    modes:[{id:'displacement',label:'Ground movement',image:'displacement.webp',hint:'Click the map for a NISAR measurement.'},{id:'shaking',label:'Shaking intensity',date:'24 Jun 2026',hint:'USGS ShakeMap · M7.5 event'}],
    markers:[[-66.900,10.485,'Caracas']],
    measurement:'NISAR ground displacement',
    evidence:'Select a point for displacement in centimeters. Select an epicenter for the magnitude and depth.',
    method:'NASA JPL’s ARIA team processed a NISAR GUNW pair acquired on 13 and 25 June. TerraPulse downloads the published numeric displacement raster, selects only this acquisition pair, and reads the corresponding display-grid cell. The provider export uses exact zero for unmapped areas, so those pixels are suppressed. The displacement is measured along the radar line of sight. The pair spans both earthquakes. USGS MMI contours are a separate product for the M7.5 event.',
    sources:[
      ['NASA ARIA · published displacement map','https://gis.earthdata.nasa.gov/portal/home/item.html?id=1d972eab2bbd4098af71c0c61db083fc'],
      ['NISAR GUNW · 13–25 June','https://cmr.earthdata.nasa.gov/search/granules.umm_json?concept_id=G4276300590-ASF'],
      ['USGS · M7.5 event and ShakeMap','https://earthquake.usgs.gov/earthquakes/eventpage/us6000t7zp/shakemap/intensity'],
      ['USGS · M7.2 event','https://earthquake.usgs.gov/earthquakes/eventpage/us6000t7zc/executive'],
    ],
  },
  {
    id:'pine-island-glacier', hazard:'Glaciers', place:'Pine Island Glacier', short:'Antarctica',
    location:'Amundsen Sea, Antarctica', title:'Pine Island Glacier', date:'3–15 Oct 2026',
    bounds:[[-102,-75.7],[-100,-74.85]],
    summary:'Inspect the glacier’s terminus and the adjacent sea ice in a dated satellite view.',
    aliases:['pine island','antarctica','glacier','glaciers','ice loss','thinning','amundsen'],
    modes:[compare(...pinePasses,'3–15 Oct 2026'), ...pinePasses],
    markers:[[-100.35,-75.19,'Pine Island Glacier']],
    measurement:'Glacier surface and terminus',
    evidence:'Two NISAR radar views of Pine Island Glacier. The NASA ICESat-2 reference shows multi-year surface-height change.',
    method:'The map shows NASA GIBS daily NISAR false-color backscatter on 3 and 15 October. NASA’s ICESat-2 visualization uses monthly gridded surface-height change from 2020–2025. The linked GOFF pair measures ice displacement over its acquisition interval. TerraPulse does not report thinning or velocity at a map click in this release.',
    sources:[
      gibs,
      ['NASA SVS · Pine Island ice-height change','https://svs.gsfc.nasa.gov/5591#section-4'],
      ['NSIDC · ICESat-2 ATL15','https://nsidc.org/data/atl15/versions/6'],
      ['NISAR GOFF · 3–15 October','https://cmr.earthdata.nasa.gov/search/granules.umm_json?concept_id=G4371845616-ASF'],
      ['NASA Earth Observatory · glacier retreat','https://science.nasa.gov/earth/earth-observatory/retreat-at-pine-island-glacier/'],
    ],
  },
];
