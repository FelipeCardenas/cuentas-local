let cutPlan=null,cutFilters=null,cutPage=1,cutBusy=false,cutExcluded=new Set(),cutHistory=[],cutAutomatic=false;
const cutPageSize=35;
$('ledger').parentElement.appendChild($('cutsPanel'));
function cutInputs(){return {start:$('cutStart').value,end:$('cutEnd').value,batch:$('cutBatch').value,include_older:$('cutOlder').checked,automatic:cutAutomatic};}
function cutInvalidate(){cutPlan=null;$('cutResult').hidden=true;}
function cutControls(disabled){cutBusy=disabled;$('cutsPanel').querySelectorAll('button,input,select').forEach(c=>c.disabled=disabled);}
async function loadCuts(reset=false){
 try{
  const data=await api('/api/cuts');cutHistory=data.history;
  if(reset||!$('cutStart').value){
   cutAutomatic=!!data.defaults.last_id;
   $('cutStart').value=data.defaults.start;$('cutEnd').value=data.defaults.end;$('cutOlder').checked=data.defaults.include_older;cutInvalidate();
   $('cutBatch').value='';
  }
  const batch=$('cutBatch').value;
  $('cutBatch').innerHTML='<option value="">Todos los lotes</option>'+config.batches.map(b=>`<option value="${b.id}">${esc(batchLabel(b))}</option>`).join('');
  $('cutBatch').value=batch;
  $('cutHistory').innerHTML=cutHistory.length?cutHistory.map(c=>`<div class="cut-history-row"><div><strong>Corte #${c.id}${c.cancelled_at?' · Anulado':''}</strong><small>${esc(date(c.start_date))} a ${esc(date(c.end_date))} · ${c.count} movimientos</small><small>Validado: ${new Date(c.created_at).toLocaleString('es-CL')}</small></div><div>Mi <b>${money(c.mi)}</b><br>Amor <b>${money(c.amor)}</b></div><button class="icon" data-cut-detail="${c.id}" title="Ver corte"><i data-lucide="eye"></i></button>${c.id===data.defaults.last_id?`<button class="icon" data-cut-cancel="${c.id}" title="Anular último corte"><i data-lucide="undo-2"></i></button>`:''}</div>`).join(''):'<p class="muted">Todavía no hay cortes validados.</p>';
  $('cutHistory').querySelectorAll('[data-cut-detail]').forEach(b=>b.onclick=()=>showCut(Number(b.dataset.cutDetail)));
  $('cutHistory').querySelectorAll('[data-cut-cancel]').forEach(b=>b.onclick=()=>cancelCut(Number(b.dataset.cutCancel)));
  icons();
  if((reset||cutAutomatic)&&!cutBusy)await queryCut();
 }catch(e){showError('cutError',e);}
}
async function queryCut(){
 if(cutBusy)return;cutControls(true);$('cutError').hidden=true;cutInvalidate();
 try{
  cutFilters=cutInputs();cutExcluded=new Set();cutPage=1;
  cutPlan=await api('/api/cut-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cutFilters)});
  $('cutResult').hidden=false;renderCut();
 }catch(e){showError('cutError',e);}finally{cutControls(false);if(cutPlan)renderCut();}
}
function cutTotals(){
 const rows=cutPlan.rows.filter(r=>!cutExcluded.has(r.id));
 const sum=k=>rows.reduce((v,r)=>v+BigInt(Math.round(Number(r[k])*1000000)),0n);
 return {count:rows.length,mi:Number(sum('mi'))/1000000,amor:Number(sum('amor'))/1000000};
}
function renderCut(){
 if(!cutPlan)return;
 const totals=cutTotals(),pages=Math.max(1,Math.ceil(cutPlan.rows.length/cutPageSize));
 $('cutMi').textContent=money(totals.mi);$('cutAmor').textContent=money(totals.amor);
 $('cutCount').textContent=`${totals.count} seleccionados de ${cutPlan.rows.length} · solo gastos y devoluciones confirmados`;
 const warnings=[];
 if(cutPlan.pending)warnings.push(`${cutPlan.pending} movimientos pendientes no se incluyen en los totales.`);
 if(cutPlan.older_count)warnings.push(`${cutPlan.older_count} movimientos anteriores sin corte ${cutFilters.include_older?'incluidos':'fuera de la consulta'}.`);
 if(cutPlan.adjustments)warnings.push(`${cutPlan.adjustments} ajustes por cambios posteriores a cortes validados; solo se considera la diferencia.`);
 $('cutWarnings').textContent=warnings.join(' ');$('cutWarnings').hidden=!warnings.length;
 $('cutSaveOpen').disabled=!totals.count||cutBusy;
 $('cutSelectAll').checked=totals.count===cutPlan.rows.length&&!!totals.count;
 $('cutSelectAll').indeterminate=totals.count>0&&totals.count<cutPlan.rows.length;
 $('cutRows').innerHTML=cutPlan.rows.slice((cutPage-1)*cutPageSize,cutPage*cutPageSize).map(r=>`<tr><td><input type="checkbox" data-cut-select="${r.id}" ${cutExcluded.has(r.id)?'':'checked'} aria-label="Incluir movimiento ${r.id}"></td><td>${esc(r.installment?month(r.period):date(r.date))}<small>${r.installment?'Cuota · mes asignado':''}</small></td><td class="description">${esc(r.description)}<small>#${r.id} · Lote #${r.batch_id}${r.adjustment?' · Ajuste de corte anterior':''}</small></td><td class="cut-category"><span class="category ${r.category?'':'missing'}">${esc(r.category||'Sin categoría')}</span></td><td class="numeric">${money(r.mi)}</td><td class="numeric">${money(r.amor)}</td><td><button class="icon" data-cut-review="${r.id}" title="Revisar movimiento"><i data-lucide="pencil"></i></button></td></tr>`).join('');
 $('cutRows').querySelectorAll('[data-cut-select]').forEach(c=>c.onchange=()=>{const id=Number(c.dataset.cutSelect);c.checked?cutExcluded.delete(id):cutExcluded.add(id);renderCut();});
 $('cutRows').querySelectorAll('[data-cut-review]').forEach(b=>b.onclick=()=>openDetail(b.dataset.cutReview));
 $('cutPageInfo').textContent=`Página ${cutPage} de ${pages}`;
 $('cutPrev').disabled=cutPage===1;$('cutNext').disabled=cutPage===pages;icons();
}
$('cutForm').onsubmit=e=>{e.preventDefault();queryCut();};
for(const id of ['cutStart','cutEnd','cutBatch','cutOlder'])$(id).onchange=()=>{cutAutomatic=false;cutInvalidate();};
$('cutSelectAll').onchange=()=>{cutExcluded=$('cutSelectAll').checked?new Set():new Set(cutPlan.rows.map(r=>r.id));renderCut();};
$('cutPrev').onclick=()=>{cutPage--;renderCut();};
$('cutNext').onclick=()=>{cutPage++;renderCut();};
$('cutRefresh').onclick=()=>loadCuts(true);
$('cutSaveOpen').onclick=async()=>{
 if(cutBusy||!cutPlan)return;cutControls(true);$('cutError').hidden=true;
 try{
  const data={...cutFilters,excluded:[...cutExcluded]};
  const fresh=await api('/api/cut-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  // Recompute using the exact selection, then show authoritative totals for validation.
  cutPlan=fresh;renderCut();
  $('cutConfirmText').innerHTML=`<p>${esc(date(fresh.start))} a ${esc(date(fresh.end))} · ${fresh.count} movimientos</p><p>Mi: <b>${money(fresh.mi)}</b><br>Amor: <b>${money(fresh.amor)}</b></p><p>Los movimientos seleccionados quedarán considerados en este corte. No se registra ningún depósito.</p>`;
  $('cutConfirmError').hidden=true;$('cutNote').value='';$('cutSave').disabled=!fresh.count;$('cutConfirm').showModal();
 }catch(e){showError('cutError',e);}finally{cutControls(false);renderCut();}
};
$('cutSave').onclick=async()=>{
 if(cutBusy||!cutPlan)return;cutBusy=true;$('cutSave').disabled=true;
 try{
  const result=await api('/api/cut-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...cutFilters,excluded:[...cutExcluded],token:cutPlan.token,note:$('cutNote').value})});
  $('cutConfirm').close();cutInvalidate();await loadCuts(true);toast(`Corte #${result.id} validado y guardado`);
 }catch(e){showError('cutConfirmError',e);}finally{cutBusy=false;$('cutSave').disabled=false;}
};
$('cutConfirmClose').onclick=()=>{if(!cutBusy)$('cutConfirm').close();};
$('cutConfirm').addEventListener('cancel',e=>{if(cutBusy)e.preventDefault();});
async function showCut(id){
 try{
  const data=await api('/api/cuts/'+id);
  $('cutDetailTitle').textContent=`Corte #${id}${data.cut.cancelled_at?' · Anulado':''}`;
 $('cutDetailBody').innerHTML=`<p>${esc(date(data.cut.start_date))} a ${esc(date(data.cut.end_date))}</p><p>Mi: <b>${money(data.mi)}</b> · Amor: <b>${money(data.amor)}</b></p><p>${esc(data.cut.note)}</p><div class="cut-snapshots">${data.rows.map(r=>`<div class="category-row"><div>#${r.id} · ${esc(r.description)}<small>${esc(r.installment?month(r.period):date(r.date))}${r.adjustment?' · Ajuste':''}</small><small class="category">Categoría al validar: ${esc(r.category||'Sin categoría')}</small></div><div>Mi ${money(r.mi)}<br>Amor ${money(r.amor)}</div></div>`).join('')}</div>`;
  $('cutDetail').showModal();
 }catch(e){showError('cutError',e);}
}
$('cutDetailClose').onclick=()=>$('cutDetail').close();
async function cancelCut(id){
 if(cutBusy||!confirm(`¿Anular el corte #${id}? Sus movimientos volverán a quedar disponibles para consultar.`))return;
 cutControls(true);
 try{await api('/api/cut-cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});await loadCuts(true);toast('Corte anulado');}
 catch(e){showError('cutError',e);}finally{cutControls(false);}
}
$('drawer').addEventListener('close',()=>{if(view==='cuts')cutInvalidate();});
window.addEventListener('beforeunload',e=>{if(cutBusy){e.preventDefault();e.returnValue='';}});
