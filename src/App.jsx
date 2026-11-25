import { useState, useMemo, useRef } from "react";
import "./App.css";

const COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#9333ea",
  "#ea580c", "#0891b2", "#db2777", "#65a30d",
  "#4f46e5", "#ca8a04"
];

function parseASC(text, name) {
  const rows = text.split(/\r?\n/);
  const data = [];

  for (const row of rows) {
    const values = row.trim().split(/[,;\t ]+/);

    if (values.length < 2) continue;

    const x = Number(values[0]);
    const y = Number(values[1]);

    if (Number.isFinite(x) && Number.isFinite(y)) {
      data.push({ x, y });
    }
  }

  if (data.length === 0) {
    throw new Error(`${name}: 数値データを読み込めませんでした`);
  }

  data.sort((a, b) => a.x - b.x);

  return {
    name,
    data,
    visible: true,
  };
}

// 指定した波長で線形補間
function interpolate(data, x) {
  if (!data.length) return null;

  for (let i = 0; i < data.length - 1; i++) {
    const a = data[i];
    const b = data[i + 1];

    if (x >= a.x && x <= b.x) {
      const ratio = (x - a.x) / (b.x - a.x);
      return a.y + ratio * (b.y - a.y);
    }
  }

  return null;
}

// 指定範囲の積分（台形則）
function integrateSpectrum(data, min, max) {
  if (data.length < 2) return null;

  const start = Math.max(min, data[0].x);
  const end = Math.min(max, data[data.length - 1].x);

  if (start >= end) return null;

  const points = [
    { x: start, y: interpolate(data, start) },
    ...data.filter((p) => p.x > start && p.x < end),
    { x: end, y: interpolate(data, end) },
  ];

  let area = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    area += dx * (points[i].y + points[i + 1].y) / 2;
  }

  return area;
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

export default function App() {
  const [spectra, setSpectra] = useState([]);
  const [error, setError] = useState("");

  const [xMinInput, setXMinInput] = useState("");
  const [xMaxInput, setXMaxInput] = useState("");
  const [yMinInput, setYMinInput] = useState("");
  const [yMaxInput, setYMaxInput] = useState("");

  const svgRef = useRef(null);
  const integralSvgRef = useRef(null);

  async function handleFiles(event) {
    const files = Array.from(event.target.files);
    setError("");

    try {
      const loaded = await Promise.all(
        files.map(async (file) => {
          const text = await file.text();
          return parseASC(text, file.name);
        })
      );

      setSpectra((prev) => [
        ...prev,
        ...loaded.map((s) => ({
          ...s,
          id: crypto.randomUUID(),
        })),
      ]);
    } catch (e) {
      setError(e.message);
    }

    event.target.value = "";
  }

  function toggleSpectrum(id) {
    setSpectra((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, visible: !s.visible } : s
      )
    );
  }

  function clearAll() {
    setSpectra([]);
    setError("");
  }

  // グラフデータ
  const chart = useMemo(() => {
    const visible = spectra.filter((s) => s.visible);

    if (!visible.length) return null;

    const allPoints = visible.flatMap((s) => s.data);

    const autoXMin = Math.min(...allPoints.map((p) => p.x));
    const autoXMax = Math.max(...allPoints.map((p) => p.x));

    const xMin = xMinInput !== "" && Number.isFinite(Number(xMinInput))
      ? Number(xMinInput)
      : autoXMin;

    const xMax = xMaxInput !== "" && Number.isFinite(Number(xMaxInput))
      ? Number(xMaxInput)
      : autoXMax;

    const validX = xMin < xMax;

    const effectiveXMin = validX ? xMin : autoXMin;
    const effectiveXMax = validX ? xMax : autoXMax;

    const selectedPoints = allPoints.filter(
      (p) => p.x >= effectiveXMin && p.x <= effectiveXMax
    );

    const yPoints = selectedPoints.length
      ? selectedPoints
      : allPoints;

    const autoYMin = Math.min(...yPoints.map((p) => p.y));
    const autoYMax = Math.max(...yPoints.map((p) => p.y));

    const yMin = yMinInput !== "" && Number.isFinite(Number(yMinInput))
      ? Number(yMinInput)
      : autoYMin;

    const yMax = yMaxInput !== "" && Number.isFinite(Number(yMaxInput))
      ? Number(yMaxInput)
      : autoYMax;

    const validY = yMin < yMax;

    const effectiveYMin = validY ? yMin : autoYMin;
    const effectiveYMax = validY ? yMax : autoYMax;

    const xRange = effectiveXMax - effectiveXMin || 1;
    const yRange = effectiveYMax - effectiveYMin || 1;

    const left = 85;
    const right = 25;
    const top = 30;
    const bottom = 65;

    const width = 900;
    const height = 520;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    const X = (x) =>
      left + ((x - effectiveXMin) / xRange) * plotWidth;

    const Y = (y) =>
      top + ((effectiveYMax - y) / yRange) * plotHeight;

    return {
      visible,
      xMin: effectiveXMin,
      xMax: effectiveXMax,
      yMin: effectiveYMin,
      yMax: effectiveYMax,
      left,
      right,
      top,
      bottom,
      width,
      height,
      plotWidth,
      plotHeight,
      X,
      Y,
    };
  }, [
    spectra,
    xMinInput,
    xMaxInput,
    yMinInput,
    yMaxInput,
  ]);

  // 積分値
  const integrals = useMemo(() => {
    if (!chart) return [];

    return chart.visible.map((s) => ({
      ...s,
      integral: integrateSpectrum(
        s.data,
        chart.xMin,
        chart.xMax
      ),
    }));
  }, [chart]);

  // 積分グラフ
  const integralChart = useMemo(() => {
    const valid = integrals.filter(
      (s) => s.integral !== null && Number.isFinite(s.integral)
    );

    if (!valid.length) return null;

    const width = 900;
    const height = 420;

    const left = 85;
    const right = 35;
    const top = 35;
    const bottom = 100;

    const maxValue = Math.max(
      ...valid.map((s) => s.integral),
      0
    );

    const minValue = Math.min(
      ...valid.map((s) => s.integral),
      0
    );

    const range = maxValue - minValue || 1;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    const Y = (value) =>
      top + ((maxValue - value) / range) * plotHeight;

    return {
      valid,
      width,
      height,
      left,
      right,
      top,
      bottom,
      plotWidth,
      plotHeight,
      maxValue,
      minValue,
      Y,
    };
  }, [integrals]);

  // SVGをPNGで保存
  async function exportSVG(svg, filename, width, height) {
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);

    const blob = new Blob([svgData], {
      type: "image/svg+xml;charset=utf-8",
    });

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
    if (!chart) return;

    exportSVG(
      svgRef.current,
      "intensity_spectra.png",
      chart.width,
      chart.height
    );
  }

  function saveIntegralPNG() {
    if (!integralChart) return;

    exportSVG(
      integralSvgRef.current,
      "integrated_intensity.png",
      integralChart.width,
      integralChart.height
    );
  }

  // 元データCSV
  function saveCSV() {
    if (!spectra.length) return;

    const wavelengths = [
      ...new Set(spectra.flatMap((s) => s.data.map((p) => p.x))),
    ].sort((a, b) => a - b);

    const header = [
      "Wavelength (nm)",
      ...spectra.map((s) => s.name),
    ];

    const rows = wavelengths.map((x) => [
      x,
      ...spectra.map((s) => {
        const point = s.data.find((p) => p.x === x);
        return point ? point.y : "";
      }),
    ].join(","));

    const csv = [header.join(","), ...rows].join("\n");

    downloadCSV(csv, "intensity_data.csv");
  }

  // 積分値CSV
  function saveIntegralCSV() {
    if (!integrals.length) return;

    const rows = [
      ["File name", "Wavelength min (nm)", "Wavelength max (nm)", "Integrated intensity"],
      ...integrals.map((s) => [
        s.name,
        chart.xMin,
        chart.xMax,
        s.integral ?? "",
      ]),
    ];

    const csv = rows.map((row) =>
      row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    ).join("\n");

    downloadCSV(csv, "integrated_intensity.csv");
  }

  function downloadCSV(csv, filename) {
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">

      <header className="header">
        <div>
          <h1>Intensity Spectrum Analyzer</h1>
          <p>ASC File Visualization Tool</p>
        </div>
        <span className="version">VERSION 2.0</span>
      </header>

      <main>

        <section className="upload-section">
          <label className="upload-button">
            ＋ Select ASC Files
            <input
              type="file"
              accept=".asc,.ASC,.txt,.csv"
              multiple
              onChange={handleFiles}
              hidden
            />
          </label>

          <span className="file-count">
            {spectra.length} files loaded
          </span>
        </section>

        {error && (
          <div className="error">{error}</div>
        )}

        {/* グラフ設定 */}
        <section className="settings-section">
          <h2>Graph Settings</h2>

          <div className="settings-grid">
            <div className="setting-group">
              <h3>Wavelength (nm)</h3>

              <label>
                Minimum
                <input
                  type="number"
                  value={xMinInput}
                  placeholder="Auto"
                  onChange={(e) => setXMinInput(e.target.value)}
                />
              </label>

              <label>
                Maximum
                <input
                  type="number"
                  value={xMaxInput}
                  placeholder="Auto"
                  onChange={(e) => setXMaxInput(e.target.value)}
                />
              </label>
            </div>

            <div className="setting-group">
              <h3>Intensity (a.u.)</h3>

              <label>
                Minimum
                <input
                  type="number"
                  value={yMinInput}
                  placeholder="Auto"
                  onChange={(e) => setYMinInput(e.target.value)}
                />
              </label>

              <label>
                Maximum
                <input
                  type="number"
                  value={yMaxInput}
                  placeholder="Auto"
                  onChange={(e) => setYMaxInput(e.target.value)}
                />
              </label>
            </div>
          </div>

          <button
            className="reset-button"
            onClick={() => {
              setXMinInput("");
              setXMaxInput("");
              setYMinInput("");
              setYMaxInput("");
            }}
          >
            Reset to Auto
          </button>

          {chart && (
            <p className="range-info">
              Integration range: {formatNumber(chart.xMin)} – {formatNumber(chart.xMax)} nm
            </p>
          )}
        </section>

        {/* スペクトルグラフ */}
        <section className="graph-section">

          <div className="graph-header">
            <div>
              <h2>Intensity Spectra</h2>
              <p>Overlay visualization</p>
            </div>

            <div className="actions">
              <button
                onClick={saveCSV}
                disabled={!spectra.length}
              >
                Export CSV
              </button>

              <button
                onClick={savePNG}
                disabled={!chart}
              >
                Export PNG
              </button>
            </div>
          </div>

          {chart ? (
            <div className="chart-container">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                className="chart"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <clipPath id="plotClip">
                    <rect
                      x={chart.left}
                      y={chart.top}
                      width={chart.plotWidth}
                      height={chart.plotHeight}
                    />
                  </clipPath>
                </defs>

                <rect
                  width={chart.width}
                  height={chart.height}
                  fill="white"
                />

                {/* Y軸グリッド */}
                {[0, 1, 2, 3, 4].map((i) => {
                  const y = chart.top +
                    (chart.plotHeight * i) / 4;

                  const value = chart.yMax -
                    ((chart.yMax - chart.yMin) * i) / 4;

                  return (
                    <g key={i}>
                      <line
                        x1={chart.left}
                        x2={chart.width - chart.right}
                        y1={y}
                        y2={y}
                        stroke="#e5e7eb"
                      />

                      <text
                        x={chart.left - 12}
                        y={y + 5}
                        textAnchor="end"
                        fontSize="13"
                        fill="#374151"
                      >
                        {formatNumber(value)}
                      </text>
                    </g>
                  );
                })}

                {/* X軸グリッド */}
                {[0, 1, 2, 3, 4, 5].map((i) => {
                  const x = chart.left +
                    (chart.plotWidth * i) / 5;

                  const value = chart.xMin +
                    ((chart.xMax - chart.xMin) * i) / 5;

                  return (
                    <g key={i}>
                      <line
                        x1={x}
                        x2={x}
                        y1={chart.top}
                        y2={chart.height - chart.bottom}
                        stroke="#f1f5f9"
                      />

                      <text
                        x={x}
                        y={chart.height - chart.bottom + 25}
                        textAnchor="middle"
                        fontSize="13"
                        fill="#374151"
                      >
                        {formatNumber(value)}
                      </text>
                    </g>
                  );
                })}

                {/* 軸 */}
                <line
                  x1={chart.left}
                  y1={chart.top}
                  x2={chart.left}
                  y2={chart.height - chart.bottom}
                  stroke="#111827"
                  strokeWidth="1.5"
                />

                <line
                  x1={chart.left}
                  y1={chart.height - chart.bottom}
                  x2={chart.width - chart.right}
                  y2={chart.height - chart.bottom}
                  stroke="#111827"
                  strokeWidth="1.5"
                />

                {/* 軸ラベル */}
                <text
                  x={chart.left + chart.plotWidth / 2}
                  y={chart.height - 12}
                  textAnchor="middle"
                  fontSize="17"
                  fontWeight="600"
                  fill="#111827"
                >
                  Wavelength (nm)
                </text>

                <text
                  transform={`translate(22 ${chart.top + chart.plotHeight / 2}) rotate(-90)`}
                  textAnchor="middle"
                  fontSize="17"
                  fontWeight="600"
                  fill="#111827"
                >
                  Intensity (a.u.)
                </text>

                {/* スペクトル */}
                <g clipPath="url(#plotClip)">
                  {chart.visible.map((s) => {
                    const original = spectra.find(
                      (item) => item.id === s.id
                    );

                    const color = COLORS[
                      spectra.indexOf(original) % COLORS.length
                    ];

                    const points = s.data
                      .filter((p) =>
                        p.x >= chart.xMin && p.x <= chart.xMax
                      )
                      .map((p) =>
                        `${chart.X(p.x)},${chart.Y(p.y)}`
                      )
                      .join(" ");

                    return (
                      <polyline
                        key={s.id}
                        points={points}
                        fill="none"
                        stroke={color}
                        strokeWidth="2"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    );
                  })}
                </g>

                {/* グラフ内の凡例 */}
                {chart.visible.length > 0 && (
                  <g>
                    <rect
                      x={chart.width - chart.right - 245}
                      y={chart.top + 10}
                      width="235"
                      height={chart.visible.length * 22 + 16}
                      rx="6"
                      fill="white"
                      fillOpacity="0.92"
                      stroke="#cbd5e1"
                    />

                    {chart.visible.map((s) => {
                      const original = spectra.find(
                        (item) => item.id === s.id
                      );

                      const color = COLORS[
                        spectra.indexOf(original) % COLORS.length
                      ];

                      const index = chart.visible.indexOf(s);

                      return (
                        <g key={s.id}>
                          <line
                            x1={chart.width - chart.right - 230}
                            x2={chart.width - chart.right - 210}
                            y1={chart.top + 26 + index * 22}
                            y2={chart.top + 26 + index * 22}
                            stroke={color}
                            strokeWidth="3"
                          />

                          <text
                            x={chart.width - chart.right - 202}
                            y={chart.top + 30 + index * 22}
                            fontSize="11"
                            fill="#334155"
                          >
                            {s.name.length > 27
                              ? s.name.slice(0, 24) + "..."
                              : s.name}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}

              </svg>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">⌁</div>
              <h3>No spectra loaded</h3>
              <p>Select multiple ASC files to visualize intensity spectra.</p>
            </div>
          )}
        </section>

        {/* 積分グラフ */}
        <section className="graph-section">
          <div className="graph-header">
            <div>
              <h2>Integrated Intensity</h2>
              <p>Area under the curve (trapezoidal integration)</p>
            </div>

            <div className="actions">
              <button
                onClick={saveIntegralCSV}
                disabled={!integralChart}
              >
                Export CSV
              </button>

              <button
                onClick={saveIntegralPNG}
                disabled={!integralChart}
              >
                Export PNG
              </button>
            </div>
          </div>

          {integralChart ? (
            <>
              <div className="integral-range">
                Integration range: {formatNumber(chart.xMin)} – {formatNumber(chart.xMax)} nm
              </div>

              <div className="chart-container">
                <svg
                  ref={integralSvgRef}
                  viewBox={`0 0 ${integralChart.width} ${integralChart.height}`}
                  className="chart"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect
                    width={integralChart.width}
                    height={integralChart.height}
                    fill="white"
                  />

                  {[0, 1, 2, 3, 4].map((i) => {
                    const value =
                      integralChart.maxValue -
                      (integralChart.maxValue - integralChart.minValue) * i / 4;

                    const y = integralChart.Y(value);

                    return (
                      <g key={i}>
                        <line
                          x1={integralChart.left}
                          x2={integralChart.width - integralChart.right}
                          y1={y}
                          y2={y}
                          stroke="#e5e7eb"
                        />

                        <text
                          x={integralChart.left - 12}
                          y={y + 5}
                          textAnchor="end"
                          fontSize="12"
                          fill="#374151"
                        >
                          {formatNumber(value)}
                        </text>
                      </g>
                    );
                  })}

                  <line
                    x1={integralChart.left}
                    y1={integralChart.top}
                    x2={integralChart.left}
                    y2={integralChart.height - integralChart.bottom}
                    stroke="#111827"
                    strokeWidth="1.5"
                  />

                  <line
                    x1={integralChart.left}
                    y1={integralChart.height - integralChart.bottom}
                    x2={integralChart.width - integralChart.right}
                    y2={integralChart.height - integralChart.bottom}
                    stroke="#111827"
                    strokeWidth="1.5"
                  />

                  {integralChart.valid.map((s, i) => {
                    const count = integralChart.valid.length;
                    const slot = integralChart.plotWidth / count;
                    const barWidth = Math.min(55, slot * 0.65);

                    const x =
                      integralChart.left +
                      slot * i +
                      (slot - barWidth) / 2;

                    const zeroY = integralChart.Y(0);
                    const valueY = integralChart.Y(s.integral);

                    const y = Math.min(zeroY, valueY);
                    const height = Math.abs(zeroY - valueY);

                    const color = COLORS[
                      spectra.findIndex((item) => item.id === s.id) % COLORS.length
                    ];

                    return (
                      <g key={s.id}>
                        <rect
                          x={x}
                          y={y}
                          width={barWidth}
                          height={Math.max(height, 1)}
                          fill={color}
                          rx="3"
                        >
                          <title>
                            {s.name}: {s.integral.toFixed(2)}
                          </title>
                        </rect>

                        <text
                          x={x + barWidth / 2}
                          y={y - 7}
                          textAnchor="middle"
                          fontSize="11"
                          fill="#334155"
                        >
                          {formatNumber(s.integral)}
                        </text>

                        <text
                          transform={`translate(${x + barWidth / 2} ${integralChart.height - integralChart.bottom + 18}) rotate(-45)`}
                          textAnchor="end"
                          fontSize="11"
                          fill="#374151"
                        >
                          {s.name.length > 28
                            ? s.name.slice(0, 25) + "..."
                            : s.name}
                        </text>
                      </g>
                    );
                  })}

                  <text
                    transform={`translate(22 ${integralChart.top + integralChart.plotHeight / 2}) rotate(-90)`}
                    textAnchor="middle"
                    fontSize="16"
                    fontWeight="600"
                    fill="#111827"
                  >
                    Integrated Intensity (a.u.·nm)
                  </text>

                  <text
                    x={integralChart.left + integralChart.plotWidth / 2}
                    y={integralChart.height - 12}
                    textAnchor="middle"
                    fontSize="15"
                    fontWeight="600"
                    fill="#111827"
                  >
                    Sample
                  </text>
                </svg>
              </div>

              <div className="integral-table">
                <h3>Integrated Values</h3>

                {integralChart.valid.map((s) => (
                  <div className="integral-row" key={s.id}>
                    <span>{s.name}</span>
                    <strong>{s.integral.toFixed(2)} a.u.·nm</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty">
              <h3>No integration data available</h3>
              <p>Load spectra and select a valid wavelength range.</p>
            </div>
          )}
        </section>

        {/* ファイル一覧 */}
        <section className="file-section">
          <div className="file-header">
            <h2>Loaded Files</h2>

            <button
              className="clear-button"
              onClick={clearAll}
              disabled={!spectra.length}
            >
              Clear All
            </button>
          </div>

          {spectra.map((s, index) => (
            <div className="file-item" key={s.id}>
              <div className="file-name">
                <span
                  className="color-dot"
                  style={{
                    background: COLORS[index % COLORS.length],
                  }}
                />

                <span>{s.name}</span>
                <small>{s.data.length} points</small>
              </div>

              <button
                className={s.visible ? "visible" : "hidden"}
                onClick={() => toggleSpectrum(s.id)}
              >
                {s.visible ? "Visible" : "Hidden"}
              </button>
            </div>
          ))}
        </section>

      </main>

      <footer>
        Intensity Spectrum Analyzer · Research Tools
      </footer>

    </div>
  );
}
