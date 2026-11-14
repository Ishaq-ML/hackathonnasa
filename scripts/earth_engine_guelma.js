// Paste into https://code.earthengine.google.com/ under your Earth Engine project.
// Run first to inspect scene metadata. Then fill orbit/pass and run again.
var aoi = ee.Geometry.Rectangle([7.37, 36.43, 7.48, 36.53]);
var orbit = null;
var pass = null; // ASCENDING or DESCENDING, as printed by the catalog
var windows = {
  baseline: ['2026-08-10', '2026-09-18'],
  event: ['2026-09-18', '2026-09-30']
};
var exportToDrive = false;

var sar = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(aoi)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filterDate(windows.baseline[0], windows.event[1])
  .select(['VV', 'angle']);

function sceneTable(collection) {
  return ee.FeatureCollection(collection.toList(collection.size()).map(function(value) {
    var image = ee.Image(value);
    return ee.Feature(null, {
      id: image.get('system:index'),
      date_utc: image.date().format('YYYY-MM-dd HH:mm'),
      pass: image.get('orbitProperties_pass'),
      orbit: image.get('relativeOrbitNumber_start'),
      platform: image.get('platform_number')
    });
  }));
}

Map.centerObject(aoi, 11);
Map.addLayer(aoi, {color: 'f3b86b'}, 'Study area', false);
print('Guelma · Sentinel-1 scene manifest · dates in UTC', sceneTable(sar));

var water = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('seasonality');
Map.addLayer(water.clip(aoi), {min: 1, max: 12, palette: ['b4e7fb', '195a9c']}, 'Water seasonality · historical context', false);
var rain = ee.ImageCollection('UCSB-CHC/CHIRPS/V3/DAILY_SAT')
  .filterDate('2026-09-12', '2026-09-19').select('precipitation');
print('CHIRPS precipitation dates · expect 7 days', rain.aggregate_array('system:time_start'));
var dem = ee.ImageCollection('COPERNICUS/DEM/GLO30_2024_1').filterBounds(aoi).select('DEM');
var terrain = ee.Terrain.slope(dem.mosaic().setDefaultProjection(dem.first().projection())).rename('slope_deg');

if (orbit !== null && pass !== null) {
  var matched = sar.filter(ee.Filter.eq('relativeOrbitNumber_start', orbit))
    .filter(ee.Filter.eq('orbitProperties_pass', pass));
  var beforeScenes = matched.filterDate(windows.baseline[0], windows.baseline[1]);
  var eventScenes = matched.filterDate(windows.event[0], windows.event[1]).sort('system:time_start');
  ee.Dictionary({before: beforeScenes.size(), event: eventScenes.size(), rain: rain.size()}).evaluate(function(counts, error) {
    if (error) { print('Could not check scene availability', error); return; }
    if (!counts.before || !counts.event) {
      print('No matched pair. Choose a different orbit/pass or dates from the scene manifest.');
      return;
    }

    var event = ee.Image(eventScenes.first());
    var eventVV = event.select('VV').rename('event_vv_db');
    var beforeVV = beforeScenes.select('VV').median().rename('baseline_vv_db');
    var delta = eventVV.subtract(beforeVV).rename('delta_vv_db');
    var observationCount = beforeScenes.select('VV').count().rename('baseline_scene_count');
    var permanentWater = water.eq(12).unmask(0).rename('historical_permanent_water');
    var angle = event.select('angle').rename('event_angle_deg');
    var features = eventVV.addBands([beforeVV, delta, angle, observationCount, terrain, permanentWater])
      .updateMask(eventVV.mask().and(beforeVV.mask())).clip(aoi);

    Map.addLayer(beforeVV.clip(aoi), {min: -25, max: 0}, 'Baseline VV (dB)');
    Map.addLayer(eventVV.clip(aoi), {min: -25, max: 0}, 'First event-window VV (dB)');
    Map.addLayer(delta.clip(aoi), {min: -8, max: 8, palette: ['155c9b', 'ffffff', 'a53037']}, 'Event minus baseline (dB)');
    var candidates = eventVV.lt(-16).and(delta.lt(-3)).and(terrain.lt(5))
      .and(permanentWater.not()).selfMask().clip(aoi);
    Map.addLayer(candidates, {palette: ['57bbf0']}, 'Darkening candidates · unvalidated', false);
    print('Selected acquisition · verify timing against the flood report', sceneTable(ee.ImageCollection.fromImages([event])));
    print('Baseline scenes', sceneTable(beforeScenes));
    if (counts.rain === 7) {
      Map.addLayer(rain.sum().clip(aoi), {min: 0, max: 80, palette: ['f8fbff', '237fbf']}, '7-day rainfall (mm)', false);
    }
    if (exportToDrive) {
      Export.image.toDrive({
        image: features.toFloat().unmask(-9999, false),
        description: 'terrapulse_guelma_s1_features',
        region: aoi,
        crs: 'EPSG:32632',
        scale: 30,
        maxPixels: 1000000,
        formatOptions: {cloudOptimized: true, noData: -9999}
      });
    }
  });
}
