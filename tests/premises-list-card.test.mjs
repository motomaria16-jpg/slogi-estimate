import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const card=require('../premises-list-card.js');

const base={title:'Торговое помещение',address:'Москва, ул. Примерная, 1',area:120,floor:1,totalFloors:5,ceilingHeight:4.2,rentMonthly:360000,pricePerSqm:3000,badges:[{text:'ЦИАН'},{text:'Лефортово'},{text:'12 место',tone:'ready'}]};

test('общий renderer сохраняет одинаковые базовые данные в поиске и работе',()=>{
  const search=card.render({...base,articleClass:'cian-listing-card',actionsHtml:'<button>Взять в работу</button>'});
  const work=card.render({...base,articleClass:'in-work-card',contextHtml:'<span>Просмотр назначен</span>',actionsHtml:'<button>Этап работы</button>'});
  for(const value of ['Торговое помещение','Москва, ул. Примерная, 1','120 м²','Этаж 1 из 5','Потолки 4,2 м','360 000 ₽','3 000 ₽ / м²','ЦИАН','Лефортово','12 место']){
    assert.ok(search.includes(value),`search: ${value}`);
    assert.ok(work.includes(value),`work: ${value}`);
  }
});

test('зона действий компактна, подписана и не меняет кликабельную базовую карточку',()=>{
  const html=card.render({...base,actionsLabel:'Действия в работе',actionsHtml:'<button class="premises-card__action-wide">Назначить просмотр</button><button>Этап работы</button><button>Отказ</button>'});
  assert.match(html,/class="premises-card__open cian-card-open"/);
  assert.match(html,/role="group" aria-label="Действия в работе"/);
  assert.match(html,/premises-card__action-wide/);
  const css=fs.readFileSync(new URL('../premises-list-card.css',import.meta.url),'utf8');
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/min-height:32px!important/);
  assert.doesNotMatch(css,/\.premises-card__actions button[^}]+width:100%/);
});

test('список поиска не содержит ссылку на «Мои помещения»',()=>{
  const source=fs.readFileSync(new URL('../cian-workspace.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Открыть в «Моих помещениях»/);
});

test('обе страницы загружают единые renderer и styles',()=>{
  for(const page of ['available-spaces.html','in-work.html']){
    const html=fs.readFileSync(new URL(`../${page}`,import.meta.url),'utf8');
    assert.match(html,/premises-list-card\.css/);
    assert.match(html,/premises-list-card\.js/);
  }
});

test('на странице работы открывается каноническая карточка',()=>{
  const html=fs.readFileSync(new URL('../in-work.html',import.meta.url),'utf8');
  const source=fs.readFileSync(new URL('../in-work-app.js',import.meta.url),'utf8');
  assert.match(html,/search-space-card-modal\.js/);
  assert.match(source,/spaceCardModal\.open/);
  assert.match(source,/openCanonicalCard/);
});
