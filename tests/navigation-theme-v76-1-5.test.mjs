import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const themeName='schoolslogi-theme-v76-1-5.css';
const approvedThemeName='figma-shell-v76-1-15.css';
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
const removedAssets=[
  'professional-catalog.js',
  'finance-extensions.js',
  'portfolio-map.js',
  'portfolio-map.css'
];
const removedTargets=[...removedPages,...removedAssets];
const removedSpecialistCopy=['для','специалистов'].join(' ');
const read=name=>readFileSync(resolve(root,name),'utf8');
const localTarget=value=>{
  const raw=String(value||'').trim();
  if(!raw||raw.startsWith('#')||raw.startsWith('//')||/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(raw))return null;
  const clean=raw.split('#')[0].split('?')[0];
  if(!clean||/[{}$<>]/.test(clean))return null;
  return decodeURIComponent(clean.replace(/^\.\//,''));
};

test('removed tools pages and isolated assets are absent',()=>{
  for(const target of removedTargets)assert.equal(existsSync(resolve(root,target)),false,target);
});

test('all work pages keep the base theme, fail-closed gate, and approved Figma layer',()=>{
  for(const page of workPages){
    const html=read(page);
    const styles=[...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/gi)].map(match=>match[1]);
    assert.ok(styles.length,page+': stylesheets are present');
    assert.equal(localTarget(styles.at(-3)),themeName,page+': v76.1.5 base theme');
    assert.equal(localTarget(styles.at(-2)),'password-gate.css',page+': fail-closed gate stylesheet');
    assert.equal(localTarget(styles.at(-1)),approvedThemeName,page+': approved Figma design is the final presentation layer');
    assert.match(html,/schoolslogi-theme-v76-1-5\.css\?v=76114/,page+': compact-theme cache key');
    assert.match(html,/figma-shell-v76-1-15\.css\?v=76115/,page+': approved-theme cache key');
    assert.match(html,/professional-shell\.js\?v=76171/,page+': shell cache key');
    assert.match(html,/figma-shell-v76-1-15\.js\?v=76115/,page+': approved-shell cache key');
  }
});

test('primary navigation has four product routes and no tools dropdown',()=>{
  const shell=read('professional-shell.js');
  const expected=['available-spaces.html','index.html','workspace.html?section=estimate','workspace.html?section=repair'];
  for(const route of expected)assert.ok(shell.includes(route),route);
  assert.equal(shell.includes('Инструменты'),false);
  for(const target of removedPages)assert.equal(shell.includes(target),false,target);
  assert.equal(shell.includes(removedSpecialistCopy),false);
  assert.equal(shell.includes('slogi-specialist-label'),false);
});

test('specialist subtitle is absent from active markup and the final themes',()=>{
  const sources=['professional-shell.js','figma-shell-v76-1-15.js',themeName,approvedThemeName,...workPages];
  for(const source of sources){
    const text=read(source);
    assert.equal(text.includes(removedSpecialistCopy),false,source);
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
  const base=read(themeName),css=read(approvedThemeName);
  for(const token of ['#f1eeea','#fffdf9','#566f75','#435f64','#344346','#7b8584','#e9c066','#f8ebc5','"Ubuntu Sans"'])assert.ok(css.includes(token),token);
  assert.match(css,/\.figma-shell-sidebar\{/);
  assert.match(css,/\.figma-shell-help\{/);
  assert.match(css,/@media\(max-width:900px\)/);
  assert.match(css,/overflow-x:clip!important/);
  assert.match(base,/\.kp-page[\s\S]*font-family:Arial/);
});

test('search parsing rules, list actions, and cluster workspace use the approved compact scale',()=>{
  const css=read(approvedThemeName),page=read('available-spaces.html');
  assert.match(page,/class="cian-parse-rules"/);
  for(const rule of ['100–150 м²','Только 1 этаж','Не подвал / цоколь','Офис','Торговая площадь','ПСН'])assert.ok(page.includes(rule),rule);
  assert.match(css,/\.cian-parse-rules\{[\s\S]*min-height:58px/);
  assert.match(css,/body\.figma-shell-v76115 \.cian-workspace\{[\s\S]*1\.38fr[\s\S]*380px/);
  assert.match(css,/body\.figma-shell-v76115 \.cian-card-actions\{[\s\S]*grid-template-columns:1fr 1fr!important/);
  assert.match(css,/body\.figma-shell-v76115 \.cian-card-actions \.cian-remove-listing\{[\s\S]*background:#fff!important/);
  assert.match(css,/body\.figma-shell-v76115 \.cian-listing-card\.selected\{[\s\S]*figma-gold-soft/);
});

test('legacy source cards and Avito presentation are removed from approved search',()=>{
  const page=read('available-spaces.html');
  const script=read('cian-workspace.js');
  assert.equal(page.includes('cian-source-card'),false);
  assert.equal(page.includes('Авито'),false);
  assert.equal(script.includes('avito'),false);
});

test('v76.1.14 layout hooks remain presentation-only and data-dense',()=>{
  const search=read('available-spaces.html');
  const index=read('index.html');
  const app=read('phase0-app.js');
  const stage=read('stage-workspace.js');
  assert.match(search,/id="available-count"/);
  assert.match(search,/id="available-last-update"/);
  assert.match(search,/id="available-list"/);
  assert.match(search,/id="cian-map"/);
  assert.match(index,/<span>Экономика<\/span>/);
  assert.match(index,/data-action="toggle-map-expand" aria-expanded="false" aria-controls="phase0-map-stage"/);
  assert.match(app,/class="phase0-economy-cell"/);
  assert.match(app,/<h3>Основное<\/h3>/);
  assert.match(app,/<h3>Проверка<\/h3>/);
  assert.match(app,/<h3>Решение<\/h3>/);
  assert.match(app,/role="progressbar"[\s\S]*aria-valuenow=/);
  assert.match(stage,/class="stage-progress" role="progressbar"/);
  assert.match(stage,/workspace\.html\?section=estimate/);
});

test('desktop navigation uses the approved sidebar geometry and exact brand assets',()=>{
  const css=read(approvedThemeName),shell=read('figma-shell-v76-1-15.js');
  assert.match(css,/\.figma-shell-sidebar\{[\s\S]*position:fixed;[\s\S]*width:208px/);
  assert.match(css,/\.figma-shell-nav-link\{[\s\S]*align-items:center/);
  assert.ok(shell.includes('proposal-logo.png'));
  assert.ok(shell.includes('documents-owl-approved-v2.png'));
});

test('v76.1.15 approved shell audit covers every active page on desktop, tablet and mobile',()=>{
  const directory=resolve(root,'docs','design-v76-1-15-figma-shell','after');
  const slugs=['search','my-premises','estimate-and-proposal','repair','passport','source-specification','specification','proposal','team','settings','add-object'];
  for(const slug of slugs){
    for(const suffix of ['1440x900','768x1024','390x844']){
      const file=resolve(directory,`${slug}-${suffix}.jpg`);
      assert.equal(existsSync(file),true,file);
      const jpeg=readFileSync(file);
      assert.deepEqual([...jpeg.subarray(0,3)],[0xff,0xd8,0xff],file);
      assert.ok(jpeg.length>10000,file);
    }
  }
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

test('v76.1.14 layout audit includes exact-base before and responsive after screenshots',()=>{
  const directory=resolve(root,'docs','design-v76-1-14-layout-refresh');
  const slugs=['search','my-premises','estimate-and-proposal','repair','add-object'];
  for(const stage of ['before','after']){
    for(const slug of slugs){
      for(const suffix of ['1440x900','390x844']){
        const file=resolve(directory,stage,slug+'-'+suffix+'.jpg');
        assert.equal(existsSync(file),true,file);
        const jpeg=readFileSync(file);
        assert.deepEqual([...jpeg.subarray(0,3)],[0xff,0xd8,0xff],file);
        assert.ok(jpeg.length>10000,file);
      }
    }
  }
  for(const slug of slugs){
    const file=resolve(directory,'after',slug+'-768x1024.jpg');
    assert.equal(existsSync(file),true,file);
    assert.ok(readFileSync(file).length>10000,file);
  }
});
