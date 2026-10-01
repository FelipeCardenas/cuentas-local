const statsPanel=document.createElement('section');
statsPanel.id='statsPanel';statsPanel.hidden=true;
$('ledger').parentElement.appendChild(statsPanel);
const statsNav=document.createElement('button');
statsNav.className='nav';statsNav.dataset.view='statistics';
statsNav.innerHTML='<i data-lucide="chart-no-axes-combined"></i>Estadísticas';
document.querySelector('[data-view="cuts"]').after(statsNav);
statsNav.onclick=()=>setView('statistics');
const originalSetView=setView;
setView=function(next){
 originalSetView(next);statsPanel.hidden=next!=='statistics';
 if(next==='statistics'){
  $('ledger').hidden=true;document.querySelector('.heading-actions').hidden=true;
  $('title').textContent='Estadísticas de gastos';$('breadcrumb').textContent='Estadísticas';
  loadStatistics();
 }
};
icons();
let statsData={},statsSequence=0;
const statsMonths=Array.from({length:12},(_,i)=>new Date(2026,i,1).toLocaleDateString('es-CL',{month:'short'}));
async function loadStatistics(){
 const sequence=++statsSequence;
 const previous=['statsYear','statsCompare','statsPerson'].map(id=>$(id)?.value);
 statsPanel.setAttribute('aria-busy','true');
 try{
  const data=await api('/api/statistics');if(sequence!==statsSequence)return;
  statsData=data.years;const years=Object.keys(statsData).sort().reverse();
  if(!years.length){statsPanel.innerHTML='<div class="empty"><h2>Sin gastos confirmados</h2></div>';return;}
  const options=years.map(y=>`<option value="${y}">${y}</option>`).join('');
  statsPanel.innerHTML=`<div class="filters stats-filters"><label class="field">Año<select id="statsYear">${options}</select></label><label class="field">Comparar con<select id="statsCompare"><option value="">Sin comparación</option>${options}</select></label><label class="field">Gasto<select id="statsPerson"><option value="total">Total</option><option value="mi">Mi</option><option value="amor">Amor</option></select></label></div>
   <p class="muted">Confirmados · gastos menos devoluciones · período asignado · CLP. Los períodos pueden estar incompletos; sin registros: —.</p>
   <section id="statsMetrics" class="metrics stats-metrics"></section>
   <section class="stats-chart-section"><h2>Comparativa mensual</h2><div id="statsLegend" class="stats-legend"></div><div class="stats-canvas"><canvas id="statsChart" role="img" aria-label="Comparativa mensual; valores disponibles en la tabla inferior"></canvas></div></section>
   <section class="stats-chart-section"><h2>Tendencia mensual</h2><div class="stats-legend"><span class="stats-key current">Gasto mensual</span><span class="stats-key average">Media móvil de 3 meses</span><span class="stats-key trend">Proyección</span></div><p id="statsProjectionNote" class="muted"></p><div class="stats-canvas"><canvas id="statsTrend" role="img" aria-label="Gasto mensual, media móvil y proyección; valores disponibles en la tabla inferior"></canvas></div></section>
   <section id="statsForecastMetrics" class="metrics stats-metrics"></section>
   <div class="table-wrap"><table><thead><tr><th>Mes</th><th id="statsYearHeading" class="numeric"></th><th id="statsCompareHeading" class="numeric"></th><th class="numeric">Desviación CLP</th><th class="numeric">Variación %</th><th class="numeric">Media 3 meses</th><th class="numeric">Proyección</th></tr></thead><tbody id="statsRows"></tbody></table></div>`;
  $('statsYear').value=years.includes(previous[0])?previous[0]:years[0];
  $('statsCompare').value=previous[1]!==undefined&&(previous[1]===''||years.includes(previous[1]))?previous[1]:(years[1]||'');
  $('statsPerson').value=previous[2]||'total';
  setupExplanation();
  for(const id of ['statsYear','statsCompare','statsPerson'])$(id).onchange=()=>{renderStatistics();loadExplanation();};
  renderStatistics();
  loadExplanation();
 }catch(e){statsPanel.innerHTML='<div class="error" role="alert">'+esc(e.message)+'</div>';}
 finally{if(sequence===statsSequence)statsPanel.removeAttribute('aria-busy');}
}
function statsSeries(year,who){return (statsData[year]||Array(12).fill(null)).map(m=>m?.[who]??null);}
function statsAverage(a){return a.map((_,i)=>i<2||a.slice(i-2,i+1).some(v=>v===null)?null:a.slice(i-2,i+1).reduce((s,v)=>s+v,0)/3);}
function statsProjection(a,b){
 const last=a.reduce((end,v,i)=>v===null?end:i,-1);
 const pairs=a.map((v,i)=>v!==null&&b[i]!==null?i:null).filter(i=>i!==null);
 const base=pairs.reduce((s,i)=>s+b[i],0),actual=pairs.reduce((s,i)=>s+a[i],0);
 const rate=pairs.length&&base>0?(actual-base)/base:null;
 const forecast=a.map((v,i)=>last>=0&&i>last&&b[i]!==null&&rate!==null?Math.round(b[i]*(1+rate)*100)/100:null);
 return {forecast,last,rate,pairs:pairs.length};
}
function renderStatistics(){
 if(! $('statsYear'))return;
 const year=$('statsYear').value,compare=$('statsCompare').value,who=$('statsPerson').value;
 const a=statsSeries(year,who),b=statsSeries(compare,who),avg=statsAverage(a);
 const projectionYear=compare&&Number(compare)<Number(year)?compare:String(Number(year)-1);
 const projection=statsProjection(a,statsSeries(projectionYear,who)),forecast=projection.forecast;
 const pairs=a.map((v,i)=>v!==null&&b[i]!==null?i:null).filter(i=>i!==null);
 const sum=a.reduce((s,v)=>s+(v??0),0),delta=pairs.reduce((s,i)=>s+a[i]-b[i],0);
 const base=pairs.reduce((s,i)=>s+b[i],0),percent=base===0?null:delta/Math.abs(base)*100;
 const pct=v=>v===null?'—':new Intl.NumberFormat('es-CL',{maximumFractionDigits:1,signDisplay:'exceptZero'}).format(v)+' %';
 $('statsMetrics').innerHTML=`<div><span>Total ${year} · ${esc($('statsPerson').selectedOptions[0].text)}</span><strong>${money(sum)}</strong><small>${a.filter(v=>v!==null).length} meses con registros</small></div><div><span>Desviación interanual</span><strong>${pairs.length?money(delta):'—'}</strong><small>${pairs.length} meses comparables</small></div><div><span>Variación interanual</span><strong>${pct(percent)}</strong><small>Mismos meses con registros en ambos años</small></div>`;
 const projectedMonths=forecast.filter(v=>v!==null).length,remaining=forecast.reduce((s,v)=>s+(v??0),0);
 const complete=projectedMonths>0&&a.every((v,i)=>v!==null||forecast[i]!==null);
 $('statsProjectionNote').textContent=projectedMonths?`Base ${projectionYear} · ajuste ${pct(projection.rate*100)} · ${projection.pairs} meses comparables hasta ${statsMonths[projection.last]}. Estimación con registros disponibles, incluidos períodos parciales.`:'Sin proyección: faltan meses futuros con referencia histórica o una base comparable positiva.';
 $('statsForecastMetrics').innerHTML=`<div><span>Gasto futuro proyectado</span><strong>${projectedMonths?money(remaining):'—'}</strong><small>${projectedMonths} meses con estimación</small></div><div><span>Cierre anual estimado</span><strong>${complete?money(sum+remaining):'—'}</strong><small>${complete?'Real acumulado + proyección':'Sin cobertura completa de los 12 meses'}</small></div>`;
 $('statsLegend').innerHTML=`<span class="stats-key current">${year}</span>${compare?`<span class="stats-key previous">${compare}</span>`:''}${projectedMonths?'<span class="stats-key trend">Proyección</span>':''}`;
 $('statsYearHeading').textContent=year;$('statsCompareHeading').textContent=compare||'Comparación';
 $('statsRows').innerHTML=a.map((v,i)=>{const d=v===null||b[i]===null?null:v-b[i];return `<tr><td>${statsMonths[i]}</td><td class="numeric">${money(v)}</td><td class="numeric">${money(b[i])}</td><td class="numeric">${money(d)}</td><td class="numeric">${pct(d===null||b[i]===0?null:d/Math.abs(b[i])*100)}</td><td class="numeric">${money(avg[i])}</td><td class="numeric stats-projected">${money(forecast[i])}</td></tr>`;}).join('');
 const forecastLine=[...forecast];if(projectedMonths&&forecast[projection.last+1]!==null)forecastLine[projection.last]=a[projection.last];
 drawStatistics($('statsChart'),[a,b,forecast],false);drawStatistics($('statsTrend'),[a,avg,forecastLine],true);
}
function drawStatistics(canvas,series,line){
 const width=canvas.parentElement.clientWidth,height=280,dpr=window.devicePixelRatio||1;
 canvas.width=Math.round(width*dpr);canvas.height=height*dpr;
 const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
 const left=62,right=10,top=18,bottom=35,w=width-left-right,h=height-top-bottom;
 const values=series.flat().filter(v=>v!==null);let min=Math.min(0,...values),max=Math.max(0,...values);if(min===max)max=min+1;
 const y=v=>top+h-(v-min)/(max-min)*h,x=i=>left+w*(i+.5)/12;
 ctx.font='11px system-ui';ctx.textAlign='right';
 for(let j=0;j<=4;j++){const value=min+(max-min)*j/4,py=y(value);ctx.strokeStyle='#e0e7e5';ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(width-right,py);ctx.stroke();ctx.fillStyle='#62716d';ctx.fillText(new Intl.NumberFormat('es-CL',{notation:'compact',maximumFractionDigits:1}).format(value),left-7,py+4);}
 ctx.textAlign='center';statsMonths.forEach((m,i)=>ctx.fillText(m,x(i),height-12));
 series.forEach((items,s)=>{ctx.strokeStyle=ctx.fillStyle=s===2?'#d47716':s?'#597da0':'#246d5c';ctx.lineWidth=2;ctx.setLineDash(line&&s===2?[6,4]:[]);
  if(line){ctx.beginPath();let active=false;items.forEach((v,i)=>{if(v===null){active=false;return;}if(active)ctx.lineTo(x(i),y(v));else ctx.moveTo(x(i),y(v));active=true;});ctx.stroke();}
  items.forEach((v,i)=>{if(v===null)return;if(line){ctx.beginPath();ctx.arc(x(i),y(v),3,0,Math.PI*2);ctx.fill();}else{const bw=Math.min(18,w/30);ctx.fillRect(x(i)+(s===1?1:-bw-1),Math.min(y(v),y(0)),bw,Math.max(1,Math.abs(y(v)-y(0))));}});
 });
}
let explanationData=null,explanationSequence=0,explanationMonth='';
function setupExplanation(){
 $('statsMetrics').insertAdjacentHTML('afterend',`<section class="stats-chart-section" id="explanationPanel">
  <div class="section-heading"><h2>¿Qué explica la variación?</h2><label class="field">Mes<select id="explanationMonth">${statsMonths.map((m,i)=>`<option value="${String(i+1).padStart(2,'0')}">${m}</option>`).join('')}</select></label></div>
  <p id="explanationPeriod" class="muted"></p><div id="explanationStatus" role="status"></div>
  <div id="explanationContent" hidden><p id="explanationHeadline"></p><div class="notice" id="explanationWarning"></div>
  <div id="explanationMetrics" class="metrics stats-metrics"></div>
  <h3>Descomposición de la diferencia</h3><div id="explanationEffects" class="stats-effects"></div>
  <p class="muted">Descomposición simétrica de cantidad y promedio de compras; devoluciones aparte. Un promedio mayor no implica por sí solo precios más altos.</p>
  <div class="filters stats-filters"><label class="field">Desglose<select id="explanationGroup"><option value="categories">Categorías</option><option value="merchants">Comercios / descripción</option></select></label><label class="field">Variación<select id="explanationDirection"><option value="all">Todas</option><option value="up">Aumentos</option><option value="down">Disminuciones</option></select></label></div>
  <h3>Mayores diferencias en pesos</h3><div class="stats-legend"><span class="stats-key trend">Aumento</span><span class="stats-key current">Disminución</span></div>
  <div class="explanation-canvas"><canvas id="explanationChart" role="img" aria-label="Diez mayores diferencias; detalle completo en la tabla siguiente"></canvas></div>
  <p id="explanationGroupTotal" class="muted"></p><div class="table-wrap"><table><thead><tr><th id="explanationGroupLabel">Categoría</th><th class="numeric">Actual</th><th class="numeric">Referencia</th><th class="numeric">Diferencia</th><th class="numeric">Compras actual / ref.</th><th class="numeric">Promedio actual / ref.</th><th class="numeric">Devoluciones actual / ref.</th></tr></thead><tbody id="explanationRows"></tbody></table></div>
  </div></section>`);
 const latest=statsSeries($('statsYear').value,'total').reduce((end,v,i)=>v===null?end:i,0);
 $('explanationMonth').value=explanationMonth||String(latest+1).padStart(2,'0');
 $('explanationMonth').onchange=()=>{explanationMonth=$('explanationMonth').value;loadExplanation();};
 $('explanationGroup').onchange=renderExplanationGroups;$('explanationDirection').onchange=renderExplanationGroups;
}
async function loadExplanation(){
 const seq=++explanationSequence;explanationData=null;
 const year=$('statsYear').value,ref=$('statsCompare').value,month=$('explanationMonth').value;
 $('explanationContent').hidden=true;$('explanationStatus').textContent='Consultando…';
 $('explanationPeriod').textContent=`${statsMonths[Number(month)-1]} ${year} / ${ref||'sin referencia'} · ${$('statsPerson').selectedOptions[0].text} · gastos confirmados`;
 if(!ref||ref===year){$('explanationStatus').textContent='Selecciona dos años distintos para comparar este mes.';return;}
 try{
  const q=new URLSearchParams({current:`${year}-${month}`,reference:`${ref}-${month}`,person:$('statsPerson').value});
  const data=await api('/api/statistics-explanation?'+q);if(seq!==explanationSequence)return;
  if(!data.comparable){$('explanationStatus').textContent='Sin comparación: alguno de los períodos no tiene gastos confirmados o tiene repartos incompletos.';return;}
  explanationData=data;$('explanationStatus').textContent='';$('explanationContent').hidden=false;
  const a=data.current,b=data.reference;
  const pct=data.percent===null?'sin porcentaje comparable':new Intl.NumberFormat('es-CL',{maximumFractionDigits:1,signDisplay:'exceptZero'}).format(data.percent)+' %';
  const leading=data.categories.find(r=>data.delta>0?r.delta>0:data.delta<0?r.delta<0:false);
  $('explanationHeadline').textContent=`El gasto registrado ${data.delta>0?'aumentó':data.delta<0?'disminuyó':'no varió'} ${money(Math.abs(data.delta))} (${pct}).`+(leading?` La mayor contribución en esa dirección es ${leading.name}: ${money(leading.delta)}.`:'');
  $('explanationWarning').textContent=`Los períodos pueden estar incompletos. Pendientes: ${year}: ${a.pending}; ${ref}: ${b.pending}. Las categorías inferidas y «Otros» también forman parte del histórico.`;
  $('explanationMetrics').innerHTML=[['Gasto neto',money(a.net),money(b.net)],['Cantidad de compras',a.count,b.count],['Promedio por compra',money(a.average),money(b.average)]].map(([label,value,base])=>`<div><span>${label} · ${year}</span><strong>${value}</strong><small>${ref}: ${base}</small></div>`).join('');
  $('explanationEffects').innerHTML=data.effects?Object.entries({count:'Cambio en cantidad',average:'Cambio en promedio',refunds:'Cambio en devoluciones'}).map(([key,label])=>`<div><span>${label}</span><strong>${money(data.effects[key])}</strong></div>`).join(''):'<p>Sin descomposición de cantidad y promedio: se necesitan compras en ambos períodos.</p>';
  renderExplanationGroups();
 }catch(e){if(seq===explanationSequence)$('explanationStatus').textContent=e.message;}
}
function renderExplanationGroups(){
 if(!explanationData||!$('explanationGroup'))return;
 const mode=$('explanationGroup').value,dir=$('explanationDirection').value;
 const all=explanationData[mode],rows=all.filter(r=>dir==='up'?r.delta>0:dir==='down'?r.delta<0:true);
 $('explanationGroupLabel').textContent=mode==='categories'?'Categoría':'Comercio / descripción';
 $('explanationRows').innerHTML=rows.map(r=>`<tr><td class="explanation-name">${esc(r.name)}</td><td class="numeric">${money(r.current.net)}</td><td class="numeric">${money(r.reference.net)}</td><td class="numeric">${money(r.delta)}</td><td class="numeric">${r.current.count} / ${r.reference.count}</td><td class="numeric">${money(r.current.average)} / ${money(r.reference.average)}</td><td class="numeric">${money(r.current.refunds)} / ${money(r.reference.refunds)}</td></tr>`).join('');
 $('explanationGroupTotal').textContent=`${rows.length} grupos · diferencia ${dir==='all'?'total':'del filtro'}: ${money(rows.reduce((s,r)=>s+r.delta,0))} · gráfico: hasta 10 mayores diferencias`;
 drawExplanation(rows.slice(0,10));
}
function drawExplanation(rows){
 const canvas=$('explanationChart');if(!canvas)return;
 const width=canvas.parentElement.clientWidth,height=360,ratio=devicePixelRatio||1;
 canvas.width=width*ratio;canvas.height=height*ratio;const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);
 if(!rows.length){ctx.fillStyle='#62716d';ctx.font='13px system-ui';ctx.fillText('Sin diferencias para este filtro',12,35);return;}
 const left=Math.min(170,width*.4),right=14,center=left+(width-left-right)/2,half=(width-left-right)/2;
 const max=Math.max(1,...rows.map(r=>Math.abs(r.delta)));
 ctx.strokeStyle='#cad5d0';ctx.beginPath();ctx.moveTo(center,10);ctx.lineTo(center,height-20);ctx.stroke();
 ctx.font='11px system-ui';ctx.textBaseline='middle';
 const axis=new Intl.NumberFormat('es-CL',{notation:'compact',maximumFractionDigits:1});
 ctx.fillStyle='#62716d';ctx.textAlign='left';ctx.fillText(axis.format(-max),left,height-7);
 ctx.textAlign='center';ctx.fillText('0',center,height-7);
 ctx.textAlign='right';ctx.fillText('+'+axis.format(max),width-right,height-7);
 rows.forEach((r,i)=>{const y=23+i*32;ctx.fillStyle='#425c50';ctx.textAlign='left';let label=r.name;while(ctx.measureText(label).width>left-12&&label.length>1)label=label.slice(0,-2)+'…';ctx.fillText(label,0,y);
  const size=Math.abs(r.delta)/max*(half-3);ctx.fillStyle=r.delta>0?'#d47716':'#246d5c';ctx.fillRect(r.delta<0?center-size:center,y-8,size,16);
 });
}
new ResizeObserver(()=>{if(!statsPanel.hidden){renderStatistics();renderExplanationGroups();}}).observe(statsPanel);
