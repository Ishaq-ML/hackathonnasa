import React, { useEffect, useRef, useState } from 'react';

function Chip({ result, layer }) {
  const canvas = useRef(null);
  useEffect(() => {
    const context = canvas.current.getContext('2d');
    const frame = context.createImageData(result.width, result.height);
    result.scores.forEach((score, pixel) => {
      const rgb = result.rgb?.slice(pixel * 3, pixel * 3 + 3) ?? [34, 44, 46];
      const candidate = score !== null && score >= result.threshold;
      const highlighted = layer === 'labels' ? result.labels[pixel] === 1 : layer === 'model' && candidate;
      const shade = highlighted ? (layer === 'labels' ? [121, 230, 214] : [255, 178, 79]) : rgb;
      frame.data.set([...shade, score === null ? 0 : 255], pixel * 4);
    });
    context.putImageData(frame, 0, 0);
  }, [result, layer]);

  return <canvas ref={canvas} width={result.width} height={result.height}
    role="img" aria-label={layer === 'model' ? 'Image with amber landslide candidate pixels' : layer === 'labels' ? 'Image with turquoise reference label pixels' : 'Natural-color Sentinel-2 tile'} />;
}

export default function LandslideLab() {
  const [result, setResult] = useState(null);
  const [layer, setLayer] = useState('model');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = useRef(null);

  async function run(file) {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      if (file && file.size > 4_000_000) throw new Error('The JSON tile must be 4 MB or smaller.');
      const response = await fetch(file ? '/api/landslide' : '/api/landslide?example=1', file ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: file,
      } : undefined);
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The landslide service is temporarily unavailable.');
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Inference failed.');
      setResult(data);
      setLayer('model');
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  function runUpload(event) {
    const file = event.currentTarget.files[0];
    if (file) run(file);
    event.currentTarget.value = '';
  }

  return (
    <dialog id="landslide-lab" aria-labelledby="landslide-title">
      <div className="discovery-heading">
        <div><h2 id="landslide-title">Landslide detection</h2><p>Sentinel-2 and ALOS terrain · Experimental</p></div>
        <form method="dialog"><button className="quiet" aria-label="Close landslide detection">×</button></form>
      </div>
      <p>Run the model on a held-out satellite image or upload a compatible 14-band tile.</p>
      <div className="lab-actions">
        <button className="quiet lab-primary" type="button" disabled={busy} onClick={() => run()}>Run held-out example</button>
        <button className="quiet" type="button" disabled={busy} onClick={() => upload.current.click()}>Upload JSON tile</button>
        <input type="file" ref={upload} accept=".json,application/json" onChange={runUpload} hidden />
        <a href="/api/landslide" target="_blank" rel="noreferrer">Model card</a>
      </div>
      {busy && <p role="status">Scoring pixels…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <div className="lab-result">
        <Chip result={result} layer={layer} />
        <div>
          <h3>{result.id ?? 'Uploaded tile'}</h3>
          <p role="status"><strong>{result.candidate_pixels.toLocaleString()} candidate pixels</strong> of {result.valid_pixels.toLocaleString()} scored.</p>
          <p>Detection threshold {result.threshold.toFixed(3)}. Review candidates against imagery.</p>
          <div className="lab-actions" aria-label="Image layers">
            <button className="quiet" type="button" aria-pressed={layer === 'model'} onClick={() => setLayer('model')}>Candidates</button>
            {result.rgb && <button className="quiet" type="button" aria-pressed={layer === 'rgb'} onClick={() => setLayer('rgb')}>Satellite</button>}
            {result.labels && <button className="quiet" type="button" aria-pressed={layer === 'labels'} onClick={() => setLayer('labels')}>Reference labels</button>}
          </div>
        </div>
      </div>}
      <details>
        <summary>Tile format and validation</summary>
        <p>Send JSON with <code>width</code>, <code>height</code>, and <code>rows</code>. Dimensions are 1–128 pixels. Supply one row per pixel in image order. Use Sentinel-2 B01 through B12, then ALOS slope and elevation, in the original Landslide4Sense units. Set missing bands to null.</p>
        <p>On 80 held-out benchmark chips, average precision was 58.3% and F1 was 56.0%. Performance in new regions is unmeasured.</p>
      </details>
    </dialog>
  );
}
