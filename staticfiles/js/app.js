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

// Correlación (canvas manual para rendimiento)
/* async function drawCorrelation(){
    const res = await fetch(`${API_BASE}/correlation/?max=12&sample=10000`);
    const data = await res.json();
    const labels = data.labels || []; const M = data.matrix || [];
    const c = $('#corr'), ctx = c.getContext('2d');

    ctx.clearRect(0,0,c.width,c.height);
    if(!labels.length){ ctx.font='14px system-ui'; ctx.fillText('No hay suficientes columnas numéricas.', 10, 20); return; }

    const marginL=130, marginT=20, marginR=50, marginB=135;
    const w=c.width, h=c.height, plotW=Math.max(50,w-marginL-marginR), plotH=Math.max(50,h-marginT-marginB);
    const n=labels.length, cellW=plotW/n, cellH=plotH/n;

    const color=(v)=>{ const t=Math.max(-1,Math.min(1,v)); const r=t>0?Math.floor(255*t):0, b=t<0?Math.floor(255*(-t)):0, g=255-Math.floor(255*Math.abs(t)); return `rgb(${r},${g},${b})`; };

    for(let i=0;i<n;i++){ for(let j=0;j<n;j++){ ctx.fillStyle=color(M[i][j]); ctx.fillRect(marginL+j*cellW, marginT+i*cellH, Math.ceil(cellW), Math.ceil(cellH)); } }
    ctx.fillStyle= getComputedStyle(document.documentElement).getPropertyValue('--text') || '#000';
    ctx.font='12px system-ui'; ctx.textAlign='right'; ctx.textBaseline='middle';
    for(let i=0;i<n;i++){ ctx.fillText(labels[i], marginL-8, marginT+i*cellH+cellH/2); }
    ctx.textAlign='right'; ctx.textBaseline='top';
    for(let j=0;j<n;j++){ const x=marginL+j*cellW+cellW/2; const y=marginT+plotH+8; ctx.save(); ctx.translate(x,y); ctx.rotate(-Math.PI/4); ctx.fillText(labels[j],0,0); ctx.restore(); }

  // barra color
    const barX=marginL+plotW+12, barY=marginT, barW=12, barH=plotH;
    for(let k=0;k<barH;k++){ const v=1-(k/barH)*2; ctx.fillStyle=color(v); ctx.fillRect(barX, barY+k, barW, 1); }
    ctx.strokeStyle='#3333'; ctx.strokeRect(barX, barY, barW, barH);
    ctx.font='11px system-ui'; ctx.textAlign='left';
    ctx.fillText('+1', barX+barW+6, barY+8); ctx.fillText('0', barX+barW+6, barY+barH/2); ctx.fillText('-1', barX+barW+6, barY+barH-6);
} */

// Boot
(async function(){
    try{
    await loadSummary();
    await Promise.all([drawNulls(), drawCardinality(), drawTypes(), drawOutliers()]);
    await setupDistribution();
    // await drawCorrelation();
    }catch(e){
    console.error(e);
    showErr('No se pudo cargar la API. Verifica que el servidor esté activo y que DATASET_PATH apunte a un CSV válido.');
    }
})();
