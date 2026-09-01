(function(){
'use strict';
if(window.__slogiFigmaShell76115)return;
window.__slogiFigmaShell76115=true;

const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
const query=new URLSearchParams(location.search);
const route=page==='available-spaces.html'?'search':page==='index.html'?'premises':page==='workspace.html'?(query.get('section')==='repair'?'repair':'estimate'):['source-specification.html','specification.html','proposal.html'].includes(page)?'estimate':page==='passport.html'?'premises':page==='team.html'?'team':page==='settings.html'?'settings':'premises';
const esc=value=>String(value==null?'':value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const icon=name=>({
  home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  building:'<path d="M4 20V5h10v15M14 10h6v10M7 8h4M7 12h4M7 16h4M17 13h1M17 16h1"/>',
  estimate:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  repair:'<path d="m14 6 4 4M3 21l5-1 10-10-4-4L4 16z"/>',
  team:'<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20c.4-4 2.4-6 6-6s5.6 2 6 6M14 15c3.6-.2 5.8 1.5 6.3 5"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.8-1.8.9-1.9-2.2-2.1-1.8.9-1.9-.8L10.5 2h-3l-.7 2.1-1.9.8L3 4 1 6.1 2 8l-.8 1.8-2 .7v3l2 .7.8 1.8-1 1.9L3 20l1.9-.9 1.9.8.7 2.1h3l.7-2.1 1.9-.8 1.8.9 2.2-2.1-.9-1.9.8-1.8z"/>',
  bell:'<path d="M6 9a6 6 0 0 1 12 0c0 6 2 6 2 8H4c0-2 2-2 2-8Z"/><path d="M9.5 20h5"/>',
  menu:'<path d="M5 7h14M5 12h14M5 17h14"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>'
}[name]||'');
const svg=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon(name)}</svg>`;
const groups=[
  [
    {id:'home',href:'index.html',label:'Главная',icon:'home'},
    {id:'search',href:'available-spaces.html',label:'Поиск помещений',icon:'search'},
    {id:'premises',href:'index.html',label:'Мои помещения',icon:'building'}
  ],
  [
    {id:'estimate',href:'workspace.html?section=estimate',label:'Смета и КП',icon:'estimate'},
    {id:'repair',href:'workspace.html?section=repair',label:'Ремонт',icon:'repair'}
  ],
  [
    {id:'team',href:'team.html',label:'Команда',icon:'team'},
    {id:'settings',href:'settings.html',label:'Настройки',icon:'settings'}
  ]
];
const navHtml=groups.map(group=>`<div class="figma-shell-nav-group">${group.map(item=>`<a class="figma-shell-nav-link ${route===item.id?'active':''}" href="${item.href}" ${route===item.id?'aria-current="page"':''}>${svg(item.icon)}<span>${esc(item.label)}</span></a>`).join('')}</div>`).join('');
const helpHtml=`<div class="figma-shell-help"><img src="documents-owl-approved-v2.png" alt="Фирменная сова СЛОГИ"><div><strong>Нужна<br>помощь?</strong><span>Мы на связи!</span><a href="team.html" aria-label="Перейти к контактам команды">Связаться</a></div></div>`;
const sidebar=document.createElement('aside');
sidebar.className='figma-shell-sidebar';
sidebar.setAttribute('aria-label','Основная навигация');
sidebar.innerHTML=`<a class="figma-shell-brand" href="index.html" aria-label="СЛОГИ — главная"><img src="proposal-logo.png" alt="СЛОГИ — школа развития речи"></a><nav>${navHtml}</nav><div class="figma-shell-spacer"></div>${helpHtml}`;

const mobileBar=document.createElement('div');
mobileBar.className='figma-shell-mobilebar';
mobileBar.innerHTML=`<button class="figma-shell-menu-button" type="button" aria-label="Открыть меню" aria-expanded="false">${svg('menu')}</button><span class="figma-shell-mobile-title">${esc(document.title.replace(/^СЛОГИ\s*—\s*/,''))}</span><button class="figma-shell-bell-button" type="button" aria-label="Уведомления">${svg('bell')}</button>`;
const overlay=document.createElement('div');
overlay.className='figma-shell-overlay';
overlay.hidden=true;
overlay.innerHTML=`<aside class="figma-shell-drawer" aria-label="Мобильная навигация"><div class="figma-shell-drawer-head"><a class="figma-shell-brand" href="index.html"><img src="proposal-logo.png" alt="СЛОГИ — школа развития речи"></a><button class="figma-shell-close-button" type="button" aria-label="Закрыть меню">${svg('close')}</button></div><nav>${navHtml}</nav><div class="figma-shell-spacer"></div>${helpHtml}</aside>`;

const currentHeader=document.querySelector('.site-header');
document.body.insertBefore(sidebar,currentHeader||document.body.firstChild);
document.body.insertBefore(mobileBar,sidebar.nextSibling);
document.body.appendChild(overlay);
document.body.classList.add('figma-shell-v76115');

if(currentHeader){
  const row=currentHeader.querySelector('.pro-shell-row,.top');
  if(row&&!row.querySelector('.figma-shell-greeting')){
    const greeting=document.createElement('p');
    greeting.className='figma-shell-greeting';
    greeting.textContent='Добро пожаловать!';
    row.insertBefore(greeting,row.firstChild);
  }
}

const menuButton=mobileBar.querySelector('.figma-shell-menu-button');
const closeButton=overlay.querySelector('.figma-shell-close-button');
let previousFocus=null;
function focusable(){return Array.from(overlay.querySelectorAll('a[href],button:not([disabled])'))}
function openDrawer(){previousFocus=document.activeElement;overlay.hidden=false;document.body.classList.add('figma-shell-drawer-open');menuButton.setAttribute('aria-expanded','true');requestAnimationFrame(()=>closeButton.focus())}
function closeDrawer(){overlay.hidden=true;document.body.classList.remove('figma-shell-drawer-open');menuButton.setAttribute('aria-expanded','false');if(previousFocus&&document.contains(previousFocus))previousFocus.focus()}
menuButton.addEventListener('click',openDrawer);
closeButton.addEventListener('click',closeDrawer);
overlay.addEventListener('click',event=>{if(event.target===overlay||event.target.closest('a[href]'))closeDrawer()});
document.addEventListener('keydown',event=>{
  if(overlay.hidden)return;
  if(event.key==='Escape'){event.preventDefault();closeDrawer();return}
  if(event.key!=='Tab')return;
  const items=focusable();if(!items.length)return;
  const first=items[0],last=items[items.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
});
mobileBar.querySelector('.figma-shell-bell-button').addEventListener('click',()=>document.getElementById('pro-notification-btn')?.click());
function syncShell(){document.documentElement.style.setProperty('--figma-sidebar-width',window.innerWidth>900?'220px':'0px');document.documentElement.style.setProperty('--app-shell-height',window.innerWidth>900?'82px':'68px');if(window.innerWidth>900&&!overlay.hidden)closeDrawer()}
syncShell();window.addEventListener('resize',syncShell,{passive:true});
})();
