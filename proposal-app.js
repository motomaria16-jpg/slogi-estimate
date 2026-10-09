(function(){
  'use strict';
  if(window.__slogiFastNavigationHost)return;
  const S=window.SlogiPhase0,W=window.SlogiWorkflow,P=window.SlogiPro,cardModel=window.SlogiSearchSpaceCard,cardModal=window.SlogiSearchSpaceCardModal,listCard=window.SlogiPremisesListCard,stage=window.SlogiProposalStage,documentBuilder=window.SlogiProposalDocument,inWorkCard=window.SlogiInWorkPage;
  if(!S||!W||!cardModel||!cardModal||!listCard||!stage||!documentBuilder||!inWorkCard)return;
  const repo=S.projectRepository,$=id=>document.getElementById(id),all=(selector,root=document)=>Array.from(root.querySelectorAll(selector)),esc=S.esc;
  const state={projects:[],visible:[],filter:'',query:'',selectedId:''};
  const PROPOSAL_TEMPLATE_FILE='KP_Slogi_template.docx?v=76166',LEASE_FILE='lease-agreement-template.docx',LEASE_NAME='Типовой договор аренды нежилого помещения.docx';
  const now=()=>new Date().toISOString(),safe=value=>W.safeName(value||'КП');
  function workOf(project){return project&&project.phase0&&project.phase0.spaceCard&&project.phase0.spaceCard.work||{};}
  function proposalOf(project){return stage.proposalOf(project);}
  function canonicalCard(project){
    const phase=project.phase0||{},stored=phase.spaceCard||{};
    return cardModel.normalize(Object.assign({},stored,{id:project.id,source:phase.source==='cian'?'cian':'manual',listingUrl:phase.listingUrl||stored.listingUrl||'',address:project.address||stored.address||'',geo:stored.geo||project.geo||null,cluster:Object.assign({},stored.cluster||{},{id:stored.cluster&&stored.cluster.id||project.clusterId||'',name:stored.cluster&&stored.cluster.name||project.clusterName||''}),rentMonthly:phase.rent&&phase.rent.amount,area:project.area,ceilingHeight:project.ceilingHeight,work:stored.work||{}}));
  }
  function statusLabel(proposal){return proposal.status==='sent'?'КП отправлено':proposal.status==='prepared'?'КП подготовлено':'Подготовка КП';}
  function formatDate(value,withTime=false){if(!value)return'—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString('ru-RU',withTime?{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}:{day:'2-digit',month:'long',year:'numeric'});}
  function toast(message,type=''){const node=$('proposal-toast');node.textContent=String(message||'');node.className=`proposal-toast show${type?` ${type}`:''}`;clearTimeout(node._timer);node._timer=setTimeout(()=>node.className='proposal-toast',4200);}
  function reload(){
    state.projects=repo.listAll().filter(stage.isProposalProject).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    const query=S.norm(state.query),filter=state.filter;
    state.visible=state.projects.filter(project=>{const proposal=proposalOf(project),contact=workOf(project).landlordContact||{},haystack=S.norm([project.address,project.clusterName,contact.name,contact.phone,contact.email].join(' '));return(!query||haystack.includes(query))&&(!filter||proposal.status===filter);});
    renderList();
  }
  function cardHtml(project){
    const phase=project.phase0||{},card=canonicalCard(project),proposal=proposalOf(project),contact=workOf(project).landlordContact||{},prepared=proposal.status!=='draft';
    const context=[contact.name||contact.email||'Контакт арендодателя не указан',prepared?`КП: ${proposal.docxName||'подготовлено'}`:'Заполните коммерческие условия'];
    if(proposal.followUpDueAt)context.push(`Связаться ${formatDate(proposal.followUpDueAt,true)}`);
    return listCard.render({articleClass:'proposal-list-card',articleAttributes:{tabindex:'0','data-project-id':project.id},openAttributes:{'data-action':'open-proposal'},title:phase.listingTitle||project.address||'Коммерческое помещение',address:project.address,badges:[{text:card.source==='manual'?'Вручную':'ЦИАН'},{text:card.cluster&&card.cluster.name||project.clusterName||'Кластер не указан'},{text:statusLabel(proposal),tone:proposal.status==='sent'?'ready':proposal.status==='prepared'?'warning':'status'}],area:project.area,floor:project.floor??phase.floor,totalFloors:phase.totalFloors,ceilingHeight:project.ceilingHeight,rentMonthly:phase.rent&&phase.rent.amount,pricePerSqm:card.pricePerSqm,contextHtml:context.map(value=>`<span>${esc(value)}</span>`).join('<span aria-hidden="true"> · </span>'),actionsLabel:'Действия с коммерческим предложением',actionsHtml:`<button class="proposal-btn primary" type="button" data-action="open-proposal">${proposal.status==='draft'?'Подготовить КП':'Открыть КП'}</button>`});
  }
  function renderList(){$('proposal-list').innerHTML=state.visible.map(cardHtml).join('');$('proposal-empty').hidden=Boolean(state.visible.length);$('proposal-count').textContent=`${state.projects.length} ${state.projects.length===1?'объект':state.projects.length>1&&state.projects.length<5?'объекта':'объектов'}`;$('proposal-summary').textContent=`Показано ${state.visible.length} из ${state.projects.length}`;}
  function value(formData,name){return formData&&formData.get?String(formData.get(name)||'').trim():'';}
  function formTerms(formData){return{rentFreeDays:value(formData,'rentFreeDays'),baseRentRate:value(formData,'baseRentRate'),discountRentRate:value(formData,'discountRentRate'),discountPeriodDays:value(formData,'discountPeriodDays'),emailSubject:value(formData,'emailSubject'),emailBody:value(formData,'emailBody')};}
  function emailHref(contact,subject,body){const email=String(contact.email||'').trim();return`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;}
  function workflowHtml(project){
    const proposal=proposalOf(project),contact=workOf(project).landlordContact||{},draft=stage.emailDraft(project,contact),subject=proposal.emailSubject||draft.subject,body=proposal.emailBody||draft.body,prepared=proposal.status==='prepared'||proposal.status==='sent',documentReady=prepared&&Boolean(proposal.docxName),sent=proposal.status==='sent';
    return`<div class="proposal-workflow-grid">
      <section class="proposal-panel" data-workflow-panel="terms"><div class="proposal-panel-head"><h3>Коммерческие условия</h3><span class="proposal-status ${documentReady?'ready':''}">${documentReady?'DOCX подготовлен':prepared?'Обновите КП':'Заполните 4 параметра'}</span></div><div class="proposal-terms-grid">
        <label><span>Арендные каникулы, дней</span><input name="rentFreeDays" type="number" min="0" step="1" inputmode="numeric" value="${esc(proposal.rentFreeDays??'')}" required></label>
        <label><span>Базовая арендная ставка, ₽/м²/мес.</span><input name="baseRentRate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(proposal.baseRentRate??'')}" required></label>
        <label><span>Ставка на льготный период, ₽/м²/мес.</span><input name="discountRentRate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(proposal.discountRentRate??'')}" required></label>
        <label><span>Срок льготного периода, дней</span><input name="discountPeriodDays" type="number" min="0" step="1" inputmode="numeric" value="${esc(proposal.discountPeriodDays??'')}" required></label>
      </div><div class="proposal-actions"><button class="proposal-btn primary" type="button" data-action="prepare-proposal">${prepared?'Обновить КП':'Подготовить КП'}</button></div></section>
      <section class="proposal-panel" data-workflow-panel="package"><div class="proposal-panel-head"><h3>Пакет для арендодателя</h3><span class="proposal-status ${documentReady?'ready':''}">${documentReady?'Готов к отправке':'Сначала подготовьте КП в Word'}</span></div>
        <div class="proposal-attachments"><button class="proposal-file" type="button" data-action="download-docx" ${documentReady?'':'disabled'}><span>DOCX</span><strong>${esc(proposal.docxName||'Коммерческое предложение.docx')}</strong></button><button class="proposal-file" type="button" data-action="download-lease"><span>DOCX</span><strong>${esc(LEASE_NAME)}</strong></button></div>
        <label class="proposal-email-field"><span>Тема письма</span><input name="emailSubject" value="${esc(subject)}" ${documentReady?'':'disabled'}></label><label class="proposal-email-field"><span>Текст письма</span><textarea name="emailBody" rows="8" ${documentReady?'':'disabled'}>${esc(body)}</textarea></label>
        <div class="proposal-actions spread"><div><button class="proposal-btn" type="button" data-action="copy-email" ${documentReady?'':'disabled'}>Копировать письмо</button><a class="proposal-btn" href="${esc(emailHref(contact,subject,body))}" data-email-link ${documentReady?'':'aria-disabled="true" tabindex="-1"'}>Открыть письмо</a></div><button class="proposal-btn accent" type="button" data-action="mark-sent" ${documentReady&&!sent?'':'disabled'}>${sent?'КП отправлено':'КП отправлено'}</button></div>
        ${sent?`<p class="proposal-success">Отправка зафиксирована ${esc(formatDate(proposal.sentAt,true))}. Задача связаться с арендодателем добавлена на ${esc(formatDate(proposal.followUpDueAt,true))}.</p>`:''}
      </section></div>`;
  }
  function historyHtml(project){
    const proposal=proposalOf(project),work=workOf(project),items=[];
    if(work.pipeline&&work.pipeline.proposalStartedAt)items.push(['Помещение передано на этап КП',work.pipeline.proposalStartedAt]);
    if(proposal.preparedAt)items.push(['Коммерческое предложение подготовлено',proposal.preparedAt]);
    if(proposal.sentAt)items.push(['Отправка КП зафиксирована',proposal.sentAt]);
    if(proposal.followUpDueAt)items.push(['Контрольная связь запланирована',proposal.followUpDueAt]);
    return`<section class="proposal-panel proposal-history"><h3>История КП</h3>${items.length?`<ol>${items.map(item=>`<li><strong>${esc(item[0])}</strong><span>${esc(formatDate(item[1],true))}</span></li>`).join('')}</ol>`:'<p>Действий пока нет.</p>'}</section>`;
  }
  function cardSaveDraft(project,card){const phase=project.phase0||{},geo=card.geo||{},cluster=card.cluster||{};return{spaceCard:Object.assign({},card,{id:project.id,work:Object.assign({},card.work||{},canonicalCard(project).work||{})}),listingUrl:card.listingUrl||phase.listingUrl||'',canonicalUrl:card.listingUrl||phase.canonicalUrl||phase.listingUrl||'',externalId:phase.externalId||'',listingTitle:phase.listingTitle||'',address:card.address,latitude:geo.lat,longitude:geo.lng,clusterId:cluster.id||'',clusterName:cluster.name||'',area:card.area,rentMonthly:card.rentMonthly,rentPeriod:phase.rent&&phase.rent.period||'month',rentCurrency:phase.rent&&phase.rent.currency||'RUB',floor:project.floor??phase.floor,totalFloors:phase.totalFloors,ceilingHeight:card.ceilingHeight,publishedAt:phase.listingPublishedAt,sourceUpdatedAt:phase.listingUpdatedAt,parserWarnings:phase.parserWarnings,status:phase.status,rejectionReason:phase.rejection&&phase.rejection.reason,selectionCriteria:phase.selectionCriteria,interestConfirmed:phase.interest&&phase.interest.confirmed,measurementStatus:phase.measurement&&phase.measurement.status,measurementDate:phase.measurement&&phase.measurement.date,measurementComment:phase.measurement&&phase.measurement.comment,windowsCount:phase.windowsCount,roomsCount:phase.roomsCount,comments:phase.comments};}
  async function saveCanonicalCard(project,card){const current=repo.get(project.id);if(!current)throw new Error('Помещение не найдено.');const saved=await S.phase0Service.save(cardSaveDraft(current,card),{projectId:current.id,expectedRevision:current.phase0&&current.phase0.revision});reload();return saved;}
  async function prepareProposal(projectId,formData){
    const project=repo.get(projectId),input=formTerms(formData),checked=stage.validateTerms(input);if(!checked.valid)throw new Error(checked.errors[0]);
    const draft=stage.emailDraft(project,workOf(project).landlordContact||{}),subject=input.emailSubject||draft.subject,body=input.emailBody||draft.body,fields=documentBuilder.buildFields(project,checked.terms),response=await fetch(PROPOSAL_TEMPLATE_FILE);
    if(!response.ok)throw new Error('Исходный Word-шаблон КП не найден.');
    const blob=await documentBuilder.docxBlob(await response.arrayBuffer(),fields,window.OfficeZip),docxName=`${safe('КП '+(project.address||project.id))}.docx`;
    await W.saveAttachment(projectId,'proposal-docx',blob,docxName);
    const current=repo.get(projectId),prepared=repo.mutate(projectId,item=>stage.prepare(item,Object.assign({},checked.terms,{emailSubject:subject,emailBody:body,docxName,docxAttachmentType:'proposal-docx',leaseName:LEASE_NAME}),{now:now()}),current.phase0&&current.phase0.revision,'proposal-prepare');
    if(P)P.upsert('documentVersions',{id:`proposal-${projectId}`,projectId,type:'КП',name:docxName,version:'v1',status:'Актуальный',comment:'DOCX сформирован из исходного корпоративного шаблона'},'proposal-docx-prepared');
    reload();toast('КП подготовлено в Word. Документ и типовой договор готовы к отправке.');return prepared;
  }
  async function downloadStored(projectId,type,fallbackName){const file=await W.getAttachment(projectId,type);if(!file||!file.blob)throw new Error('Файл не найден. Подготовьте КП повторно.');W.download(file.blob,file.name||fallbackName);}
  async function downloadLease(){const response=await fetch(LEASE_FILE);if(!response.ok)throw new Error('Типовой договор не найден.');W.download(await response.blob(),LEASE_NAME);}
  async function markSent(projectId,formData){
    const current=repo.get(projectId),proposal=proposalOf(current),input=formTerms(formData),taskId=proposal.followUpTaskId||`kp-follow-up-${projectId}`,sentAt=now(),followUpDueAt=new Date(new Date(sentAt).getTime()+24*60*60*1000).toISOString();
    const updated=repo.mutate(projectId,item=>{const refreshed=stage.prepare(item,Object.assign({},proposal,{emailSubject:input.emailSubject||proposal.emailSubject,emailBody:input.emailBody||proposal.emailBody,docxName:proposal.docxName,docxAttachmentType:proposal.docxAttachmentType,leaseName:proposal.leaseName}),{now:proposal.preparedAt||sentAt});return stage.markSent(refreshed,{followUpTaskId:taskId,followUpDueAt},{now:sentAt});},current.phase0&&current.phase0.revision,'proposal-sent');
    if(P){P.upsert('tasks',stage.followUpTask(updated,proposalOf(updated),taskId),'proposal-follow-up-task');P.activity(projectId,'proposal','КП отправлено арендодателю',{followUpDueAt});}
    reload();toast('КП отмечено отправленным. Контрольная связь добавлена в календарь через 24 часа.');return updated;
  }
  async function performWorkflowAction(projectId,action,context){
    const formData=context.formData,project=repo.get(projectId);if(!project)throw new Error('Помещение не найдено.');
    if(action==='prepare-proposal')return{card:canonicalCard(await prepareProposal(projectId,formData))};
    if(action==='download-docx'){await downloadStored(projectId,'proposal-docx',proposalOf(project).docxName);return null;}
    if(action==='download-lease'){await downloadLease();return null;}
    if(action==='copy-email'){const input=formTerms(formData),content=`${input.emailSubject}\n\n${input.emailBody}`;await navigator.clipboard.writeText(content);toast('Текст письма скопирован.');return null;}
    if(action==='mark-sent')return{card:canonicalCard(await markSent(projectId,formData))};
    return null;
  }
  function openProposal(project,opener){
    if(!project)return;const projectId=String(project.id);state.selectedId=projectId;
    cardModal.open({initial:canonicalCard(project),opener,context:'proposal',initialTab:'proposal',renderWorkflow:()=>{const current=repo.get(projectId);if(!current)return{status:'',html:'',sidebarHtml:''};const view=inWorkCard.renderCardWorkflow(current);return Object.assign({},view,{footerAction:null});},onWorkflowAction:(action,context)=>inWorkCard.performCardWorkflowAction(projectId,action,Object.assign({},context,{preserveProposalStage:true})),onWorkflowFile:(name,file)=>inWorkCard.uploadCardWorkflowFile(projectId,name,file),renderProposal:()=>{const current=repo.get(projectId),proposal=current?proposalOf(current):{status:'draft'};return{status:statusLabel(proposal),html:current?workflowHtml(current):'',historyHtml:current?historyHtml(current):'',sidebarHtml:''};},onProposalAction:(action,context)=>performWorkflowAction(projectId,action,context),onResolveAddress:async draft=>{const result=await S.phase0Service.resolveSpaceAddress(draft.address,projectId);return{address:result.address,geo:result.geo?{lat:result.geo.lat,lng:result.geo.lng,resolutionSource:'automatic'}:null,cluster:result.cluster,competitive:result.competitive};},onSave:async draft=>({card:canonicalCard(await saveCanonicalCard(repo.get(projectId),draft))})});
  }
  function bind(){
    $('proposal-search').addEventListener('input',event=>{state.query=event.target.value;reload();});
    $('proposal-filters').addEventListener('click',event=>{const button=event.target.closest('[data-status]');if(!button)return;state.filter=button.dataset.status;all('[data-status]',$('proposal-filters')).forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});reload();});
    $('proposal-list').addEventListener('click',event=>{const action=event.target.closest('[data-action="open-proposal"]'),card=event.target.closest('[data-project-id]');if(action&&card)openProposal(repo.get(card.dataset.projectId),action);});
    $('proposal-list').addEventListener('keydown',event=>{const card=event.target.closest('[data-project-id]');if(card&&event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();openProposal(repo.get(card.dataset.projectId),card);}});
    window.addEventListener('slogi:locations-updated',reload);
  }
  function init(){bind();reload();const requested=new URLSearchParams(location.search).get('location');if(requested&&repo.get(requested))openProposal(repo.get(requested));}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
