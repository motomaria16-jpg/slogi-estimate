import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const themeName='schoolslogi-theme-v76-1-5.css';
const workPages=[
  'available-spaces.html',
  'index.html',
  'workspace.html',
  'passport.html',
  'source-specification.html',
  'specification.html',
  'proposal.html',
  'team.html',
  'settings.html'
];
const removedPages=[
  'tasks.html',
  'documents.html',
  'approvals.html',
  'finance.html',
  'contractors.html',
  'analytics.html',
  'catalog.html'
];
const removedScripts=['professional-catalog.js','finance-extensions.js'];
const removedTargets=[...removedPages,...removedScripts];
const read=name=>readFileSync(resolve(root,name),'utf8');
const localTarget=value=>{
  const raw=String(value||'').trim();
  if(!raw||raw.startsWith('#')||raw.startsWith('//')||/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(raw))return null;
  const clean=raw.split('#')[0].split('?')[0];
  if(!clean||/[{}$<>]/.test(clean))return null;
  return decodeURIComponent(clean.replace(/^\.\//,''));
};

test('removed tools pages and isolated scripts are absent',()=>{
  for(const target of removedTargets)assert.equal(existsSync(resolve(root,target)),false,target);
});

test('all work pages keep the v76.1.5 theme and load the fail-closed gate last',()=>{
  for(const page of workPages){
    const html=read(page);
    const styles=[...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi)].map(match=>match[1]);
    assert.ok(styles.length,page+': stylesheets are present');
    assert.equal(localTarget(styles.at(-2)),themeName,page+': theme remains the final product stylesheet');
    assert.equal(localTarget(styles.at(-1)),'password-gate.css',page+': gate veil is the final security stylesheet');
    assert.match(html,/schoolslogi-theme-v76-1-5\.css\?v=76171/,page+': compact-theme cache key');
    assert.match(html,/professional-shell\.js\?v=76171/,page+': shell cache key');
  }
});

test('primary navigation has four product routes and no tools dropdown',()=>{
  const shell=read('professional-shell.js');
  const expected=['available-spaces.html','index.html','workspace.html?section=estimate','workspace.html?section=repair'];
  for(const route of expected)assert.ok(shell.includes(route),route);
  assert.equal(shell.includes('Инструменты'),false);
  for(const target of removedPages)assert.equal(shell.includes(target),false,target);
  assert.equal(shell.includes('для специалистов'),false);
  assert.equal(shell.includes('slogi-specialist-label'),false);
});

test('specialist subtitle is absent from active markup and the final theme',()=>{
  const sources=['professional-shell.js',themeName,...workPages];
  for(const source of sources){
    const text=read(source);
    assert.equal(text.includes('для специалистов'),false,source);
    assert.equal(text.includes('slogi-specialist-label'),false,source);
  }
});

test('password gate is early and the former workspace action is absent',()=>{
  const shell=read('professional-shell.js');
  const gateCss=read('password-gate.css');
  assert.equal(/placeWorkspaceControl|watchWorkspaceControl|slogi-workspace-connect/.test(shell),false);
  assert.match(gateCss,/data-slogi-access="pending"/);
  for(const page of workPages){
    const html=read(page);
    assert.match(html,/data-slogi-access="pending"/);
    assert.ok(html.indexOf('shared-workspace.js?v=7617')<html.indexOf('</head>'),page);
  }
});

test('active application sources do not link to removed targets',()=>{
  const activeSources=[
    'professional-shell.js',
    'professional-pages.js',
    'passport-v4.js',
    'passport.html',
    'portfolio-map.js',
    ...workPages
  ];
  for(const source of new Set(activeSources)){
    const text=read(source);
    for(const target of removedTargets)assert.equal(text.includes(target),false,source+' -> '+target);
  }
});

test('remaining html has no broken local href, src, or stylesheet targets',()=>{
  const htmlFiles=readdirSync(root).filter(name=>extname(name)==='.html');
  const broken=[];
  for(const page of htmlFiles){
    const html=read(page);
    for(const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)){
      const target=localTarget(match[1]);
      if(!target)continue;
      const path=resolve(root,target);
      if(!existsSync(path))broken.push(page+' -> '+target);
    }
  }
  assert.deepEqual(broken,[]);
});

test('theme exposes School SLOGI tokens, readable scale, and responsive shell rules',()=>{
  const css=read(themeName);
  for(const token of ['#f2ede8','#fcf5eb','#3c3c3c','#e39b2f','#d8b889','"Ubuntu Sans"'])assert.ok(css.includes(token),token);
  assert.match(css,/min-height:44px!important/);
  assert.match(css,/font-size:16px!important/);
  assert.match(css,/font-size:14px!important/);
  assert.match(css,/@media\(max-width:900px\)/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/overflow-x:clip!important/);
  assert.match(css,/\.kp-page[\s\S]*font-family:Arial/);
});

test('search hero, source cards and listing rows use the compact shared scale',()=>{
  const css=read(themeName);
  assert.match(css,/body\.available-spaces-page \.cian-hero\{[\s\S]*margin-bottom:14px!important;[\s\S]*padding:28px 32px!important;/);
  assert.match(css,/body\.available-spaces-page \.cian-hero h1\{[\s\S]*font-size:clamp\(38px,3\.4vw,48px\)!important;/);
  assert.match(css,/body\.available-spaces-page \.cian-source-card\{[\s\S]*padding:16px 18px!important;[\s\S]*border-radius:18px!important;/);
  assert.match(css,/body\.available-spaces-page \.cian-source-card h2\{[\s\S]*font-size:19px!important;/);
  assert.match(css,/body\.available-spaces-page \.cian-results\{[\s\S]*padding:0!important;[\s\S]*overflow:hidden!important;/);
  assert.match(css,/body\.available-spaces-page \.cian-listing-card\{[\s\S]*border-radius:0!important;[\s\S]*background:#fffdf9!important;/);
  assert.match(css,/body\.available-spaces-page \.cian-card-open\{[\s\S]*padding:18px 22px!important;/);
  assert.match(css,/body\.available-spaces-page \.cian-listing-card h3\{[\s\S]*font-size:18px!important;/);
});

test('Avito remains a disabled presentation-only source',()=>{
  const page=read('available-spaces.html');
  const script=read('cian-workspace.js');
  assert.match(page,/cian-source-card disabled" aria-disabled="true"/);
  assert.match(page,/Авито — подключение готовится/);
  assert.equal(script.includes('avito'),false);
});

test('desktop product labels are vertically centered in the shared header',()=>{
  const css=read(themeName);
  assert.match(css,/\.slogi-search-page \.site-header \.top>\.pro-nav \.pro-nav-inner\{[\s\S]*height:100%!important;[\s\S]*align-items:center!important;/);
  assert.match(css,/\.slogi-search-page \.site-header \.pro-product-nav\{[\s\S]*height:100%!important;[\s\S]*align-items:center!important;[\s\S]*align-self:center!important;/);
});

test('after screenshots cover six states on desktop and mobile',()=>{
  const directory=resolve(root,'docs','design-v76-1-5','after');
  const slugs=['search','my-premises','estimate-and-proposal','repair','add-object','competitive-analysis'];
  for(const slug of slugs){
    for(const suffix of ['desktop-1440x900','mobile-390x844']){
      const file=resolve(directory,slug+'-'+suffix+'.jpg');
      assert.equal(existsSync(file),true,file);
      const jpeg=readFileSync(file);
      assert.deepEqual([...jpeg.subarray(0,3)],[0xff,0xd8,0xff],file);
      assert.ok(jpeg.length>10000,file);
    }
  }
});

test('v76.1.7 compact-search audit includes before and after desktop/mobile screenshots',()=>{
  const directory=resolve(root,'docs','design-v76-1-7-compact-search');
  for(const stage of ['before','after']){
    for(const slug of ['search','my-premises']){
      for(const suffix of ['desktop-1440x900','mobile-390x844']){
        const file=resolve(directory,stage,slug+'-'+suffix+'.jpg');
        assert.equal(existsSync(file),true,file);
        const jpeg=readFileSync(file);
        assert.deepEqual([...jpeg.subarray(0,3)],[0xff,0xd8,0xff],file);
        assert.ok(jpeg.length>10000,file);
      }
    }
  }
});
