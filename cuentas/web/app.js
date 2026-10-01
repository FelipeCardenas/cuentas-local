const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n===null||n===''?'—':new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:2}).format(Number(n));
const date=s=>s?new Date(s+'T12:00:00').toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'}):'—';
const month=s=>s?new Date(s+'-01T12:00:00').toLocaleDateString('es-CL',{month:'long',year:'numeric'}):'Sin período';
const stateNames={pendiente:'Pendiente',aceptado:'Confirmado',duplicado:'Duplicado',excluido_gasto:'Fuera del gasto'};
const kindNames={gasto:'Compra',devolucion:'Devolución',pago_tarjeta:'Pago CMR',ingreso:'Ingreso'};
for(let m=1;m<=12;m++){const value=String(m).padStart(2,'0');const name=new Date(2026,m-1,1).toLocaleDateString('es-CL',{month:'long'});$('reviewMonth').add(new Option(name[0].toUpperCase()+name.slice(1),value));}
function resetReviewDates(){for(const id of ['reviewMonth','reviewYear','dateFrom','dateTo'])$(id).value='';}
function validateReviewDates(){
 if($('dateFrom').value&&$('dateTo').value&&$('dateFrom').value>$('dateTo').value)throw Error('La fecha inicial no puede ser posterior a la final');
}
let config,view='review',state='pendiente',page=1,pages=1,detail=null,dirty=false,busy=false,selectedFile=null,previewData=null,loadSeq=0;
const icons=()=>lucide.createIcons();
function toast(text){$('toast').textContent=text;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,4200);}
function showError(id,error){$(id).textContent=error.message||error;$(id).hidden=false;}
async function api(path,options={}){const res=await fetch(path,{...options,headers:{'X-Cuentas-Token':config?.token||'',...options.headers}});const data=await res.json();if(!res.ok)throw Error(data.error||'No se pudo completar la solicitud');return data;}
function badge(r){return `<span class="badge ${r.state==='aceptado'?'accepted':r.state==='pendiente'?'':'neutral'}">${esc(stateNames[r.state])}</span>`;}
function batchLabel(b){
 const stamp=b.period?month(b.period).replace(' de ',' '):'Varios períodos';
 return `${b.kind==='historico'?'Histórico conciliado':b.name} · #${b.id} ${stamp[0].toUpperCase()+stamp.slice(1)}`;
}
async function configure(initial=false){config=await api('/api/config');const old=$('batch').value;$('batch').innerHTML='<option value="">Todos los lotes</option>'+config.batches.map(b=>`<option value="${b.id}">${esc(batchLabel(b))}</option>`).join('');$('batch').value=initial?String(config.batches[0]?.id||''):old;const y=$('reviewYear').value;$('reviewYear').innerHTML='<option value="">Todos</option>'+[...new Set(config.periods.map(p=>p.slice(0,4)))].map(y=>`<option value="${y}">${y}</option>`).join('');$('reviewYear').value=y;const category=$('reviewCategory').value;$('reviewCategory').innerHTML='<option value="">Todas</option>'+config.categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');$('reviewCategory').value=config.categories.includes(category)?category:'';renderBatches();}
function renderBatches(){$('batchCount').textContent=`${config.batches.length} importaciones`;$('batchList').innerHTML=config.batches.map(b=>`<div class="batch-row"><span class="batch-icon"><i data-lucide="${b.kind==='historico'?'database':'file-spreadsheet'}"></i></span><div class="batch-info"><strong>${esc(batchLabel(b))}</strong><small>${new Date(b.imported_at).toLocaleString('es-CL')} · ${b.kind==='historico'?'Excel + Google Sheets':esc(month(b.period))}</small></div><span class="batch-number">${b.count} movimientos</span><button class="secondary" data-batch="${b.id}">Revisar<i data-lucide="arrow-right"></i></button></div>`).join('');icons();}
async function load(){const seq=++loadSeq;$('pageError').hidden=true;const q=new URLSearchParams({...reviewFilters(),state,page});try{validateReviewDates();const data=await api('/api/movements?'+q);if(seq!==loadSeq)return;pages=data.pages;if(page>pages){page=pages;return load();}renderPending(data.pending);const s=data.summary;$('gross').textContent=money(s.bruto_clp);$('dedup').textContent=money(s.deduplicado_propuesto_clp);$('real').textContent=money(s.real_confirmado_clp);$('pending').textContent=s.pendientes.toLocaleString('es-CL');$('navCount').textContent=s.pendientes_globales;$('totalMi').textContent=money(s.mi_confirmado_clp);$('totalAmor').textContent=money(s.amor_confirmado_clp);$('rows').innerHTML=data.rows.map(r=>`<tr><td>${esc(date(r.purchase_date))}<small>${esc(month(r.period))}${r.installment?' · Cuota':''}</small></td><td class="description">${esc(r.description)}<small>${esc(kindNames[r.kind])} · #${r.id}${r.issue_count?' · '+r.issue_count+' avisos':''}</small></td><td><span class="category ${r.category?'':'missing'}">${esc(r.category||'Sin categoría')}</span></td><td class="numeric">${money(r.amount)}</td><td class="numeric muted">${money(r.mi)}</td><td class="numeric muted">${money(r.amor)}</td><td>${badge(r)}</td><td><button class="icon row-button" data-open="${r.id}" title="Revisar movimiento ${r.id}" aria-label="Revisar movimiento ${r.id}"><i data-lucide="chevron-right"></i></button></td></tr>`).join('');$('empty').hidden=!!data.rows.length;$('resultCount').textContent=`${data.count.toLocaleString('es-CL')} movimientos · filtros aplicados`;$('pageNumber').textContent=`${page} / ${pages}`;$('prev').disabled=page<=1;$('next').disabled=page>=pages;icons();}catch(e){if(seq===loadSeq)showError('pageError',e);}}
function setView(next){view=next;$('cutsPanel').hidden=view!=='cuts';if(view==='cuts')loadCuts(true);document.querySelector('.heading-actions').hidden=view==='categories'||view==='cuts';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('ledger').hidden=view==='imports'||view==='categories'||view==='cuts';$('categoryPanel').hidden=view!=='categories';if(view==='categories')loadCategories();$('imports').hidden=view!=='imports';$('title').textContent={review:'Revisión de gastos',imports:'Importaciones',history:'Histórico de movimientos',categories:'Maestro de categorías',cuts:'Cuentas con mi pareja'}[view];$('breadcrumb').textContent={review:'Revisión',imports:'Importaciones',history:'Histórico',categories:'Categorías',cuts:'Cuentas en pareja'}[view];if(view==='history'){$('batch').value='';setState('');}else if(view==='review')setState('pendiente');icons();}
function setState(s){state=s;page=1;document.querySelectorAll('[data-state]').forEach(b=>{b.classList.toggle('selected',b.dataset.state===s);b.setAttribute('aria-selected',String(b.dataset.state===s));});load();}
function renderPending(p){
 $('pendingStrip').hidden=state!=='pendiente';
 $('pendingMi').textContent=money(p.mi);$('pendingAmor').textContent=money(p.amor);
 $('pendingWarning').textContent=[p.incomplete?`${p.incomplete} repartos incompletos (totales parciales)`:null,p.unbalanced?`${p.unbalanced} repartos por cuadrar`:null].filter(Boolean).join(' · ');
 $('bulkOpen').disabled=p.selected===0;
}
let bulkPlan=null,bulkFilters=null;
$('showDuplicates').onchange=()=>{page=1;load();};
$('downloadFiltered').onclick=async()=>{
 const button=$('downloadFiltered');
 button.disabled=true;
 try{
  validateReviewDates();
  const query=new URLSearchParams({...reviewFilters(),state});
  const response=await fetch('/api/export-filtered?'+query);
  if(!response.ok){const data=await response.json();throw Error(data.error||'No se pudo descargar');}
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'movimientos_filtrados.xlsx';
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(e){showError('pageError',e);}finally{button.disabled=false;}
};
function reviewFilters(){return {show_duplicates:$('showDuplicates').checked?'1':'0',category:$('reviewCategory').value,batch:$('batch').value,month:$('reviewMonth').value,year:$('reviewYear').value,date_from:$('dateFrom').value,date_to:$('dateTo').value,kind:$('kind').value,q:$('search').value};}
$('bulkOpen').onclick=async()=>{
 if(busy)return;busy=true;$('bulkOpen').disabled=true;
 try{
  validateReviewDates();bulkFilters=reviewFilters();bulkPlan=await api('/api/bulk-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:bulkFilters})});
  const reasons={};bulkPlan.skipped.forEach(r=>r.reasons.forEach(s=>reasons[s]=(reasons[s]||0)+1));
  $('bulkInfo').innerHTML=`<p><strong>${bulkPlan.eligible.toLocaleString('es-CL')} movimientos</strong> se confirmarán en todas las páginas de los filtros actuales.</p><p>Las coincidencias se conservarán como compras independientes. Las categorías y repartos actuales no cambiarán.</p>${bulkPlan.skipped.length?`<div class="notice">${bulkPlan.skipped.length} seguirán pendientes.<ul>${Object.entries(reasons).map(([s,n])=>`<li>${esc(s)}: ${n}</li>`).join('')}</ul></div>`:''}<p>Después podrás editar categoría, Mi y Amor de los confirmados.</p>`;
  $('bulkCommit').disabled=bulkPlan.eligible===0;$('bulkCommit').textContent=`Confirmar ${bulkPlan.eligible.toLocaleString('es-CL')}`;
  $('bulkError').hidden=true;$('bulkDialog').showModal();
 }catch(e){showError('pageError',e);}finally{busy=false;$('bulkOpen').disabled=false;}
};
for(const id of ['bulkClose','bulkCancel'])$(id).onclick=()=>{if(!busy)$('bulkDialog').close();};
$('bulkDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('bulkCommit').onclick=async()=>{
 if(busy||!bulkPlan)return;busy=true;const buttons=[...$('bulkDialog').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
 try{
  const result=await api('/api/bulk-confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:bulkFilters,token:bulkPlan.token})});
  $('bulkDialog').close();toast(`${result.confirmed.toLocaleString('es-CL')} confirmados · ${result.skipped.length} pendientes por completar`);await configure();await load();
 }catch(e){showError('bulkError',e);}finally{busy=false;buttons.forEach(b=>b.disabled=false);}
};
const discardedTab=document.createElement('button');discardedTab.type='button';discardedTab.dataset.state='excluido_gasto';discardedTab.setAttribute('role','tab');discardedTab.textContent='Descartados';document.querySelector('.tabs').append(discardedTab);
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));document.querySelectorAll('[data-state]').forEach(b=>b.onclick=()=>setState(b.dataset.state));
for(const id of ['batch','reviewCategory','reviewMonth','reviewYear','dateFrom','dateTo','kind'])$(id).onchange=()=>{page=1;load();};let timer;$('search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;load();},250);};$('prev').onclick=()=>{page--;load();};$('next').onclick=()=>{page++;load();};$('rows').onclick=e=>{const b=e.target.closest('[data-open]');if(b)openDetail(b.dataset.open);};$('batchList').onclick=e=>{const b=e.target.closest('[data-batch]');if(b){$('batch').value=b.dataset.batch;resetReviewDates();$('reviewCategory').value='';$('kind').value='';$('search').value='';setView('review');}};
$('rows').addEventListener('click',e=>{if(!e.target.closest('[data-open]'))e.target.closest('tr')?.querySelector('[data-open]')?.click();});
function closeDetail(){if(busy)return;if(dirty&&!confirm('Hay cambios sin guardar. ¿Quieres descartarlos?'))return;dirty=false;$('drawer').close();}
$('closeDetail').onclick=closeDetail;$('drawer').addEventListener('cancel',e=>{e.preventDefault();closeDetail();});
function sourceHTML(o){let raw={};try{raw=JSON.parse(o.raw_json);}catch{}const labels={fecha:'Fecha',descripcion:'Descripción',monto:'Monto original',mi:'Mi',amor:'Amor',categoria:'Categoría','valor cuota':'Valor cuota','cuotas pendientes':'Cuotas pendientes','titular/adicional':'Tarjeta'};return `<details class="observation"><summary>${esc(o.source_key)} · fila ${o.row_number}</summary><div class="kv">${Object.entries(raw).filter(([k])=>labels[k]).map(([k,v])=>`<span>${labels[k]}</span><span>${esc(v??'—')}</span>`).join('')}</div></details>`;}
function issueHTML(i){if(i.code==='conflicto_historico'){try{const d=JSON.parse(i.detail);return `<details class="observation"><summary>Diferencias con Google Sheets</summary><div class="kv"><span>Categoría Excel</span><span>${esc(d.categoria_excel||'Sin categoría')}</span><span>Categoría Google</span><span>${esc(d.categoria_google||'Sin categoría')}</span><span>Mi · Excel / Google</span><span>${esc(d.mi_excel)} / ${esc(d.mi_google)}</span><span>Amor · Excel / Google</span><span>${esc(d.amor_excel)} / ${esc(d.amor_google)}</span></div></details>`;}catch{}}return `<div class="notice">${esc(i.detail)}</div>`;}
async function openDetail(id){if(busy)return;if(dirty&&!confirm('¿Descartar los cambios sin guardar?'))return;dirty=false;try{detail=await api('/api/detail/'+id);const r=detail.row;$('detailId').textContent=`MOVIMIENTO #${r.id}`;$('detailBody').innerHTML=`<h3 class="detail-description">${esc(r.description)}</h3><div class="detail-meta"><span>${esc(date(r.purchase_date))}</span><span>·</span><span>${esc(kindNames[r.kind])}</span><span>${esc(r.holder||'')}</span></div><div class="detail-amount">${money(r.amount)}</div>${badge(r)}${r.kind==='pago_tarjeta'?'<div class="notice">Pago de deuda · excluido del gasto.</div>':''}${r.state==='duplicado'?`<div class="notice">Vinculado al movimiento #${r.duplicate_of}</div>`:''}<form id="reviewForm"><label class="field">Categoría<select id="categoryInput"><option value="">Sin categoría</option>${config.categories.map(c=>`<option value="${esc(c)}" ${c===r.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label class="field">Período<input id="periodInput" type="month" value="${r.period}" required></label><div class="split-grid percentages"><label class="field">Mi · %<input id="miPercent" type="number" min="0" max="100" step="0.01" inputmode="decimal"></label><label class="field">Amor · %<input id="amorPercent" type="number" min="0" max="100" step="0.01" inputmode="decimal"></label></div><div class="split-grid"><label class="field">Mi · CLP<input id="miInput" type="number" step="0.000001" value="${esc(r.mi??'')}"></label><label class="field">Amor · CLP<input id="amorInput" type="number" step="0.000001" value="${esc(r.amor??'')}"></label></div><div class="split-toolbar"><span id="splitBalance"></span><button id="half" type="button" class="secondary"><i data-lucide="split"></i>50 / 50</button></div><label class="special-toggle"><input id="specialCase" type="checkbox" ${r.special_case?'checked':''}><span>Caso especial · permitir un reparto distinto del total</span></label><label class="field">Nota de revisión<input id="noteInput" placeholder="Opcional" maxlength="1000"></label><div id="detailError" class="error" role="alert" hidden></div><div class="detail-actions"><button id="save" type="submit" class="secondary" ${r.state==='duplicado'||r.kind==='pago_tarjeta'?'disabled':''}><i data-lucide="save"></i>Guardar</button><button id="accept" type="button" class="primary" ${r.kind==='pago_tarjeta'?'disabled':''}><i data-lucide="check"></i>${r.state==='duplicado'?'Restituir y confirmar':'Confirmar'}</button></div></form>${detail.candidates.length?`<section class="detail-section"><h3>Posibles coincidencias · ${detail.candidates.length}</h3><button id="keep" class="secondary"><i data-lucide="copy-check"></i>Es una compra independiente</button>${detail.candidates.map(c=>`<div class="candidate"><div>#${c.id} · Lote ${c.batch_id} · ${esc(date(c.purchase_date))}</div><p>${esc(c.description)} · <b>${money(c.amount)}</b></p><p>${esc(c.category||'Sin categoría')} · Mi ${money(c.mi)} / Amor ${money(c.amor)}</p><div class="candidate-actions">${badge(c)}<button type="button" class="secondary" data-candidate="${c.id}">Ver</button><button type="button" class="secondary" data-duplicate="${c.id}" ${c.state!=='aceptado'?'disabled title="Confirma primero el movimiento de destino"':''}>Vincular como duplicado</button></div></div>`).join('')}</section>`:''}${detail.issues.length?`<section class="detail-section"><h3>Avisos por revisar</h3>${detail.issues.map(issueHTML).join('')}</section>`:''}<section class="detail-section"><h3>Datos de origen</h3>${detail.observations.map(sourceHTML).join('')}</section>${detail.decisions.length?`<section class="detail-section"><h3>Revisiones guardadas</h3>${detail.decisions.map(d=>`<div class="observation"><b>${esc(d.action)}</b> · ${new Date(d.created_at).toLocaleString('es-CL')}<div>${esc(d.note)}</div></div>`).join('')}</section>`:''}`;
 const discarded=r.state==='excluido_gasto'&&r.kind!=='pago_tarjeta';
 if(r.kind!=='pago_tarjeta'&&r.state!=='duplicado'){
  const button=document.createElement('button');button.type='button';button.className='secondary';button.id='discard';
  button.innerHTML=discarded?'<i data-lucide="undo-2"></i>Volver a revisión':'<i data-lucide="archive-x"></i>No considerar';
  $('reviewForm').append(button);
  button.onclick=()=>{if(confirm(discarded?'¿Volver a dejar este movimiento pendiente de revisión?':'¿No considerar este movimiento? Quedará fuera de los cálculos y podrás recuperarlo en Descartados.'))submitReview(discarded?'restaurar':'descartar');};
 }
 if(discarded){$('save').disabled=true;$('accept').disabled=true;}
 $('reviewForm').oninput=()=>{dirty=true;$('detailError').hidden=true;balance();};$('half').onclick=()=>applyPercentage('mi',50);$('reviewForm').onsubmit=e=>{e.preventDefault();submitReview('editar');};$('accept').onclick=()=>submitReview('aceptar');if($('keep'))$('keep').onclick=()=>submitReview('conservar');$('detailBody').querySelectorAll('[data-candidate]').forEach(b=>b.onclick=()=>openDetail(b.dataset.candidate));$('detailBody').querySelectorAll('[data-duplicate]').forEach(b=>b.onclick=()=>{if(confirm(`¿Vincular este movimiento al #${b.dataset.duplicate}? Dejará de contar por separado.`))submitReview('duplicado',Number(b.dataset.duplicate));});setupSplit();balance();icons();if(!$('drawer').open)$('drawer').showModal();}catch(e){toast(e.message);}}
function syncPercentages(){
 const total=Number(detail.row.amount);
 for(const who of ['mi','amor']){
  const value=$(who+'Input').value;
  const percent=total!==0&&value!==''?Number(value)/total*100:NaN;
  $(who+'Percent').value=Number.isFinite(percent)&&percent>=0&&percent<=100?Number(percent.toFixed(2)):'';
 }
}
function applyPercentage(who,value){
 if(value===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100)return;
 const percent=Number(value),other=who==='mi'?'amor':'mi';
 const total=Math.round(Number(detail.row.amount)*1000000);
 const amount=Math.round(total*percent/100);
 $(who+'Percent').value=percent;$(other+'Percent').value=Number((100-percent).toFixed(2));
 $(who+'Input').value=amount/1000000;$(other+'Input').value=(total-amount)/1000000;
 dirty=true;balance();
}
function setupSplit(){
 syncPercentages();
 for(const who of ['mi','amor']){
  $(who+'Percent').oninput=()=>applyPercentage(who,$(who+'Percent').value);
  $(who+'Input').addEventListener('input',syncPercentages);
 }
 $('specialCase').onchange=()=>{dirty=true;balance();};
}
function balance(){
 if(!$('miInput'))return;
 const a=$('miInput').value,b=$('amorInput').value,diff=Number(detail.row.amount)-Number(a)-Number(b);
 const complete=a!==''&&b!=='';
 const special=$('specialCase').checked;
 $('splitBalance').textContent=!complete?'Reparto incompleto':special?`Caso especial · diferencia: ${money(diff)}`:Math.abs(diff)<.000001?'Reparto completo':`Por asignar: ${money(diff)}`;
 $('splitBalance').style.color=complete&&(special||Math.abs(diff)<.000001)?'#247954':'#a77826';
}
async function submitReview(action,duplicateOf){
 if(busy)return;
 if(dirty&&['descartar','restaurar'].includes(action))return showError('detailError','Guarda los cambios antes de descartar o restaurar.');
 $('detailError').hidden=true;
 if(dirty&&(action==='duplicado'||action==='conservar'))return showError('detailError','Guarda los cambios de categoría y reparto antes de resolver la coincidencia.');
 const data={id:detail.row.id,version:detail.row.version,action,note:$('noteInput').value};
 if(action==='editar'||action==='aceptar'){
  if(!$('reviewForm').reportValidity())return;
  data.special_case=$('specialCase').checked;data.category=$('categoryInput').value;data.mi=$('miInput').value;data.amor=$('amorInput').value;data.period=$('periodInput').value;
 }
 if(duplicateOf)data.duplicate_of=duplicateOf;
 busy=true;
 const controls=[...$('drawer').querySelectorAll('button,input')];
 const states=controls.map(b=>b.disabled);controls.forEach(b=>b.disabled=true);
 try{
  await api('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  dirty=false;busy=false;
  toast(action==='aceptar'?'Movimiento confirmado':action==='duplicado'?'Duplicado vinculado':'Revisión guardada');
  await configure();await load();
  if(['aceptar','duplicado','descartar','restaurar'].includes(action))$('drawer').close();else await openDetail(detail.row.id);
 }catch(e){showError('detailError',e);}
 finally{busy=false;controls.forEach((b,i)=>b.disabled=states[i]);}
}
function resetPreview(){previewData=null;$('preview').hidden=true;$('commitImport').hidden=true;$('previewButton').hidden=false;$('importError').hidden=true;}
function chooseFile(file){selectedFile=file||null;$('fileLabel').textContent=file?.name||'Seleccionar archivo Excel';resetPreview();}
$('openImport').onclick=()=>{if(busy)return;chooseFile(null);$('file').value='';const d=new Date();$('importMonth').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;$('importDialog').showModal();};
document.querySelectorAll('.closeImport').forEach(b=>b.onclick=()=>{if(!busy)$('importDialog').close();});$('importDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});$('file').onchange=()=>chooseFile($('file').files[0]);$('importMonth').onchange=resetPreview;
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('drag');});$('dropzone').addEventListener('dragleave',()=>$('dropzone').classList.remove('drag'));$('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('drag');if(busy)return;chooseFile(e.dataTransfer.files[0]);$('file').required=false;});
async function upload(mode){if(busy)return;$('importError').hidden=true;if(!selectedFile)return showError('importError','Selecciona un archivo Excel.');if(!selectedFile.name.toLowerCase().endsWith('.xlsx')||selectedFile.size>12*1024*1024)return showError('importError','Selecciona un archivo .xlsx de hasta 12 MB.');if(!$('importMonth').value)return showError('importError','Indica el mes correspondiente a las cuotas.');busy=true;const controls=[...$('importDialog').querySelectorAll('button,input')];controls.forEach(b=>b.disabled=true);try{const q=new URLSearchParams({name:selectedFile.name,period:$('importMonth').value});const data=await api('/api/'+mode+'?'+q,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:selectedFile});if(mode==='preview'){previewData=data;$('preview').hidden=false;$('preview').innerHTML=`${data.existing?`<div class="notice">Archivo ya importado · Lote #${data.existing}${data.existing_period?' · '+esc(month(data.existing_period)):''}</div>`:''}<div class="preview-stats"><div><span>Movimientos</span><strong>${data.count}</strong></div><div><span>Pagos CMR</span><strong>${data.payments}</strong></div><div><span>Cuotas</span><strong>${data.installments}</strong></div><div><span>Gasto bruto</span><strong>${money(data.gross)}</strong></div></div>${data.rows.map(r=>`<div class="preview-row"><span>${esc(r.description)}</span><b>${money(r.amount)}</b></div>`).join('')}`;$('previewButton').hidden=true;$('commitImport').hidden=false;$('commitImport').innerHTML=`<i data-lucide="${data.existing?'arrow-right':'upload'}"></i>${data.existing?'Abrir importación existente':'Confirmar importación'}`;icons();}else{await configure();$('batch').value=String(data.lote);resetReviewDates();$('reviewCategory').value='';$('search').value='';$('kind').value='';$('importDialog').close();setView('review');toast(data.reutilizado?'Archivo reconocido. No se agregaron movimientos.':`Importación completada · ${data.reconocidos||0} reconocidos · ${data.nuevos??data.movimientos} nuevos`);}}catch(e){showError('importError',e);}finally{busy=false;controls.forEach(b=>b.disabled=false);}}
$('importForm').onsubmit=e=>{e.preventDefault();upload('preview');};$('commitImport').onclick=()=>upload('import');
let categoryRows=[], categoryEdit=null;
$('ledger').parentElement.appendChild($('categoryPanel'));
async function loadCategories(){
 try{
  categoryRows=await api('/api/categories');
  $('categoryPanel').innerHTML='<div class="section-heading"><h2>'+categoryRows.length+' categorías</h2><button id="categoryAdd" class="primary"><i data-lucide="plus"></i>Agregar categoría</button></div><label class="field">Buscar categoría<input id="categorySearch" type="search"></label><div id="categoryList"></div>';
  $('categoryAdd').onclick=()=>editCategory('add');
  $('categorySearch').oninput=renderCategories;renderCategories();
 }catch(e){showError('pageError',e);}
}
function renderCategories(){
 $('categoryList').onclick=e=>{
  const button=e.target.closest('[data-category-view]');
  if(!button)return;
  const category=categoryRows.find(c=>c.id===Number(button.dataset.categoryView));
  if(!category)return;
  resetReviewDates();$('search').value='';$('kind').value='';
  if(![...$('reviewCategory').options].some(o=>o.value===category.name))$('reviewCategory').add(new Option(category.name,category.name));
  $('reviewCategory').value=category.name;setView('history');
 };
 const q=$('categorySearch').value.toLocaleLowerCase();
 $('categoryList').innerHTML=categoryRows.filter(c=>c.name.toLocaleLowerCase().includes(q)).map(c=>`<div class="category-row"><div><strong>${esc(c.name)}</strong><small>${c.count} movimientos</small></div><div class="category-tools"><button class="icon" data-category-view="${c.id}" title="Ver movimientos" aria-label="Ver movimientos de ${esc(c.name)}"><i data-lucide="list-filter"></i></button><button class="icon" data-cat="rename" data-id="${c.id}" title="Renombrar"><i data-lucide="pencil"></i></button><button class="icon" data-cat="merge" data-id="${c.id}" title="Fusionar y reasignar movimientos"><i data-lucide="merge"></i></button><button class="icon" data-cat="delete" data-id="${c.id}" title="Eliminar categoría"><i data-lucide="trash-2"></i></button></div></div>`).join('');
 $('categoryList').querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>editCategory(b.dataset.cat,categoryRows.find(c=>c.id===Number(b.dataset.id))));icons();
}
function editCategory(action,row){
 categoryEdit={action,id:row?.id,original:row?.name};
 $('categoryTitle').textContent={add:'Agregar categoría',rename:'Renombrar categoría',merge:'Fusionar categoría',delete:'Eliminar categoría'}[action];
 $('categoryFields').innerHTML=(row?`<p><b>${esc(row.name)}</b> · ${row.count} movimientos</p>`:'')+
 (action==='add'||action==='rename'?`<label class="field">Nombre<input id="categoryName" required maxlength="100" value="${esc(row?.name||'')}"></label>`:
 action==='merge'?`<label class="field">Categoría de destino<select id="categoryTarget" required><option value="">Seleccionar</option>${categoryRows.filter(c=>c.id!==row.id).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><p>Se reasignarán todos sus movimientos, incluidos los confirmados. No cambiarán los montos ni el reparto.</p>`:
 row.count?'<p>Esta categoría tiene movimientos. Debes fusionarla con otra antes de eliminarla.</p>':'<p>Se eliminará esta categoría y sus nombres alternativos.</p>');
 $('categoryCommit').disabled=action==='delete'&&row.count>0;
 $('categoryCommit').textContent={add:'Agregar',rename:'Guardar',merge:'Fusionar y reasignar',delete:'Eliminar'}[action];
 $('categoryError').hidden=true;icons();$('categoryDialog').showModal();
}
$('categoryClose').onclick=()=>{if(!busy)$('categoryDialog').close();};
$('categoryDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('categoryForm').onsubmit=async e=>{
 e.preventDefault();if(busy)return;busy=true;
 const controls=[...$('categoryForm').querySelectorAll('button,input,select')];controls.forEach(c=>c.disabled=true);
 try{
  await api('/api/categories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...categoryEdit,name:$('categoryName')?.value,target:Number($('categoryTarget')?.value)})});
  $('categoryDialog').close();await configure();await loadCategories();await load();toast('Maestro de categorías actualizado');
 }catch(e){showError('categoryError',e);}finally{busy=false;controls.forEach(c=>c.disabled=false);}
};
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
(async()=>{icons();try{await configure(true);await load();}catch(e){showError('pageError',e);}})();
