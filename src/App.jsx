```jsx
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

  return {
    name,
    data,
    visible: true,
  };
}

export default function App() {
  const [spectra, setSpectra] = useState([]);
  const [error, setError] = useState("");
  const svgRef = useRef(null);

  // ASCファイル読み込み
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
        ...loaded.map((s) => ({ ...s, id: crypto.randomUUID() }))
      ]);
    } catch (e) {
      setError(e.message);
    }

    event.target.value = "";
  }

  // 表示・非表示切り替え
  function toggleSpectrum(id) {
    setSpectra((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, visible: !s.visible } : s
      )
    );
  }

  // 全削除
  function clearAll() {
    setSpectra([]);
    setError("");
  }

  // グラフ用データ
  const chart = useMemo(() => {
    const visible = spectra.filter((s) => s.visible);

    if (!visible.length) return null;

    const allPoints = visible.flatMap((s) => s.data);

    const xMin = Math.min(...allPoints.map((p) => p.x));
    const xMax = Math.max(...allPoints.map((p) => p.x));
    const yMin = Math.min(...allPoints.map((p) => p.y));
    const yMax = Math.max(...allPoints.map((p) => p.y));

    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    const left = 85;
    const right = 25;
    const top = 30;
    const bottom = 65;

    const width = 900;
    const height = 520;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    const X = (x) => left + ((x - xMin) / xRange) * plotWidth;
    const Y = (y) => top + ((yMax - y) / yRange) * plotHeight;

    return {
      visible,
      xMin,
      xMax,
      yMin,
      yMax,
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
  }, [spectra]);

  // PNG保存
  async function savePNG() {
    const svg = svgRef.current;
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], {
      type: "image/svg+xml;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1800;
      canvas.height = 1040;

      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const link = document.createElement("a");
      link.download = "fluorescence_spectra.png";
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

  // CSV保存
  function saveCSV() {
    if (!spectra.length) return;

    const wavelengths = [
      ...new Set(spectra.flatMap((s) => s.data.map((p) => p.x)))
    ].sort((a, b) => a - b);

    const header = [
      "Wavelength (nm)",
      ...spectra.map((s) => s.name)
    ];

    const rows = wavelengths.map((x) => {
      return [
        x,
        ...spectra.map((s) => {
          const point = s.data.find((p) => p.x === x);
          return point ? point.y : "";
        })
      ].join(",");
    });

    const csv = [header.join(","), ...rows].join("\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fluorescence_data.csv";
    link.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="app">

      <header className="header">
        <div>
          <h1>Fluorescence Spectrum Analyzer</h1>
          <p>ASC File Visualization Tool</p>
        </div>
        <span className="version">VERSION 1.0</span>
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

        <section className="graph-section">

          <div className="graph-header">
            <div>
              <h2>Fluorescence Spectra</h2>
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

                <rect
                  width={chart.width}
                  height={chart.height}
                  fill="white"
                />

                {/* Grid and axes */}
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
                        strokeWidth="1"
                      />

                      <text
                        x={chart.left - 12}
                        y={y + 5}
                        textAnchor="end"
                        fontSize="13"
                        fill="#374151"
                      >
                        {value.toFixed(2)}
                      </text>
                    </g>
                  );
                })}

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
                        {value.toFixed(0)}
                      </text>
                    </g>
                  );
                })}

                {/* Axis lines */}
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

                {/* Axis labels */}
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
                  Fluorescence intensity (a.u.)
                </text>

                {/* Spectra */}
                {chart.visible.map((s) => {
                  const original = spectra.find(
                    (item) => item.id === s.id
                  );

                  const color = COLORS[
                    spectra.indexOf(original) % COLORS.length
                  ];

                  const points = s.data
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

              </svg>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">⌁</div>
              <h3>No spectra loaded</h3>
              <p>Select multiple ASC files to visualize fluorescence spectra.</p>
            </div>
          )}

        </section>

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
                    background: COLORS[index % COLORS.length]
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
        Fluorescence Spectrum Analyzer · Research Tools
      </footer>

    </div>
  );
}
```
