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
    box.textContent = msg;
    box.style.display = 'block';
}

// KPIs & Dataset pill
async function loadSummary(){
    const s = await j(`${API_BASE}/summary/`);
    $('#kpi-rows').textContent = fmt(s.rows);
    $('#kpi-cols').textContent = fmt(s.cols);
    $('#kpi-null').textContent = `${s.null_pct}%`;
    $('#kpi-dups').textContent = fmt(s.dup_rows);
}

// Chart helpers
function makeBar(ctx, labels, data, label){
    return new Chart(ctx, {
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

//Distribución
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
// Boot
(async function(){
    try{
    await loadSummary();
    await Promise.all([drawNulls(), drawCardinality(), drawTypes(), drawOutliers()]);
    await setupDistribution();
    await renderDescribeTable(); 
    }catch(e){
    console.error(e);
    showErr('No se pudo cargar la API. Verifica que el servidor esté activo y que DATASET_PATH apunte a un CSV válido.');
    }
})();

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

let boxChart = null;

async function initBoxplot() {
  const sel = document.getElementById('boxColSel');
  const canvas = document.getElementById('boxplot');
  if (!sel || !canvas) return;

  try {
    // 1) Cargar columnas numéricas
    const meta = await fetchJSON('/api/numeric-columns');
    const cols = meta.columns || [];
    sel.innerHTML = '';
    cols.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });

    if (cols.length === 0) {
      // No hay columnas numéricas
      const ctx = canvas.getContext('2d');
      ctx.font = '14px sans-serif';
      ctx.fillText('No hay columnas numéricas en el dataset.', 10, 24);
      return;
    }

    // 2) Escucha cambios y pinta
    sel.addEventListener('change', () => drawBoxplot(sel.value, canvas));
    // 3) Pinta la primera por defecto
    await drawBoxplot(cols[0], canvas);

  } catch (err) {
    console.error('initBoxplot error:', err);
  }
}

// === Reemplaza tu drawBoxplot y añade renderBoxplotCanvas ===

// Dibuja un boxplot simple con Canvas 2D usando los stats del endpoint
function renderBoxplotCanvas(canvas, stats) {
  const ctx = canvas.getContext('2d');
  const DPR = window.devicePixelRatio || 1;

  // tamaño lógico
  const W = canvas.clientWidth || 600;
  const H = canvas.clientHeight || 320;

  // escalar para HiDPI
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // limpiar
  ctx.clearRect(0, 0, W, H);

  // padding y escala
  const PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 30;

  // rango de valores (usa whiskers)
  const vmin = Math.min(stats.min, stats.lower_fence ?? stats.min);
  const vmax = Math.max(stats.max, stats.upper_fence ?? stats.max);
  const range = vmax - vmin || 1;

  // escala Y (arriba menor, abajo mayor)
  const y = (val) => {
    const t = (val - vmin) / range;
    // invertido porque Y crece hacia abajo
    return PAD_T + (1 - t) * (H - PAD_T - PAD_B);
  };

  // centro X donde dibujamos
  const cx = (PAD_L + (W - PAD_R)) / 2;

  // estilos
  ctx.strokeStyle = '#334155';
  ctx.fillStyle = '#94a3b8';
  ctx.lineWidth = 2;

  // --- whiskers ---
  const yMin = y(stats.min);
  const yMax = y(stats.max);
  ctx.beginPath();
  // línea vertical whiskers
  ctx.moveTo(cx, yMin);
  ctx.lineTo(cx, yMax);
  ctx.stroke();

  // “bigotes” horizontales
  const whiskW = 40;
  ctx.beginPath();
  ctx.moveTo(cx - whiskW/2, yMin);
  ctx.lineTo(cx + whiskW/2, yMin);
  ctx.moveTo(cx - whiskW/2, yMax);
  ctx.lineTo(cx + whiskW/2, yMax);
  ctx.stroke();

  // --- caja Q1–Q3 ---
  const yQ1 = y(stats.q1);
  const yQ3 = y(stats.q3);
  const boxW = 120;
  ctx.fillStyle = 'rgba(59,130,246,0.15)'; // azul suave
  ctx.strokeStyle = '#3b82f6';
  ctx.beginPath();
  ctx.rect(cx - boxW/2, yQ3, boxW, (yQ1 - yQ3));
  ctx.fill();
  ctx.stroke();

  // --- mediana ---
  const yMed = y(stats.median);
  ctx.strokeStyle = '#1d4ed8';
  ctx.beginPath();
  ctx.moveTo(cx - boxW/2, yMed);
  ctx.lineTo(cx + boxW/2, yMed);
  ctx.stroke();

  // --- outliers ---
  const outs = stats.outliers || [];
  ctx.fillStyle = '#ef4444';
  outs.forEach(v => {
    const yy = y(v);
    // solo marca puntos fuera de [min,max] si quieres
    ctx.beginPath();
    ctx.arc(cx, yy, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // --- eje y ticks básicos ---
  ctx.fillStyle = '#64748b';
  ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  const TICKS = 5;
  for (let i = 0; i <= TICKS; i++) {
    const val = vmin + (range * i) / TICKS;
    const yy = y(val);
    // línea guía
    ctx.strokeStyle = 'rgba(100,116,139,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, yy);
    ctx.lineTo(W - PAD_R, yy);
    ctx.stroke();
    // etiqueta
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(Number(val).toPrecision(4), PAD_L - 8, yy);
  }

  // título
  ctx.fillStyle = '#475569';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  ctx.fillText(`Boxplot de ${stats.column}`, cx, 4);
}

async function drawBoxplot(column, canvas) {
  try {
    const data = await fetchJSON(`/api/boxplot?column=${encodeURIComponent(column)}`);
    renderBoxplotCanvas(canvas, data);
  } catch (err) {
    console.error('drawBoxplot error:', err);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ef4444';
    ctx.font = '14px sans-serif';
    ctx.fillText(`No se pudo dibujar el boxplot: ${String(err)}`, 10, 24);
  }
}

// Llama a initBoxplot() junto con tus otras inicializaciones
window.addEventListener('load', () => {
  // ... tus inits existentes ...
  initBoxplot();
});


// ======= Describe numérico =======
function fmtNum(x){
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  if (Math.abs(x) >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return x.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

async function renderDescribeTable(){
  try{
    const data = await j('/api/describe/');
    const cols = ['column', ...(data.columns || [])];
    const table = document.getElementById('descTable');
    if (!table) return;

    // THEAD
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    cols.forEach(h=>{
      const th = document.createElement('th');
      th.textContent =
        h === 'column' ? 'Columna' :
        h === 'p05'    ? '5%' :
        h === 'p25'    ? '25%' :
        h === 'median' ? 'Mediana' :
        h === 'p75'    ? '75%' :
        h === 'p95'    ? '95%' : h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);

    // TBODY
    const tbody = document.createElement('tbody');
    (data.rows || []).forEach(row=>{
      const tr = document.createElement('tr');
      cols.forEach(k=>{
        const td = document.createElement('td');
        td.textContent = (k === 'column') ? row[k] : fmtNum(row[k]);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    table.innerHTML = '';
    table.appendChild(thead);
    table.appendChild(tbody);
  }catch(e){
    console.error(e);
    showErr('No se pudo cargar la tabla de estadísticos.');
  }
}
// Mantén este listener (inicia el boxplot al cargar)
window.addEventListener('load', () => {
  initBoxplot();
});

