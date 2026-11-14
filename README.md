# TerraPulse

An observation atlas for the 2026 NASA Space Apps Challenge, [Dancing with the SARs](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/).

## Run

Use Node 22.12 or later within the Node 22 release line.

```sh
npm ci
npm run dev
npm run build
```

The web build is static. It includes its imagery, vectors and observation data for repeatable demos without upstream requests.

## Published observations

- **Lower Limpopo, Mozambique.** Downloaded NASA GIBS Terra MODIS band 7/2/1 composites for 17 December 2025 and 25 January 2026. The app compares these optical observations and links to NASA's NISAR observations on 5 and 17 January 2026. The default flood layer displays NASA LANCE’s VIIRS three-day flood classification ending 25 January 2026. TerraPulse maps the published classes and exposes them on click.
- **Northern Venezuela.** Downloaded the numeric NASA JPL ARIA raster for NISAR's 13–25 June 2026 pair, reprojected and sampled it, and published the display raster and little-endian numeric grid. The grid conservatively suppresses the service's ambiguous zero fill. The two USGS event locations and the M7.5 ShakeMap contours provide separate earthquake context.
- **Pine Island Glacier.** Compare NASA GIBS NISAR radar observations from 3 and 15 October 2026. The case links to NASA’s ICESat-2 surface-height change visualization and the October NISAR GOFF record.

To rebuild the derived assets:

```sh
python -m pip install -r scripts/requirements.txt
python scripts/prepare_data.py
```

The repository includes the processed outputs for the cases. The [NASA Earthdata GIBS](https://www.earthdata.nasa.gov/data/projects/gibs), [NASA JPL ARIA](https://aria.jpl.nasa.gov/), [USGS](https://earthquake.usgs.gov/) and Natural Earth products retain their own terms and attribution. The NASA Space Apps logo identifies the event. This is a participant project.

The map presents dated observations. Forecast models and raw Earthdata processing beyond the published ARIA raster are future work.

## Worldwide map

The three hazard tabs open worldwide catalogs. The default earthquake view shows magnitude 4.0+ and offers magnitude filters. Flood reports come from GDACS, with a separate dated NASA LANCE VIIRS satellite layer (visible after zooming in). Glacier points show the latest available annual mass balance and up to 12 recorded years from WGMS. These are monitored sites, and dates vary by site. Outlined markers open the detailed satellite cases.

Refresh the compact provider snapshots with `python scripts/prepare_world.py /path/to/DOI-WGMS-FoG-2026-02-10.zip`. The WGMS source is [Fluctuations of Glaciers Database, release 2026-02-10](https://doi.org/10.5904/wgms-fog-2026-02-10).

## NISAR radar comparisons

Guelma and Lake Réghaïa are searchable under Floods. Pine Island is under Glaciers. The date controls show georeferenced radar imagery and Compare swipes two NASA GIBS browse crops. Sources links the evaluated CMR records and local event or wetland references.

Recreate the imagery with `python scripts/prepare_radar_browse.py` after installing `scripts/requirements.txt`. This uses the [NASA GIBS NISAR Worldview layer](https://nisar-docs.asf.alaska.edu/worldview/). It is a daily visualization service that may mosaic acquisitions. The CMR records describe coverage and intended matching observation geometry, while the WebP images show what the service rendered for each date and crop. Numeric backscatter values require the calibrated GCOV arrays. We use NASA Worldview as a reference for dated comparison, and the [ASF NISAR Cookbook](https://github.com/ASFOpenSARlab/NISAR_Cookbook) as a reference for numeric extraction.
