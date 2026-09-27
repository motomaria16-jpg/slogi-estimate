(function(){
  'use strict';
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const query=new URLSearchParams(location.search);
  const sections={
    'index.html':'objects','all-locations.html':'objects','measure-index.html':'objects','passport.html':'passport','measure-passport.html':'passport','proposal.html':'kp','source-specification.html':'kp','specification.html':'kp','settings.html':'settings','team.html':'team'
  };
  const section=page==='workspace.html'?(query.get('section')==='repair'?'repair-process':'kp'):(sections[page]||'objects');
  const target=new URL('under-development.html',location.href);
  target.searchParams.set('section',section);
  target.searchParams.set('from',page);
  location.replace(target.pathname+target.search+location.hash);
})();
