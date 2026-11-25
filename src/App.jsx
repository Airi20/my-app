import { useState, useMemo, useRef } from "react";
import "./App.css";

const COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#9333ea",
  "#ea580c", "#0891b2", "#db2777", "#65a30d",
  "#4f46e5", "#ca8a04"
];

function parseASC(text, name) {
  const data = [];
  for (const row of text.split(/\r?\n/)) {
    const values = row.trim().split(/[,;\t ]+/);
    if (values.length < 2) continue;
    const x = Number(values[0]);
    const y = Number(values[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) data.push({ x, y });
  }
  if (!data.length) throw new Error(`${name}: 数値データを読み込めませんでした`);
  data.sort((a, b) => a.x - b.x);
  return { name, data, visible: true, id: crypto.randomUUID() };
}

// 指定波長の値を線形補間。測定範囲外はnull。
function interpolate(data, x) {
  if (!data.length || x < data[0].x || x > data[data.length - 1].x) return null;
  let low = 0;
  let high = data.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (data[mid].x === x) return data[mid].y;
    if (data[mid].x < x) low = mid + 1;
    else high = mid - 1;
  }
  const a = data[high];
  const b = data[low];
  if (!a || !b || b.x === a.x) return null;
  return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
}

function integrateSpectrum(data, min, max) {
  if (data.length < 2) return null;
  const start = Math.max(min, data[0].x);
  const end = Math.min(max, data[data.length - 1].x);
  if (start >= end) return null;
  const points = [
    { x: start, y: interpolate(data, start) },
    ...data.filter((p) => p.x > start && p.x < end),
    { x: end, y: interpolate(data, end) }
  ].filter((p) => p.y !== null && Number.isFinite(p.y));
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    area += dx * (points[i].y + points[i + 1].y) / 2;
  }
  return area;
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// 目盛り幅を 1, 2, 5, 10 × 10^n から選ぶ。
function niceStep(range, targetTicks = 5) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / targetTicks;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const fraction = rough / power;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * power;
}

function makeTicks(min, max, targetTicks = 5) {
  const step = niceStep(max - min, targetTicks);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = start, i = 0; value <= end + step * 1e-8 && i < 100; value += step, i++) {
    ticks.push(Math.abs(value) < step * 1e-10 ? 0 : Number(value.toPrecision(12)));
  }
  return { min: start, max: end, ticks };
}

function downloadCSV(csv, filename) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [spectra, setSpectra] = useState([]);
  const [error, setError] = useState("");
  const [blankId, setBlankId] = useState("");
  const [correctionEnabled, setCorrectionEnabled] = useState(false);
  const [xMinInput, setXMinInput] = useState("");
  const [xMaxInput, setXMaxInput] = useState("");
  const [yMinInput, setYMinInput] = useState("");
  const [yMaxInput, setYMaxInput] = useState("");
  const svgRef = useRef(null);
  const integralSvgRef = useRef(null);

  async function handleFiles(event) {
    const files = Array.from(event.target.files || []);
    setError("");
    try {
      const loaded = await Promise.all(files.map(async (file) => parseASC(await file.text(), file.name)));
      setSpectra((prev) => [...prev, ...loaded]);
    } catch (e) {
      setError(e.message || "ファイルの読み込みに失敗しました");
    }
    event.target.value = "";
  }

  function toggleSpectrum(id) {
    setSpectra((prev) => prev.map((s) => s.id === id ? { ...s, visible: !s.visible } : s));
  }

  function clearAll() {
    setSpectra([]);
    setBlankId("");
    setCorrectionEnabled(false);
    setError("");
  }

  const blankSpectrum = spectra.find((s) => s.id === blankId) || null;

  // 元データは変更せず、表示・積分用の補正済みデータを別途作成する。
  const processedSpectra = useMemo(() => spectra.map((s) => {
    if (!correctionEnabled || !blankSpectrum || s.id === blankId) {
      return { ...s, processedData: s.data, isBlank: s.id === blankId };
    }
    const processedData = s.data.map((p) => {
      const blankValue = interpolate(blankSpectrum.data, p.x);
      return { x: p.x, y: blankValue === null ? null : p.y - blankValue };
    }).filter((p) => p.y !== null);
    return { ...s, processedData, isBlank: false };
  }), [spectra, correctionEnabled, blankSpectrum, blankId]);

  const chart = useMemo(() => {
    const visible = processedSpectra.filter((s) => s.visible && !(correctionEnabled && s.id === blankId));
    if (!visible.length) return null;
    const allPoints = visible.flatMap((s) => s.processedData);
    if (!allPoints.length) return null;

    const autoXMin = Math.min(...allPoints.map((p) => p.x));
    const autoXMax = Math.max(...allPoints.map((p) => p.x));
    const requestedXMin = xMinInput !== "" && Number.isFinite(Number(xMinInput)) ? Number(xMinInput) : autoXMin;
    const requestedXMax = xMaxInput !== "" && Number.isFinite(Number(xMaxInput)) ? Number(xMaxInput) : autoXMax;
    const validX = requestedXMin < requestedXMax;
    const xMin = validX ? requestedXMin : autoXMin;
    const xMax = validX ? requestedXMax : autoXMax;
    const selected = allPoints.filter((p) => p.x >= xMin && p.x <= xMax);
    const yPoints = selected.length ? selected : allPoints;
    const dataYMin = Math.min(...yPoints.map((p) => p.y));
    const dataYMax = Math.max(...yPoints.map((p) => p.y));
    const requestedYMin = yMinInput !== "" && Number.isFinite(Number(yMinInput)) ? Number(yMinInput) : dataYMin;
    const requestedYMax = yMaxInput !== "" && Number.isFinite(Number(yMaxInput)) ? Number(yMaxInput) : dataYMax;
    const validY = requestedYMin < requestedYMax;
    const rawYMin = validY ? requestedYMin : dataYMin;
    const rawYMax = validY ? requestedYMax : dataYMax;
    const padding = rawYMin === rawYMax ? Math.max(Math.abs(rawYMax) * 0.05, 1) : 0;
    const ticks = makeTicks(rawYMin - padding, rawYMax + padding, 5);
    const left = 95, right = 25, top = 30, bottom = 65, width = 900, height = 520;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const Y = (y) => top + ((ticks.max - y) / (ticks.max - ticks.min || 1)) * plotHeight;
    const X = (x) => left + ((x - xMin) / (xMax - xMin || 1)) * plotWidth;
    return { visible, xMin, xMax, yMin: ticks.min, yMax: ticks.max, yTicks: ticks.ticks, left, right, top, bottom, width, height, plotWidth, plotHeight, X, Y };
  }, [processedSpectra, correctionEnabled, blankId, xMinInput, xMaxInput, yMinInput, yMaxInput]);

  const integrals = useMemo(() => {
    if (!chart) return [];
    return chart.visible.map((s) => ({
      ...s,
      integral: integrateSpectrum(s.processedData, chart.xMin, chart.xMax)
    }));
  }, [chart]);

  const integralChart = useMemo(() => {
    const valid = integrals.filter((s) => s.integral !== null && Number.isFinite(s.integral));
    if (!valid.length) return null;
    const dataMin = Math.min(0, ...valid.map((s) => s.integral));
    const dataMax = Math.max(0, ...valid.map((s) => s.integral));
    const ticks = makeTicks(dataMin, dataMax, 5);
    const width = 900, height = 420, left = 105, right = 35, top = 35, bottom = 100;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const Y = (value) => top + ((ticks.max - value) / (ticks.max - ticks.min || 1)) * plotHeight;
    return { valid, width, height, left, right, top, bottom, plotWidth, plotHeight, minValue: ticks.min, maxValue: ticks.max, yTicks: ticks.ticks, Y };
  }, [integrals]);

  async function exportSVG(svg, filename, width, height) {
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const link = document.createElement("a");
      link.download = filename;
      link.href = canvas.toDataURL("image/png");
      link.click();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setError("PNGの書き出しに失敗しました");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function savePNG() {
    if (chart) exportSVG(svgRef.current, "intensity_spectra.png", chart.width, chart.height);
  }
  function saveIntegralPNG() {
    if (integralChart) exportSVG(integralSvgRef.current, "integrated_intensity.png", integralChart.width, integralChart.height);
  }

  function saveCSV() {
    if (!processedSpectra.length) return;
    const columns = processedSpectra.filter((s) => !(correctionEnabled && s.id === blankId));
    const wavelengths = [...new Set(columns.flatMap((s) => s.processedData.map((p) => p.x)))].sort((a, b) => a - b);
    const header = ["Wavelength (nm)", ...columns.map((s) => `${s.name}${correctionEnabled ? " (corrected)" : ""}`)];
    const rows = wavelengths.map((x) => [
      x,
      ...columns.map((s) => {
        const point = s.processedData.find((p) => p.x === x);
        return point ? point.y : "";
      })
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    downloadCSV([header.map((v) => `"${v}"`).join(","), ...rows].join("\n"), correctionEnabled ? "corrected_intensity_data.csv" : "intensity_data.csv");
  }

  function saveIntegralCSV() {
    if (!integrals.length) return;
    const rows = [
      ["File name", "Wavelength min (nm)", "Wavelength max (nm)", "Integrated intensity (a.u.·nm)"],
      ...integrals.map((s) => [s.name, chart.xMin, chart.xMax, s.integral ?? ""])
    ];
    downloadCSV(rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"), "integrated_intensity.csv");
  }

  return (
    <div className="app">
      <header className="header">
        <div><h1>Intensity Spectrum Analyzer</h1><p>ASC File Visualization Tool</p></div>
        <span className="version">VERSION 3.0</span>
      </header>

      <main>
        <section className="upload-section">
          <label className="upload-button">
            <br>これがボタンです⚠️＋ Select ASC Files</br>
            <input type="file" accept=".asc,.ASC,.txt,.csv" multiple onChange={handleFiles} hidden />
          </label>
          <span className="file-count">{spectra.length} files loaded</span>
        </section>

        {error && <div className="error">{error}</div>}

        <section className="settings-section">
          <h2>Background Correction</h2>
          <div className="correction-controls">
            <label className="blank-select">
              Blank spectrum
              <select value={blankId} onChange={(e) => setBlankId(e.target.value)}>
                <option value="">Select a blank file</option>
                {spectra.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="correction-toggle">
              <input
                type="checkbox"
                checked={correctionEnabled}
                disabled={!blankId}
                onChange={(e) => setCorrectionEnabled(e.target.checked)}
              />
              Background Correction ON
            </label>
          </div>
          <p className="setting-note">
            {blankId
              ? `Blank: ${blankSpectrum?.name || ""} ／ 波長ごとに Blank の強度を差し引きます。`
              : "ブランクとして使用するASCファイルを選択してください。"}
          </p>
          <p className="setting-note">補正後の負の値はゼロに置き換えず、そのまま保持します。元データも変更されません。</p>
          <p className="setting-note">
  ※ 積分値は、指定した波長範囲における蛍光スペクトルの面積を台形公式により算出しています。
</p>

<p>
  <b>【提供】</b>
  <br />
  <b>集中力は3分が限界</b>
  <br />
  <b>ゼミ室に窓を設けようの会</b>
  <br />
  <b>飢餓状態になってようやく空腹に気づく社</b>

</p>
        </section>

        <section className="settings-section">
          <h2>Graph Settings</h2>
          <div className="settings-grid">
            <div className="setting-group">
              <h3>Wavelength (nm)</h3>
              <label>Minimum<input type="number" value={xMinInput} placeholder="Auto" onChange={(e) => setXMinInput(e.target.value)} /></label>
              <label>Maximum<input type="number" value={xMaxInput} placeholder="Auto" onChange={(e) => setXMaxInput(e.target.value)} /></label>
            </div>
            <div className="setting-group">
              <h3>Intensity (a.u.)</h3>
              <label>Minimum<input type="number" value={yMinInput} placeholder="Auto" onChange={(e) => setYMinInput(e.target.value)} /></label>
              <label>Maximum<input type="number" value={yMaxInput} placeholder="Auto" onChange={(e) => setYMaxInput(e.target.value)} /></label>
            </div>
          </div>
          <button className="reset-button" onClick={() => { setXMinInput(""); setXMaxInput(""); setYMinInput(""); setYMaxInput(""); }}>Reset to Auto</button>
          {chart && <p className="range-info">Integration range: {formatNumber(chart.xMin)} – {formatNumber(chart.xMax)} nm</p>}
        </section>

        <section className="graph-section">
          <div className="graph-header">
            <div><h2>Intensity Spectra</h2><p>{correctionEnabled ? "Background-corrected spectra" : "Overlay visualization"}</p></div>
            <div className="actions">
              <button onClick={saveCSV} disabled={!spectra.length}>Export CSV</button>
              <button onClick={savePNG} disabled={!chart}>Export PNG</button>
            </div>
          </div>
          {chart ? (
            <div className="chart-container">
              <svg ref={svgRef} viewBox={`0 0 ${chart.width} ${chart.height}`} className="chart" xmlns="http://www.w3.org/2000/svg">
                <defs><clipPath id="plotClip"><rect x={chart.left} y={chart.top} width={chart.plotWidth} height={chart.plotHeight} /></clipPath></defs>
                <rect width={chart.width} height={chart.height} fill="white" />
                {chart.yTicks.map((value, i) => {
                  const y = chart.Y(value);
                  return <g key={`y-${i}`}>
                    <line x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} stroke="#e5e7eb" />
                    <text x={chart.left - 12} y={y + 5} textAnchor="end" fontSize="13" fill="#374151">{formatNumber(value)}</text>
                  </g>;
                })}
                {[0, 1, 2, 3, 4, 5].map((i) => {
                  const x = chart.left + chart.plotWidth * i / 5;
                  const value = chart.xMin + (chart.xMax - chart.xMin) * i / 5;
                  return <g key={`x-${i}`}>
                    <line x1={x} x2={x} y1={chart.top} y2={chart.height - chart.bottom} stroke="#f1f5f9" />
                    <text x={x} y={chart.height - chart.bottom + 25} textAnchor="middle" fontSize="13" fill="#374151">{formatNumber(value)}</text>
                  </g>;
                })}
                <line x1={chart.left} y1={chart.top} x2={chart.left} y2={chart.height - chart.bottom} stroke="#111827" strokeWidth="1.5" />
                <line x1={chart.left} y1={chart.height - chart.bottom} x2={chart.width - chart.right} y2={chart.height - chart.bottom} stroke="#111827" strokeWidth="1.5" />
                <text x={chart.left + chart.plotWidth / 2} y={chart.height - 12} textAnchor="middle" fontSize="17" fontWeight="600" fill="#111827">Wavelength (nm)</text>
                <text transform={`translate(22 ${chart.top + chart.plotHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize="17" fontWeight="600" fill="#111827">Intensity (a.u.)</text>
                <g clipPath="url(#plotClip)">
                  {chart.visible.map((s) => {
                    const color = COLORS[spectra.findIndex((item) => item.id === s.id) % COLORS.length];
                    const points = s.processedData.filter((p) => p.x >= chart.xMin && p.x <= chart.xMax)
                      .map((p) => `${chart.X(p.x)},${chart.Y(p.y)}`).join(" ");
                    return <polyline key={s.id} points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
                  })}
                </g>
                {chart.visible.length > 0 && <g>
                  <rect x={chart.width - chart.right - 245} y={chart.top + 10} width="235" height={chart.visible.length * 22 + 16} rx="6" fill="white" fillOpacity="0.92" stroke="#cbd5e1" />
                  {chart.visible.map((s, index) => {
                    const color = COLORS[spectra.findIndex((item) => item.id === s.id) % COLORS.length];
                    return <g key={s.id}>
                      <line x1={chart.width - chart.right - 230} x2={chart.width - chart.right - 210} y1={chart.top + 26 + index * 22} y2={chart.top + 26 + index * 22} stroke={color} strokeWidth="3" />
                      <text x={chart.width - chart.right - 202} y={chart.top + 30 + index * 22} fontSize="11" fill="#334155">{s.name.length > 27 ? s.name.slice(0, 24) + "..." : s.name}</text>
                    </g>;
                  })}
                </g>}
              </svg>
            </div>
          ) : <div className="empty"><div className="empty-icon">⌁</div><h3>No spectra loaded</h3><p>Select multiple ASC files to visualize intensity spectra.</p></div>}
        </section>

        <section className="graph-section">
          <div className="graph-header">
            <div><h2>Integrated Intensity</h2><p>Area under the curve (trapezoidal integration)</p></div>
            <div className="actions">
              <button onClick={saveIntegralCSV} disabled={!integralChart}>Export CSV</button>
              <button onClick={saveIntegralPNG} disabled={!integralChart}>Export PNG</button>
            </div>
          </div>
          {integralChart ? <>
            <div className="integral-range">Integration range: {formatNumber(chart.xMin)} – {formatNumber(chart.xMax)} nm</div>
            <div className="chart-container">
              <svg ref={integralSvgRef} viewBox={`0 0 ${integralChart.width} ${integralChart.height}`} className="chart" xmlns="http://www.w3.org/2000/svg">
                <rect width={integralChart.width} height={integralChart.height} fill="white" />
                {integralChart.yTicks.map((value, i) => {
                  const y = integralChart.Y(value);
                  return <g key={`iy-${i}`}>
                    <line x1={integralChart.left} x2={integralChart.width - integralChart.right} y1={y} y2={y} stroke="#e5e7eb" />
                    <text x={integralChart.left - 12} y={y + 5} textAnchor="end" fontSize="12" fill="#374151">{formatNumber(value)}</text>
                  </g>;
                })}
                <line x1={integralChart.left} y1={integralChart.top} x2={integralChart.left} y2={integralChart.height - integralChart.bottom} stroke="#111827" strokeWidth="1.5" />
                <line x1={integralChart.left} y1={integralChart.Y(0)} x2={integralChart.width - integralChart.right} y2={integralChart.Y(0)} stroke="#111827" strokeWidth="1.2" />
                {integralChart.valid.map((s, i) => {
                  const slot = integralChart.plotWidth / integralChart.valid.length;
                  const barWidth = Math.min(55, slot * 0.65);
                  const x = integralChart.left + slot * i + (slot - barWidth) / 2;
                  const zeroY = integralChart.Y(0), valueY = integralChart.Y(s.integral);
                  const y = Math.min(zeroY, valueY), height = Math.max(Math.abs(zeroY - valueY), 1);
                  const color = COLORS[spectra.findIndex((item) => item.id === s.id) % COLORS.length];
                  return <g key={s.id}>
                    <rect x={x} y={y} width={barWidth} height={height} fill={color} rx="3"><title>{s.name}: {s.integral.toFixed(2)}</title></rect>
                    <text x={x + barWidth / 2} y={s.integral >= 0 ? y - 7 : y + height + 15} textAnchor="middle" fontSize="11" fill="#334155">{formatNumber(s.integral)}</text>
                    <text transform={`translate(${x + barWidth / 2} ${integralChart.height - integralChart.bottom + 18}) rotate(-45)`} textAnchor="end" fontSize="11" fill="#374151">{s.name.length > 28 ? s.name.slice(0, 25) + "..." : s.name}</text>
                  </g>;
                })}
                <text transform={`translate(22 ${integralChart.top + integralChart.plotHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize="16" fontWeight="600" fill="#111827">Integrated Intensity (a.u.·nm)</text>
                <text x={integralChart.left + integralChart.plotWidth / 2} y={integralChart.height - 12} textAnchor="middle" fontSize="15" fontWeight="600" fill="#111827">Sample</text>
              </svg>
            </div>
            <div className="integral-table">
              <h3>Integrated Values</h3>
              {integralChart.valid.map((s) => <div className="integral-row" key={s.id}><span>{s.name}</span><strong>{s.integral.toFixed(2)} a.u.·nm</strong></div>)}
            </div>
          </> : <div className="empty"><h3>No integration data available</h3><p>Load spectra and select a valid wavelength range.</p></div>}
        </section>

        <section className="file-section">
          <div className="file-header"><h2>Loaded Files</h2><button className="clear-button" onClick={clearAll} disabled={!spectra.length}>Clear All</button></div>
          {spectra.map((s, index) => <div className="file-item" key={s.id}>
            <div className="file-name">
              <span className="color-dot" style={{ background: COLORS[index % COLORS.length] }} />
              <span>{s.name}</span><small>{s.data.length} points</small>
              {s.id === blankId && <small className="blank-badge">BLANK</small>}
            </div>
            <button className={s.visible ? "visible" : "hidden"} onClick={() => toggleSpectrum(s.id)}>{s.visible ? "Visible" : "Hidden"}</button>
          </div>)}
        </section>
      </main>
      <footer>Intensity Spectrum Analyzer · Research Tools</footer>
    </div>
  );
}
