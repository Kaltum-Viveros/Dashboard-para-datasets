// ====================================================================
// app.js  — Dashboard
// Requiere en la plantilla (antes de este archivo):
// <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3"></script>
// <script src="https://cdn.jsdelivr.net/npm/chartjs-chart-box-and-violin-plot@4.3.3/build/index.umd.min.js"></script>
// <script>
//   Chart.register(
//     ChartBoxPlot.BoxPlotController,
//     ChartBoxPlot.BoxPlotChart,
//     ChartBoxPlot.BoxAndWhiskers,
//     ChartBoxPlot.ViolinPlotController,
//     ChartBoxPlot.Violin
//   );
// </script>
// ====================================================================

// Config
const API_BASE = "/api";
const DS_PATH  = "{{ ds_path|default:'' }}";

// Helpers
const $ = (q)=>document.querySelector(q);
const fmt = (n)=> (typeof n==='number') ? n.toLocaleString() : n;
async function j(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
function showErr(msg){
  const box = $('#errBox');
  if (!box) return;
  box.textContent = msg;
  box.style.display = 'block';
}

// ================= KPIs & Dataset pill =================
async function loadSummary(){
  const s = await j(`${API_BASE}/summary/`);
  $('#kpi-rows').textContent = fmt(s.rows);
  $('#kpi-cols').textContent = fmt(s.cols);
  $('#kpi-null').textContent = `${s.null_pct}%`;
  $('#kpi-dups').textContent = fmt(s.dup_rows);
}

// ================== Chart helpers (barras) ==================
function makeBar(canvasOrCtx, labels, data, label){
  return new Chart(canvasOrCtx, {
    type: 'bar',
    data: { labels, datasets: [{ label, data }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false }, tooltip:{ intersect:false } },
      scales:{
        x: { ticks:{ autoSkip:false, maxRotation:90, minRotation:45 } },
        y: { beginAtZero:true, ticks:{ precision:0 } }
      }
    }
  });
}

async function drawNulls(){
  const data = await j(`${API_BASE}/nulls-per-column/`);
  const top = data.slice(0, 30);
  makeBar($('#nulls'), top.map(d=>d.column), top.map(d=>d.nulls), 'Nulos');
}
async function drawCardinality(){
  const data = await j(`${API_BASE}/cardinality/`);
  const top = data.slice(0, 30);
  makeBar($('#card'), top.map(d=>d.column), top.map(d=>d.unique), 'Cardinalidad');
}
async function drawTypes(){
  const data = await j(`${API_BASE}/types/`);
  makeBar($('#types'), data.map(d=>d.dtype), data.map(d=>d.columns), 'Columnas por tipo');
}
async function drawOutliers(){
  const data = await j(`${API_BASE}/outliers/`);
  const top = data.slice(0, 30);
  makeBar($('#outliers'), top.map(d=>d.column), top.map(d=>d.outliers), 'Outliers');
}

// ==================== Distribución interactiva ====================
let distChart = null;
const toNums = (a)=> (a || []).map(v => Number(v) || 0);
function yOpts(maxVal){
  const m = Math.max(1, Math.ceil(maxVal || 1));
  return { beginAtZero: true, suggestedMax: m, ticks: { precision: 0 } };
}

async function setupDistribution(){
  const sel = $('#colSel');
  const card = await j(`${API_BASE}/cardinality/`);
  card.forEach(it=>{
    const opt = document.createElement('option');
    opt.value = it.column; opt.textContent = it.column;
    sel.appendChild(opt);
  });

  async function render(){
    const col = sel.value;
    const data = await j(`${API_BASE}/distribution/?column=${encodeURIComponent(col)}&bins=20&top=50`);
    const canvas = $('#dist');
    const ctx = canvas.getContext('2d');
    Chart.getChart(canvas)?.destroy(); distChart?.destroy();

    const baseOpts = {
      responsive:true, maintainAspectRatio:false, animation:false,
      plugins:{ legend:{ display:false } },
      scales:{ x:{ ticks:{ autoSkip:false, maxRotation:90, minRotation:45 } } }
    };

    if (data.numeric){
      const counts = toNums(data.counts);
      const labels = [];
      for (let i=0;i<data.bins.length-1;i++){
        labels.push(`${Number(data.bins[i]).toFixed(2)}–${Number(data.bins[i+1]).toFixed(2)}`);
      }
      const maxVal = Math.max(...counts, 0);
      if (maxVal===0){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillText(`Sin frecuencias positivas para “${col}”.`, 10, 20); return; }
      const xy = labels.map((x,i)=>({x, y:counts[i]}));
      distChart = new Chart(ctx, { type:'bar',
        data:{ datasets:[{ label:`Histograma: ${col}`, data:xy, maxBarThickness:28, barPercentage:.9, categoryPercentage:.8 }]},
        options:{ ...baseOpts, scales:{ ...baseOpts.scales, y:yOpts(maxVal) } }
      });
    } else {
      const counts = toNums(data.counts);
      const maxVal = Math.max(...counts, 0);
      if (data.unique_like || maxVal<=1){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillText(`“${col}” parece casi única.`, 10, 20); return; }
      const labels = data.labels || [];
      const xy = labels.map((x,i)=>({x, y:counts[i]}));
      distChart = new Chart(ctx, { type:'bar',
        data:{ datasets:[{ label:`Top categorías: ${col}`, data:xy, maxBarThickness:28, barPercentage:.9, categoryPercentage:.8 }]},
        options:{ ...baseOpts, scales:{ ...baseOpts.scales, y:yOpts(maxVal) } }
      });
    }
  }
  sel.addEventListener('change', ()=>render());
  sel.selectedIndex = 0; await render();
}

// ==================== Utilidades para nuevos charts ====================
const idSafe = (s) => ('c_' + String(s).replace(/[^a-zA-Z0-9_-]/g, '_'));

function ensureCanvas(parentId, canvasId, titleText) {
  const container = document.getElementById(parentId);
  if (!container) throw new Error(`Falta contenedor #${parentId}`);

  let el = document.getElementById(canvasId);
  if (!el || el.tagName.toLowerCase() !== 'canvas') {
    const wrap = document.createElement('div');
    wrap.className = 'card mb-3';
    if (titleText) {
      const h = document.createElement('h4');
      h.textContent = titleText;
      wrap.appendChild(h);
    }
    el = document.createElement('canvas');
    el.id = canvasId;
    el.height = 240; // opcional
    wrap.appendChild(el);
    container.appendChild(wrap);
  }
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error(`No se pudo obtener contexto 2D de #${canvasId}`);
  return ctx;
}

// ==================== NUEVOS: Histogramas globales ====================
async function drawHistograms(){
  const res = await fetch(`${API_BASE}/histograms/`);
  if(!res.ok) throw new Error("histograms " + res.status);
  const data = await res.json();

  for (const [col, obj] of Object.entries(data)) {
    const cid = idSafe(`hist-${col}`);
    const ctx = ensureCanvas("histogramsContainer", cid, col);
    new Chart(ctx, {
      type: "bar",
      data: { labels: obj.bins, datasets: [{ label: "Frecuencia", data: obj.freq }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

// ==================== NUEVOS: Boxplots ====================
async function drawBoxplots(){
  const res = await fetch(`${API_BASE}/boxplots/`);
  if(!res.ok) throw new Error("boxplots " + res.status);
  const data = await res.json();

  for (const [col, st] of Object.entries(data)) {
    const cid = idSafe(`box-${col}`);
    const ctx = ensureCanvas("boxplotsContainer", cid, col);
    // Requiere plugin registrado
    new Chart(ctx, {
      type: "boxplot",
      data: {
        labels: [col],
        datasets: [{
          label: "Resumen",
          // [min, q1, median, q3, max]
          data: [[st.min, st.q1, st.median, st.q3, st.max]]
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

// ==================== NUEVOS: Top-K categóricas ====================
async function drawTopK(){
  const res = await fetch(`${API_BASE}/topk/?k=10`);
  if(!res.ok) throw new Error("topk " + res.status);
  const data = await res.json();

  for (const [col, obj] of Object.entries(data)) {
    const cid = idSafe(`topk-${col}`);
    const ctx = ensureCanvas("topkContainer", cid, col);
    new Chart(ctx, {
      type: "bar",
      data: { labels: obj.labels, datasets: [{ label: "Conteos", data: obj.counts }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display:false } }
      }
    });
  }
}

// ==================== Boot ====================
(async function(){
  try{
    await loadSummary();
    await Promise.all([
      drawNulls(),
      drawCardinality(),
      drawTypes(),
      drawOutliers()
    ]);
    await setupDistribution();
    // Nuevos gráficos
    await drawHistograms();
    await drawBoxplots();
    await drawTopK();

  }catch(e){
    console.error(e);
    showErr('No se pudo cargar la API. Verifica que el servidor esté activo y que DATASET_PATH apunte a un CSV válido.');
  }
})();
