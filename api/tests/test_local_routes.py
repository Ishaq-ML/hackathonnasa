"""Exercise the actual local server's endpoint dispatch over HTTP."""
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from api import exposure, landslide


class LocalRoutesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), landslide.local_handler())
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def get(self, path):
        with urlopen(self.url + path) as response:
            self.assertEqual(response.headers.get_content_type(), 'application/json')
            return json.load(response)

    def test_glof_and_existing_model_routes(self):
        self.assertEqual(len(self.get('/api/glof')['sites']), 5)
        summary = self.get('/api/glof?site=south_lhonak')
        self.assertEqual(summary['site']['site_id'], 'south_lhonak')
        self.assertEqual(self.get('/api/landslide')['task'], 'post-event scar mapping')

    def test_chat_get_and_actual_post_route(self):
        self.assertFalse(self.get('/api/chat/')['generative_llm_configured'])
        request = Request(self.url + '/api/chat', data=json.dumps({'message':'Open GLOF monitoring'}).encode(),
                          headers={'Content-Type':'application/json'})
        with urlopen(request) as response:
            result = json.load(response)
        self.assertEqual(result['actions'][0], {'type':'open_tool','value':'glof'})
        self.assertIn('not a breach forecast', result['reply'])

    def test_chat_rejects_bad_requests_as_json(self):
        request = Request(self.url + '/api/chat', data=b'{', headers={'Content-Type':'application/json'})
        with self.assertRaises(HTTPError) as error:
            urlopen(request)
        self.assertEqual(error.exception.code, 400)
        self.assertIn('error', json.load(error.exception))

    def test_exposure_routes_real_geometry_analysis_with_fixture_source(self):
        # Network acquisition is mocked, not the endpoint or screening algorithm.
        school = {'type':'node','id':1,'lon':85.53,'lat':28.29,'tags':{'amenity':'school'}}
        with patch.object(exposure, 'load_osm', return_value=([school], '2026-11-15T00:00:00Z')):
            result = self.get('/api/exposure?lon=85.53&lat=28.29&radius_m=500')
        self.assertEqual(result['counts']['sensitive_places_within_100m'], 1)
        self.assertEqual(result['osm_geojson']['features'][0]['geometry']['type'], 'Point')
        self.assertEqual(result['danger_assessment'], 'not_available')

    def test_provider_failure_is_unavailable_not_zero_exposure(self):
        with patch.object(exposure, 'load_osm', side_effect=OSError('offline')):
            with self.assertRaises(HTTPError) as error:
                urlopen(self.url + '/api/exposure?lon=85.53&lat=28.29')
        self.assertEqual(error.exception.code, 503)
        result = json.load(error.exception)
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('counts', result)

    def test_invalid_forecast_exposure_and_unknown_routes(self):
        for path, status in [('/api/forecast?lon=nan&lat=0',400),
                             ('/api/exposure?lon=nan&lat=0',400), ('/api/not-real',404)]:
            with self.subTest(path=path), self.assertRaises(HTTPError) as error:
                urlopen(self.url + path)
            self.assertEqual(error.exception.code, status)
            self.assertIn('error', json.load(error.exception))


if __name__ == '__main__':
    unittest.main()
