(function(){
  'use strict';
  const params=new URLSearchParams(location.search);
  const section=String(params.get('section')||params.get('from')||'').toLowerCase();
  const labels={
    kp:'КП',approval:'Согласование','repair-documents':'Формирование документов для ремонта','repair-process':'Процесс ремонта','repair-exit':'Выход из ремонта',objects:'Мои объекты',team:'Команда',settings:'Настройки',passport:'Карточка объекта'
  };
  const label=labels[section]||'СЛОГИ';
  const node=document.getElementById('under-development-section');
  if(node)node.textContent=label;
  document.title=`СЛОГИ — ${label} · Раздел в разработке`;
})();
