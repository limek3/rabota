/* eslint-disable */
/**
 * «Обучение оператора · Авто» — движок страницы /learn.
 *
 * Та же обучалка, что и отдельный HTML: курс «Авто», тренажёр Скорозвона,
 * справочники, тренажёры, поиск и выдвижная панель. Разметка — классы CRM,
 * стили — app/academy.css (всё под корнем .acad). Меню обучения рисует CRM
 * (components/app/LearnRail.tsx) — движок только сообщает ему «academy:change».
 *
 * Прогресс — записи learn аккаунта в CRM (opts.records / opts.save / opts.reset):
 * courseId "op-auto", itemId — id материала, как в прежней академии. В браузере
 * хранится только интерфейс: ответы незаконченного теста, режим скрипта, недавнее.
 *
 * mountAcademy(root, opts) → { destroy } — все обработчики снимаются при уходе.
 */
import RAW from "./data.json";
import { ICONS as IC } from "@/components/ui/icons";

export function mountAcademy(root, opts) {
 opts = opts || {};
 const DATA = JSON.parse(JSON.stringify(RAW));
 const __L = [];
 const __on = (t, ty, fn, o) => { t.addEventListener(ty, fn, o); __L.push([t, ty, fn, o]); };
 const VIEW = root;
 const DRW_EL = document.createElement("div"); DRW_EL.id = "acad-drawer"; DRW_EL.className = "acad"; document.body.appendChild(DRW_EL);
 const PAL_EL = document.createElement("div"); PAL_EL.id = "acad-pal"; PAL_EL.className = "acad"; document.body.appendChild(PAL_EL);

/* ================= симулятор Скорозвона =================
   Копия рабочего места оператора (без живых данных) + пошаговый показ:
   «Смотреть» — курсор сам едет и нажимает, «Пройти самому» — нажимает оператор,
   нужное место подсвечено. Экран — функция от номера шага (szStateAt), поэтому
   шаги можно листать и перематывать мышкой в любую сторону. Экран не
   перерисовывается целиком: szMorph меняет только то, что изменилось, —
   поэтому при вводе текста ничего не моргает.
   Ядро самостоятельное: статусы результатов передаются при создании (szCreate). */
const szEsc=s=>String(s==null?"":s).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const szNorm=s=>String(s).toLowerCase().replace(/ё/g,"е");
const SZW=1100,SZH=680;
const SZ_PHONE="+7 (999) 123-45-67";
const SZ_BASE={page:"dial",status:"wait",menu:"",call:"idle",client:false,f:{},open:"",modal:"",
 trMode:"emp",trQ:"",trList:false,trPick:"",consult:false,task:{date:"",time:"",note:""},res:"",note:"",check:false,toast:""};
const SZ_GROUPS=["Успешные","Промежуточные","Недозвон","Неуспешные"];
const SZ_FIELDS=[{k:"tags",l:"Теги"},{k:"city",l:"Город где покупает"},{k:"budget",l:"Бюджет"},{k:"term",l:"Срок сдачи"},
 {k:"rooms",l:"Комнатность"},{k:"pay",l:"Способ оплаты"},{k:"when",l:"Когда готовы купить"}];
const SZ_CFG={
 auto:{
  scriptName:"Авто — скрипт звонка",
  script:[
   {h:"1. Приветствие и интерес"},
   {b:"Здравствуйте (Добрый день). Меня зовут ___."},
   {b:"Представляю сервис по подбору автомобилей."},
   {i:"Не делаем паузу, сразу переходим к вопросу."},
   {b:"Подскажите, вас интересует покупка НОВОГО автомобиля на выгодных условиях?",strong:1},
   {h:"2. Марка и формат покупки"},
   {b:"У нас только НОВЫЕ автомобили разных марок. Подскажите, какую марку рассматриваете?"},
   {b:"Подскажите, покупку рассматриваете как физическое лицо?"},
   {h:"3. Способ оплаты"},
   {b:"Подскажите, рассматриваете кредит, наличные, трейд-ин или другие варианты?"}],
  region:"г. Москва и Московская область",
  fields:[
   {k:"city",l:"Город где покупает",opts:["Москва","Санкт-Петербург","Другой регион"],pick:"Москва",ask:"Клиент сказал, что покупает в Москве"},
   {k:"pay",l:"Способ оплаты",opts:["Кредит","Наличные","Трейд-ин","Рассрочка"],pick:"Кредит",ask:"Клиент ответил, что берёт в кредит"}],
  filled:{city:"Москва",pay:"Кредит"},
  search:"авто",
  list:["TANK БалтАвтоТрейд","Про контекст авто","Тэнк Авторусь","Авто.ру","Geely Автополе","CHERY (TENET) Автополе"],
  target:"Авто.ру",
  trapNote:"В списке много похожих названий с «авто» — это дилерские центры. Нам нужен именно «Авто.ру».",
  checkWhere:"по компании «Авто.ру»",
  say:"«Добрый день! Клиент Андрей, Москва. Интересует новый автомобиль, смотрит Chery, бюджет около 2,5 млн, покупка в кредит, как физлицо. Готовы принять?»",
  sayWhat:"Имя, город, марка, бюджет и способ оплаты — одним сообщением. Менеджер не должен переспрашивать клиента то, что вы уже узнали.",
  lead:"Лид",leadWhy:"Клиент передан менеджеру — это успешный звонок, результат «Лид».",
  leadNote:"Переведён на Авто.ру, Chery, кредит",callNote:"Перезвонить завтра в 15:00, выбирает марку",drop:"Сброс после привет",
  },
 realty:{
  scriptName:"Недвижимость — скрипт реактивации",
  script:[
   {h:"1. Открытие звонка"},
   {b:"Добрый день! Перезваниваю по поводу квартир в новостройке, ранее интересовались, ещё присматриваете варианты?",strong:1},
   {i:"Если «нет» — не прощаемся: «Подскажите, отложили покупку?»"},
   {h:"2. Знакомство и квалификация"},
   {b:"Как к вам можно обращаться?"},
   {b:"Какой город рассматриваете?"},
   {b:"Сколько комнат планируете? На какой бюджет ориентируетесь?"},
   {h:"3. Способ покупки и срок"},
   {b:"Покупку планируете в ипотеку или за наличные?"},
   {b:"Рассматриваете сданные дома или можно со сроком сдачи?"}],
  region:"г. Санкт-Петербург",
  fields:[
   {k:"city",l:"Город где покупает",opts:["Москва","Санкт-Петербург","Казань","Другой город"],pick:"Санкт-Петербург",ask:"Клиент сказал, что ищет квартиру в Санкт-Петербурге"},
   {k:"pay",l:"Способ оплаты",opts:["Ипотека","Наличные","Рассрочка"],pick:"Ипотека",ask:"Клиент ответил, что покупает в ипотеку"}],
  filled:{city:"Санкт-Петербург",pay:"Ипотека",rooms:"2"},
  search:"яндекс",
  list:["Яндекс недвижимость МСК","Яндекс недвижимость СПБ"],
  target:"Яндекс недвижимость СПБ",
  trapNote:"Проект выбираем по городу клиента. Клиент из Санкт-Петербурга — значит «Яндекс недвижимость СПБ».",
  checkWhere:"в форме проверки",
  say:"«Добрый день! Клиент Андрей, Санкт-Петербург, двухкомнатная, бюджет до 9 млн, ипотека, рассматривает сданные дома. Готовы принять?»",
  sayWhat:"Всегда в одном порядке: имя, город, комнатность, бюджет, способ покупки и срок сдачи. Менеджер должен получить готовую картину.",
  lead:"Лид СПБ ЯН",leadWhy:"Клиент из Санкт-Петербурга передан на Яндекс — результат «Лид СПБ ЯН». Для Москвы был бы «Лид МСК ЯН».",
  leadNote:"Переведён на Яндекс СПБ, 2к, ипотека",callNote:"Перезвонить завтра в 15:00, после работы",drop:"Сброс",
  }
};
function szTomorrow(){const d=new Date(Date.now()+864e5),p=n=>String(n).padStart(2,"0");return p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear();}
function szS(o){return Object.assign({},SZ_BASE,{f:{},task:{date:"",time:"",note:""}},o||{});}
function szChapters(track){
 const c=SZ_CFG[track];
 const talking=()=>szS({status:"talk",call:"talk",client:true});
 const waiting=s=>szS({toast:s.toast});
 const S_=(s,o)=>Object.assign({},s,o);
 return [
  {id:"start",t:"Начало смены",
   learn:["что такое статус доступности и какие они бывают","как встать на линию, чтобы пошли звонки","где рабочее место оператора"],
   init:szS({page:"welcome",status:"dnd"}),
   steps:[
    {at:"status",act:"look",t:"Это ваш статус",d:"Вы вошли в Скорозвон. Красный кружок рядом с именем — статус «Не беспокоить»: пока он красный, звонки к вам не приходят. Смена начинается со смены статуса."},
    {at:"status",t:"Нажмите на кружок статуса",d:"Откроется список статусов.",go:s=>S_(s,{menu:"status"})},
    {at:"menu-status",act:"look",t:"Четыре статуса",d:"«Доступен» — принимаете звонки, основной статус смены. «Не беспокоить» — созвон с руководителем, техническая проблема, конец дня. «Ручной обзвон» — перезваниваете клиенту, с которым договорились. «Перерыв» — обед."},
    {at:"st:ready",t:"Выберите «Доступен»",d:"Так вы говорите системе: «я на месте, давайте звонки».",go:s=>S_(s,{menu:"",status:"ready"})},
    {at:"status",act:"look",t:"Кружок стал зелёным",d:"Вы на линии. Осталось открыть рабочее место, где идут звонки."},
    {at:"nav-dial",t:"Откройте вкладку «Прозвон»",d:"Это рабочее место оператора — здесь вы проведёте всю смену.",go:s=>S_(s,{page:"dial",status:"wait"})},
    {at:"left",act:"look",t:"Слева — карточка клиента",d:"Когда придёт звонок, здесь появятся номер, таймер разговора, кнопки управления звонком и поля, куда вы записываете ответы клиента."},
    {at:"script",act:"look",t:"Справа — сценарий разговора",d:"Скрипт, по которому вы ведёте разговор. Он всегда перед глазами — учить наизусть не нужно."},
    {at:"status",act:"look",t:"Жёлтые часы — ждём звонка",d:"Номера набираются автоматически. Искать и набирать клиентов самому не нужно: как только клиент возьмёт трубку, звонок сразу попадёт к вам."}],
   sum:["Начало смены: кружок статуса → «Доступен» → вкладка «Прозвон».","Красный кружок — звонков не будет. Зелёный — вы на линии.","Жёлтые часы — ждём звонка, оранжевая трубка — идёт разговор."]},
  {id:"call",t:"Звонок и карточка клиента",
   learn:["как выглядит входящий звонок","какие кнопки есть во время разговора","как записывать ответы клиента в карточку"],
   init:szS(),
   steps:[
    {at:"status",act:"look",t:"Вы ждёте звонка",d:"Статус «Доступен», вкладка «Прозвон» открыта. Ничего нажимать не нужно — звонок придёт сам.",go:s=>S_(s,{status:"talk",call:"talk",client:true})},
    {at:"call-head",act:"look",t:"Клиент взял трубку",d:"Сверху — номер клиента, регион и местное время. Справа идёт таймер разговора. Клиент уже вас слышит — сразу здоровайтесь."},
    {at:"status",act:"look",t:"Статус сменился на трубку",d:"Оранжевая трубка — вы в разговоре. После звонка статус вернётся сам."},
    {at:"call-btns",act:"look",t:"Кнопки во время звонка",d:"Слева направо: клавиатура, перевод вызова, выключить микрофон, удержание и красная «Завершить». Перевод понадобится, когда клиент готов, — это отдельная глава."},
    {at:"script",act:"look",t:"Говорите по сценарию",d:"Читайте реплики сверху вниз. Жирным выделено главное. Серым курсивом — подсказки для вас, их вслух не читаем."}],
   sum:["Звонок приходит сам — после «Доступен» ничего набирать не нужно.","Как только клиент ответил — сразу говорите по сценарию справа.","Во время разговора держите перед глазами скрипт и не делайте пауз."]},
  {id:"result",t:"Как ставить на перезвон",
   learn:["как поставить задачу на перезвон и не потерять договорённость","где выбрать результат звонка","почему без «Сохранить» звонок не закончен"],
   init:talking(),
   steps:[
    {at:"script",act:"look",t:"Клиент просит перезвонить завтра в 15:00",d:"Клиент сейчас занят, но готов поговорить завтра. Договорились о времени — значит, нужен перезвон. Сначала завершим звонок."},
    {at:"btn-end",t:"Попрощайтесь и нажмите «Завершить»",d:"Красная кнопка кладёт трубку.",go:s=>S_(s,{call:"ended",status:"wait"})},
    {at:"results",act:"look",t:"Внизу — результаты звонка",d:"После каждого разговора выбираем один результат. Сверху фильтры по группам: «Успешные» — лид, «Промежуточные» — интерес и перезвон, «Недозвон» — не ответили, «Неуспешные» — отказ, сброс и т. п."},
    {at:"btn-task",t:"Сначала — «Добавить задачу»",d:"Правило: сначала задача на перезвон, потом результат. Иначе договорённость потеряется.",go:s=>S_(s,{modal:"task",task:{date:"",time:"",note:""}})},
    {at:"modal",act:"look",t:"Окно задачи",d:"Тип — «Звонок», исполнитель — вы сами, это уже стоит. Осталось указать дату, время и комментарий."},
    {at:"task-date",act:"type",text:szTomorrow(),t:"Впишите дату — завтра",set:(s,v)=>S_(s,{task:Object.assign({},s.task,{date:v})})},
    {at:"task-time",act:"type",text:"15:00",t:"Впишите время — 15:00",set:(s,v)=>S_(s,{task:Object.assign({},s.task,{time:v})})},
    {at:"task-note",act:"type",text:c.callNote,t:"Коротко напишите, о чём договорились",d:"Завтра вы (или коллега) откроете задачу и сразу поймёте, почему звоним.",set:(s,v)=>S_(s,{task:Object.assign({},s.task,{note:v})})},
    {at:"task-save",t:"Нажмите «Сохранить»",go:s=>S_(s,{modal:"",toast:"Задача на перезвон создана"})},
    {at:"r:Перезвонить",t:"Теперь результат — «Перезвонить»",d:"Он в группе «Промежуточные»: клиент не отказался, разговор продолжится завтра.",go:s=>S_(s,{res:"Перезвонить"})},
    {at:"note",act:"type",text:"Перезвон завтра в 15:00",t:"Добавьте комментарий к звонку",set:(s,v)=>S_(s,{note:v})},
    {at:"save",t:"Нажмите «Сохранить»",d:"Без этой кнопки результат не запишется, а звонок будет считаться незаконченным.",go:s=>waiting(S_(s,{toast:"Результат сохранён"}))},
    {at:"status",act:"look",t:"Готово — ждём следующий звонок",d:"Результат записан, вы снова на линии."}],
   sum:["После каждого звонка — результат и кнопка «Сохранить».","Договорились перезвонить — сначала задача, потом результат «Перезвонить».","Не взяли трубку или автоответчик — «НДЗ/АО». Услышал, кто звонит, и молча сбросил — «"+c.drop+"»."]},
  {id:"transfer",t:"Перевод клиента менеджеру",
   learn:["где кнопка перевода вызова","как найти нужный проект в списке","зачем сначала «Консультация», а потом «Перевести»"],
   init:talking(),
   steps:[
    {at:"script",act:"look",t:"Клиент готов — пора переводить",d:"Клиент ответил на все вопросы сценария и согласен поговорить со специалистом. Переводим, не кладя трубку."},
    {at:"btn-transfer",t:"Нажмите «Перевод вызова»",d:"Вторая кнопка слева — трубка со стрелкой.",go:s=>S_(s,{modal:"transfer",trMode:"emp"})},
    {at:"modal",act:"look",t:"Окно «Перевод вызова»",d:"Перевести можно на сотрудника, на номер вручную или на номер из списка. Мы всегда переводим через «Номер из списка»."},
    {at:"tr-list",t:"Выберите «Номер из списка»",go:s=>S_(s,{trMode:"list"})},
    {at:"tr-q",act:"type",text:c.search,t:"Начните вводить «"+c.search+"»",d:"Список отфильтруется по названию.",set:(s,v)=>S_(s,{trQ:v,trList:true})},
    {at:"tr:"+c.target,t:"Выберите «"+c.target+"»",d:c.trapNote,go:s=>S_(s,{trList:false,trPick:c.target,trQ:c.target})},
    {at:"tr-consult",t:"Нажмите «Консультация»",d:"Клиент встанет на удержание и вас не слышит, а вы говорите с менеджером. Сразу «Перевести» не нажимаем — менеджер должен знать, кого принимает.",go:s=>S_(s,{consult:true})},
    {at:"say",act:"look",t:"Коротко расскажите менеджеру о клиенте",d:c.sayWhat},
    {at:"tr-go",t:"Менеджер готов — нажмите «Перевести»",d:"Клиент соединится с менеджером, а вы выходите из разговора.",go:s=>S_(s,{modal:"",consult:false,call:"moved",status:"wait",toast:"Вызов переведён"})},
    {at:"call-head",act:"look",t:"Клиент у менеджера",d:"Ваша часть разговора закончена. Осталось отметить результат звонка."},
    {at:"r:"+c.lead,t:"Выберите результат «"+c.lead+"»",d:c.leadWhy,go:s=>S_(s,{res:c.lead})},
    {at:"note",act:"type",text:c.leadNote,t:"Добавьте комментарий",set:(s,v)=>S_(s,{note:v})},
    {at:"save",t:"Нажмите «Сохранить»",go:s=>waiting(S_(s,{toast:"Результат сохранён · лид засчитан"}))}],
   sum:["«Перевод вызова» → «Номер из списка».","Ищем «"+c.target+"» → «Консультация» → говорим менеджеру о клиенте.","Менеджер готов → «Перевести» → результат «"+c.lead+"» → «Сохранить»."]},
  {id:"end",t:"Перерыв и конец смены",
   learn:["как уйти на обед, чтобы звонки не шли","как правильно закончить смену"],
   init:szS(),
   steps:[
    {at:"status",t:"Идёте на обед — нажмите на кружок статуса",go:s=>S_(s,{menu:"status"})},
    {at:"st:break",t:"Выберите «Перерыв»",d:"Звонки перестанут приходить. Вернулись — снова ставите «Доступен».",go:s=>S_(s,{menu:"",status:"break"})},
    {at:"status",act:"look",t:"Синяя пауза — вы на перерыве"},
    {at:"status",t:"Конец смены — снова откройте статусы",go:s=>S_(s,{menu:"status"})},
    {at:"st:dnd",t:"Выберите «Не беспокоить»",d:"Первое действие в конце дня.",go:s=>S_(s,{menu:"",status:"dnd"})},
    {at:"user",t:"Нажмите на своё имя",go:s=>S_(s,{menu:"user"})},
    {at:"exit",t:"Нажмите «Выход»",go:s=>S_(s,{menu:"",page:"out"})},
    {at:"login",act:"look",t:"Смена закрыта",d:"Без «Не беспокоить» и «Выхода» мотивация за день посчитается неверно. Это обязательно каждый день."}],
   sum:["Обед — «Перерыв», вернулись — «Доступен».","Конец смены: «Не беспокоить» → имя → «Выход». Каждый день."]}
 ];
}
const szAct=st=>st.act||(st.at?"click":"look");
function szAfter(st,s){let n=Object.assign({},s,{toast:""});if(st.set&&st.text)n=st.set(n,st.text);if(st.go)n=st.go(n);return n;}
function szStateAt(ch,i){let s=ch.init;for(let k=0;k<Math.min(i,ch.steps.length);k++)s=szAfter(ch.steps[k],s);return s;}
/* сколько держать шаг до нажатия: новичку нужно успеть прочитать */
const szRead=st=>Math.min(9000,Math.max(2600,1400+(st.t.length+(st.d?st.d.length:0))*36));

/* --- экран Скорозвона --- */
function szDot(s){
 const bg={dnd:"#e8492f",manual:"#e8492f",ready:"#7cc242",wait:"#f2b632",talk:"#f08a1c",break:"#3d8fd6"}[s];
 const g={dnd:'<path d="M4.5 8h7"/>',manual:'<path d="M4.5 8h7"/>',ready:'<path d="m4.6 8.2 2.3 2.2 4.4-4.6"/>',wait:'<path d="M8 4.6V8l2.3 1.4"/>',
  talk:'<path d="M5.3 4.3h1.6l.8 2-1 .8a5 5 0 0 0 2.2 2.2l.8-1 2 .8v1.6c0 .5-.4.9-.9.9A6.8 6.8 0 0 1 4.4 5.2c0-.5.4-.9.9-.9z" fill="#fff" stroke="none"/>',
  break:'<path d="M6.4 5.2v5.6M9.6 5.2v5.6"/>'}[s];
 return `<svg width="16" height="16" viewBox="0 0 16 16" class="szx-dot"><circle cx="8" cy="8" r="8" fill="${bg}"/><g stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">${g}</g></svg>`;
}
function szTime(sec){const p=n=>String(n).padStart(2,"0");return p(Math.floor(sec/60))+":"+p(sec%60);}
function szCallText(s,sec){
 if(s.call==="talk")return (s.consult?"Консультация ":"Разговор ")+szTime(sec);
 if(s.call==="ended")return "Вызов завершен "+szTime(sec);
 if(s.call==="moved")return "Вызов переведён";
 return "";
}
function szScreen(s,c,sec,statuses){
 const e=szEsc,dial=s.page==="dial";
 const top=`<div class="szx-top">
  <div class="szx-logo"><svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#e6e6e6" stroke-width="2.4" stroke-linecap="round"><path d="M5 8c3 1 6 5 7 13M12 21c1-6 3-10 7-13M15 4.5a6 6 0 0 1 5 3M16.5 1.8a9 9 0 0 1 6.4 4.2"/></svg></div>
  <nav class="szx-nav"><span>Проекты</span><span data-sz="nav-dial" class="${dial?"on":""}">Прозвон</span><span>Контакты</span><span>Отчеты</span><span>Вызовы</span></nav>
  <span class="szx-bell"><svg width="18" height="18" viewBox="0 0 24 24" fill="#dfe6ee"><path d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5-6.7V3.5a2 2 0 0 0-4 0v.8A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg></span>
  <span class="szx-search">Для поиска нажмите enter</span>
  <span class="szx-bars"><i></i><i></i><i></i><i></i></span>
  <span class="szx-me"><span data-sz="status" class="szx-st">${szDot(s.status)}</span><span data-sz="user" class="szx-name">Оператор <small>▾</small></span>
   ${s.menu==="status"?`<div class="szx-menu st" data-sz="menu-status">${[["ready","Доступен"],["dnd","Не беспокоить"],["manual","Ручной обзвон"],["break","Перерыв"]].map(x=>`<div data-sz="st:${x[0]}" class="szx-mi">${szDot(x[0])} ${x[1]}</div>`).join("")}</div>`:""}
   ${s.menu==="user"?`<div class="szx-menu us" data-sz="menu-user"><div class="szx-mh">ID аккаунта</div><div class="szx-mi link">Профиль</div><div class="szx-mi link">Настройки</div><div class="szx-mi link" data-sz="exit">Выход</div></div>`:""}
  </span>
  <span class="szx-help">?</span></div>`;
 let body="";
 if(s.page==="welcome")body=`<div class="szx-welcome"><h2>Добро пожаловать в Скорозвон!</h2><p>Здесь проходит вся ваша смена: звонки, сценарий разговора, результаты и перевод клиента менеджеру.</p><div class="szx-video"><span>▶</span></div><span class="szx-btn green">Перейти к инструкции</span></div>`;
 if(s.page==="out")body=`<div class="szx-welcome"><div class="szx-login" data-sz="login"><h3>Вход в Скорозвон</h3><div class="szx-in">Логин</div><div class="szx-in">Пароль</div><span class="szx-btn green">Войти</span><p>Вы вышли из системы. Смена завершена.</p></div></div>`;
 if(dial){
  const head=s.client
   ?`<b class="szx-title">${SZ_PHONE}</b><div class="szx-ph">${SZ_PHONE}</div><div class="szx-sub">${e(c.region)}</div><div class="szx-sub">Местное время: 12:40</div>`
   :`<b class="szx-title muted">Ожидание вызова</b><div class="szx-waitdots"><i></i><i></i><i></i></div><div class="szx-sub">Номер наберётся автоматически</div>`;
  const btns=s.call==="talk"
   ?`<span class="szx-ib" title="Клавиатура"><svg width="14" height="14" viewBox="0 0 14 14" fill="#333">${[0,5,10].map(y=>[0,5,10].map(x=>`<rect x="${x}" y="${y}" width="4" height="4"/>`).join("")).join("")}</svg></span>
     <span class="szx-ib" data-sz="btn-transfer" title="Перевод вызова"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2.4" stroke-linecap="round"><path d="M9 5a7 7 0 1 0 0 14M13 12h8m-3-3 3 3-3 3"/></svg></span>
     <span class="szx-ib" title="Микрофон"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2.2" stroke-linecap="round"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16"/></svg></span>
     <span class="szx-ib" title="Удержание"><svg width="12" height="12" viewBox="0 0 12 12" fill="#333"><rect x="1" y="1" width="3.4" height="10"/><rect x="7.6" y="1" width="3.4" height="10"/></svg></span>
     <span class="szx-btn red" data-sz="btn-end">Завершить</span>`
   :`<span class="szx-btn green">Позвонить</span>`;
  const fields=SZ_FIELDS.map(fl=>{
   const cf=c.fields.find(x=>x.k===fl.k),v=s.f[fl.k]||"";
   return `<div class="szx-row"><label>${fl.l}</label><div class="szx-in sel${s.open===fl.k?" open":""}${v?" filled":""}" data-sz="f:${fl.k}">${e(v)}</div>
    ${s.open===fl.k&&cf?`<div class="szx-drop">${cf.opts.map(o=>`<div data-sz="opt:${e(o)}" class="szx-do">${e(o)}</div>`).join("")}</div>`:""}</div>`;
  }).join("");
  const script=c.script.map(x=>x.h?`<div class="szx-sh">${e(x.h)}</div>`:x.i?`<div class="szx-si">${e(x.i)}</div>`:`<div class="szx-sb${x.strong?" strong":""}">${e(x.b)}</div>`).join("");
  const res=s.call!=="idle"?`<div class="szx-res" data-sz="results"><div class="szx-rtabs">Результаты: <u class="on">Все</u>${SZ_GROUPS.map(g=>`<u>${g}</u>`).join("")}</div>
   <div class="szx-rgrid">${statuses.map(x=>`<div data-sz="r:${e(x.n)}" class="szx-r g${SZ_GROUPS.indexOf(x.g)}${s.res===x.n?" on":""}"><i></i>${e(x.n)}</div>`).join("")}</div></div>`:"";
  let modal="";
  if(s.modal==="task")modal=`<div class="szx-modal" data-sz="modal"><div class="szx-mt">РЕДАКТИРОВАНИЕ ЗАДАЧИ <span>×</span></div><div class="szx-mb">
   <div class="szx-mr"><label>Дата</label><div class="szx-in w1" data-sz="task-date">${e(s.task.date)}</div><div class="szx-in w2" data-sz="task-time">${e(s.task.time)}</div></div>
   <div class="szx-mr"><label>Тип</label><div class="szx-in sel">Звонок</div></div>
   <div class="szx-mr"><label>Контакт</label><span>${SZ_PHONE}</span></div>
   <div class="szx-mr"><label>Исполнитель</label><div class="szx-in sel">(Назначить себе)</div></div>
   <div class="szx-mr"><label>Комментарий</label><div class="szx-in tall" data-sz="task-note">${e(s.task.note)}</div></div>
   <div class="szx-mr"><label></label><span class="szx-cb">☐ Автоматически выполнить задачу после звонка</span></div></div>
   <div class="szx-mf"><span class="szx-btn gray">Отменить</span><span class="szx-btn green" data-sz="task-save">Сохранить</span></div></div>`;
  if(s.modal==="transfer")modal=`<div class="szx-modal" data-sz="modal"><div class="szx-mt">ПЕРЕВОД ВЫЗОВА <span>×</span></div><div class="szx-mb">
   <div class="szx-mr"><span class="szx-radio"><i class="${s.trMode==="emp"?"on":""}"></i> Сотрудник</span><div class="szx-in sel">Выберите сотрудника</div></div>
   <div class="szx-mr"><span class="szx-radio"><i></i> Телефон</span><div class="szx-in"></div></div>
   <div class="szx-mr"><span class="szx-radio" data-sz="tr-list"><i class="${s.trMode==="list"?"on":""}"></i> Номер из списка</span>
    <div class="szx-combo"><div class="szx-in sel${s.trList?" open":""}" data-sz="tr-q">${e(s.trQ)}</div>
    ${s.trList?`<div class="szx-drop tall">${c.list.filter(x=>szNorm(x).indexOf(szNorm(s.trQ))>=0).map(x=>`<div data-sz="tr:${e(x)}" class="szx-do">${e(x)}</div>`).join("")}</div>`:""}</div></div>
   ${s.consult?`<div class="szx-consult" data-sz="say"><div class="szx-ch"><span class="szx-live"></span> Консультация с «${e(s.trPick)}» · клиент на удержании и вас не слышит</div><div class="szx-bubble"><small>Вы говорите менеджеру:</small>${e(c.say)}</div></div>`:""}
   </div><div class="szx-mf"><span class="szx-btn gray">Отменить</span><span class="szx-btn gray${s.consult?" dim":""}" data-sz="tr-consult">Консультация</span><span class="szx-btn green" data-sz="tr-go">Перевести</span></div></div>`;
  body=`<div class="szx-work">
   <aside class="szx-left" data-sz="left">
    <div class="szx-head" data-sz="call-head">${head}<div class="szx-vol"><span>🔈</span><i></i></div><div class="szx-cst">${szCallText(s,sec)}</div></div>
    <div class="szx-btns" data-sz="call-btns">${btns}</div>
    <div class="szx-hear">Не слышно клиента?</div>
    <div class="szx-ctab">${s.client?"📞 "+SZ_PHONE:"Контакт"}</div>
    <div class="szx-form">
     <div class="szx-row"><label>Название</label><div class="szx-in tall">${s.client?SZ_PHONE:""}</div></div>
     <div class="szx-row"><label>Телефоны</label><div class="szx-in">${s.client?SZ_PHONE:""}</div></div>
     <div class="szx-row"><label>Ответственный</label><div class="szx-in sel">Оператор</div></div>
     <div data-sz="fields" class="szx-fields">${fields}</div>
    </div>
    <div class="szx-foot"><span class="szx-btn gray">Добавить контакт</span><span class="szx-btn gray" data-sz="btn-task">Добавить задачу</span><span class="szx-kebab">⋮</span></div>
   </aside>
   <section class="szx-right">
    <div class="szx-tabs"><b>Сценарий</b><span>Анкеты</span><span>История</span><span>Задачи</span><span>+</span><em>×</em></div>
    <div class="szx-script" data-sz="script"><div class="szx-in sel script">${e(c.scriptName)}</div>${script}</div>
    ${res}
    <div class="szx-note"><div class="szx-ta" data-sz="note">${s.note?e(s.note):'<span class="ph">Запишите комментарий голосом, используя иконку микрофона, или введите текст</span>'}</div>
     <span class="szx-btn green big" data-sz="save">Сохранить <small>▾</small></span></div>
   </section>
   ${modal?`<div class="szx-veil">${modal}</div>`:""}
  </div>`;
 }
 return `<div class="szx">${top}${body}${s.toast?`<div class="szx-toast">✓ ${e(s.toast)}</div>`:""}</div>`;
}

/* --- плавная перерисовка: меняем только то, что изменилось ---
   Узлы сопоставляются по позиции и data-sz. Совпавшие обновляются на месте
   (текст, классы), поэтому анимации появления окон не перезапускаются. */
function szMorph(from,to){
 for(const a of [...from.attributes])if(!to.hasAttribute(a.name))from.removeAttribute(a.name);
 for(const a of [...to.attributes])if(from.getAttribute(a.name)!==a.value)from.setAttribute(a.name,a.value);
 const fc=[...from.childNodes],tc=[...to.childNodes];
 for(let i=0;i<tc.length;i++){
  const f=fc[i],t=tc[i];
  if(!f){from.appendChild(t);continue;}
  const same=f.nodeType===t.nodeType&&f.nodeName===t.nodeName&&
   (f.nodeType!==1||(f.getAttribute("data-sz")===t.getAttribute("data-sz")&&szKey(f)===szKey(t)));
  if(!same){from.replaceChild(t,f);continue;}
  if(f.nodeType===3||f.nodeType===8){if(f.nodeValue!==t.nodeValue)f.nodeValue=t.nodeValue;continue;}
  szMorph(f,t);
 }
 for(let i=fc.length-1;i>=tc.length;i--)from.removeChild(fc[i]);
}
/* первый класс — «тип» блока: окно задачи и окно перевода не сливаются в одно */
function szKey(el){return (el.getAttribute("class")||"").split(" ")[0];}

/* --- плеер --- */
const SZMEM={};
const SZ_DONE="sz-done";
function szDoneList(){try{const v=JSON.parse(localStorage.getItem(SZ_DONE)||"[]");return Array.isArray(v)?v:[];}catch(e){return [];}}
function szMarkDone(k){const d=szDoneList();if(d.indexOf(k)>=0)return;d.push(k);try{localStorage.setItem(SZ_DONE,JSON.stringify(d));}catch(e){}}
const SZ_CURSOR='<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5v17.2l4.3-4.1 2.8 6.4 3-1.3-2.8-6.3h6z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';

/**
 * Создаёт плеер в root.
 * opts.track    — "realty" | "auto"
 * opts.statuses — [{g,n}] результаты звонка направления
 * opts.chapBar  — показывать ли ряд глав над экраном (по умолчанию да)
 * opts.reserve  — сколько пикселей высоты окна оставить под остальную страницу
 * opts.onChange — вызывается после каждого перехода (для внешнего меню глав)
 */
function szCreate(root,opts){
 opts=opts||{};
 root.setAttribute("data-szon","1");
 root.classList.add("sz");
 const track=opts.track==="auto"?"auto":"realty";
 const c=SZ_CFG[track],chaps=szChapters(track),statuses=opts.statuses||[];
 const reserve=opts.reserve==null?260:opts.reserve;
 /* классы кнопок страницы-хозяина: в академии .bt, в CRM .btn */
 const B=Object.assign({bt:"bt",pri:"pri",sm:"sm",out:"out",seg:"sz-seg"},opts.btn||{});
 const mem=SZMEM[track]||(SZMEM[track]={ci:0,idx:-1,mode:"watch",speed:1});
 let isFull=false,playing=false,busy=false,miss=0,shown=null,sec=0,lastCall="",run=0,scale=.7,drag=null;
 root.innerHTML=`${opts.chapBar===false?"":`<div class="sz-chaps"></div>`}
  <div class="sz-host"><div class="sz-stage"></div><div class="sz-spot"></div><div class="sz-tip"></div>
   <div class="sz-cursor"><span class="sz-ripple"></span>${SZ_CURSOR}</div><div class="sz-over"></div></div>
  <div class="sz-cap">
   <div class="sz-tl" title="Перемотка: нажмите или потяните мышкой"><div class="sz-tlsegs"></div><div class="sz-tlknob"></div><div class="sz-tlhint"></div></div>
   <div class="sz-text"></div><div class="sz-ctl"></div></div>`;
 root.tabIndex=0;
 const $=q=>root.querySelector(q);
 const host=$(".sz-host"),stage=$(".sz-stage"),spot=$(".sz-spot"),tip=$(".sz-tip"),cur=$(".sz-cursor"),over=$(".sz-over"),tl=$(".sz-tl"),cap=$(".sz-cap");
 const alive=()=>document.body.contains(root);
 const ch=()=>chaps[mem.ci],n=()=>ch().steps.length;
 const step=()=>mem.idx>=0&&mem.idx<n()?ch().steps[mem.idx]:null;
 const wait=ms=>new Promise(r=>setTimeout(r,ms/mem.speed));
 const api={track:track,chapters:chaps,get ci(){return mem.ci;},get idx(){return mem.idx;},get mode(){return mem.mode;},
  done:szDoneList,open:ci=>{mem.ci=ci;playing=false;setStep(-1);},start:m=>start(m)};

 function fit(){
  const full=isFull;
  root.classList.toggle("full",full);
  let w;
  if(full){
   /* во весь экран: экран и панель шага одной ширины, по центру */
   scale=Math.max(.3,Math.min((window.innerWidth-48)/SZW,(window.innerHeight-250)/SZH));
   w=SZW*scale;host.style.width=w+"px";cap.style.width=w+"px";
  }else{
   host.style.width="";cap.style.width="";
   w=host.clientWidth||SZW*.7;
   /* весь плеер — экран и панель шага — должен помещаться в окно */
   scale=Math.max(.3,Math.min(w/SZW,(window.innerHeight-reserve)/SZH,1.15));
  }
  host.style.height=SZH*scale+"px";
  stage.style.transform=`scale(${scale})`;
  stage.style.left=Math.max(0,(w-SZW*scale)/2)+"px";
  place();
 }
 function locate(at){
  if(!at)return null;
  const el=[...stage.querySelectorAll("[data-sz]")].find(x=>x.getAttribute("data-sz")===at);
  if(!el)return null;
  const r=el.getBoundingClientRect(),h=host.getBoundingClientRect();
  return {x:r.left-h.left,y:r.top-h.top,w:r.width,h:r.height,el:el};
 }
 function paint(s){
  shown=s;
  if(s.call!==lastCall){lastCall=s.call;sec=s.call==="talk"?15:s.call==="ended"?66:0;}
  const t=document.createElement("div");t.innerHTML=szScreen(s,c,sec,statuses);
  const next=t.firstElementChild;
  if(stage.firstElementChild)szMorph(stage.firstElementChild,next);else stage.appendChild(next);
  place();
 }
 /* подсветка цели и подсказка рядом с ней */
 function place(){
  const st=step(),a=st?szAct(st):"look",b=st?locate(st.at):null;
  if(st&&b){
   spot.style.display="block";
   spot.style.left=b.x-6+"px";spot.style.top=b.y-6+"px";spot.style.width=b.w+12+"px";spot.style.height=b.h+12+"px";
   spot.classList.toggle("look",a==="look");
  }else spot.style.display="none";
  if(st){
   const hw=host.clientWidth,hh=host.clientHeight;
   const html=`<span class="k">${mem.idx+1}/${n()}</span><span>${szEsc(st.t)}</span>`+
    (mem.mode==="try"&&a!=="look"?`<em>${a==="type"?"Нажмите на поле — текст впишется сам":"Нажмите сюда"}</em>`:"");
   if(tip.innerHTML!==html)tip.innerHTML=html;
   tip.style.display="flex";
   if(b){
    const below=b.y+b.h/2<hh*.58&&b.y+b.h+130<hh;
    tip.className="sz-tip "+(below?"below":"above");
    tip.style.left=Math.min(Math.max(8,b.x+b.w/2-150),hw-308)+"px";
    tip.style.top=below?(b.y+b.h+14)+"px":"auto";
    tip.style.bottom=below?"auto":(hh-b.y+14)+"px";
   }else{tip.className="sz-tip free";tip.style.left="";tip.style.top="";tip.style.bottom="";}
  }else tip.style.display="none";
  cur.style.display=mem.mode==="watch"&&st?"block":"none";
  host.classList.toggle("try",mem.mode==="try"&&!!st&&a!=="look");
 }
 function drawChaps(){
  const bar=$(".sz-chaps");if(!bar)return;
  const done=szDoneList();
  bar.innerHTML=chaps.map((x,i)=>{const ok=done.indexOf(track+":"+x.id+":try")>=0;
   return `<button class="sz-chap${i===mem.ci?" on":""}${ok?" ok":""}" data-szc="chap" data-i="${i}"><span class="n">${ok?"✓":i+1}</span>${szEsc(x.t)}</button>`;}).join("");
 }
 function drawOver(){
  const x=ch();
  if(mem.idx<0){
   over.style.display="grid";
   over.innerHTML=`<div class="sz-card"><div class="sz-eb">Глава ${mem.ci+1} из ${chaps.length}</div><h3>${szEsc(x.t)}</h3>
    <div class="sz-learn">Вы узнаете</div><ul>${x.learn.map(l=>`<li>${szEsc(l)}</li>`).join("")}</ul>
    <div class="sz-acts"><button class="${B.bt} ${B.pri}" data-szc="start" data-m="watch">▶ Смотреть, как это делается</button><button class="${B.bt} ${B.out}" data-szc="start" data-m="try">Пройти самому</button></div>
    <p class="sz-how">«Смотреть» — программа сама покажет курсором, куда нажимать, и объяснит каждый шаг. «Пройти самому» — нажимаете вы, а нужное место подсвечено. Полосу под экраном можно перематывать мышкой.</p></div>`;
  }else if(mem.idx>=n()){
   const last=mem.ci>=chaps.length-1;
   over.style.display="grid";
   over.innerHTML=`<div class="sz-card"><div class="sz-eb ok">✓ Глава пройдена</div><h3>${szEsc(x.t)}</h3>
    <div class="sz-learn">Запомните</div><ul class="sum">${x.sum.map(l=>`<li>${szEsc(l)}</li>`).join("")}</ul>
    <div class="sz-acts">${mem.mode==="watch"?`<button class="${B.bt} ${B.pri}" data-szc="start" data-m="try">Теперь пройти самому</button>`
      :last?`<span class="sz-alldone">Все главы пройдены</span>`:`<button class="${B.bt} ${B.pri}" data-szc="chap" data-i="${mem.ci+1}">Дальше: ${szEsc(chaps[mem.ci+1].t)} →</button>`}
     <button class="${B.bt}" data-szc="start" data-m="${mem.mode}">↻ Ещё раз</button>
     ${mem.mode==="watch"&&!last?`<button class="${B.bt}" data-szc="chap" data-i="${mem.ci+1}">Следующая глава →</button>`:""}</div></div>`;
  }else{over.style.display="none";over.innerHTML="";}
 }
 function drawTl(){
  const N=n(),i=mem.idx;
  const segs=$(".sz-tlsegs");
  if(segs.children.length!==N)segs.innerHTML=ch().steps.map(()=>"<i></i>").join("");
  [...segs.children].forEach((el,k)=>{el.className=k<i?"past":k===i?"cur":"";});
  const knob=$(".sz-tlknob");
  knob.style.display=i<0?"none":"block";
  knob.style.left=(i>=N?100:(i+.5)/N*100)+"%";
 }
 function drawCap(){
  const st=step(),a=st?szAct(st):"look";
  drawTl();
  $(".sz-text").innerHTML=st
   ?`<div class="sz-step">${mem.mode==="try"?"Пройти самому":"Смотрим"} · шаг ${mem.idx+1} из ${n()}</div><b>${szEsc(st.t)}</b>${st.d?`<p>${szEsc(st.d)}</p>`:""}
     ${mem.mode==="try"&&miss>0&&a!=="look"?`<p class="sz-miss">Не сюда. Нажмите на место в жёлтой рамке.</p>`:""}`
   :`<div class="sz-step">Глава ${mem.ci+1} из ${chaps.length}</div><b>${mem.idx<0?"Выберите, как проходить главу":"Глава пройдена"}</b>`;
  const full=isFull;
  /* набор и ширина кнопок не зависят от режима и шага — панель не прыгает */
 const mainBtn=mem.mode==="watch"
  ?`<button class="${B.bt} ${B.sm} ${B.pri} sz-main" data-szc="play" title="Пробел">${playing?"❚❚ Пауза":"▶ Смотреть"}</button>`
  :(st&&a==="look"?`<button class="${B.bt} ${B.sm} ${B.pri} sz-main" data-szc="look">Понятно, дальше →</button>`
   :`<span class="${B.bt} ${B.sm} sz-main sz-hint">${st?"Нажмите на экране":"—"}</span>`);
 $(".sz-ctl").innerHTML=`<button class="${B.bt} ${B.sm}" data-szc="prev" title="Предыдущий шаг (←)"${mem.idx<=0?" disabled":""}>←</button>
   ${mainBtn}
   <button class="${B.bt} ${B.sm}" data-szc="next" title="Следующий шаг (→)"${mem.idx<0||mem.idx>=n()?" disabled":""}>→</button>
   <span class="sz-sp"></span>
   <span class="${B.seg}"><button class="${mem.mode==="watch"?"on":""}" aria-pressed="${mem.mode==="watch"}" data-szc="start" data-m="watch">Смотреть</button><button class="${mem.mode==="try"?"on":""}" aria-pressed="${mem.mode==="try"}" data-szc="start" data-m="try">Пройти самому</button></span>
   <button class="${B.bt} ${B.sm} sz-speed" data-szc="speed" title="Скорость показа"${mem.mode==="watch"?"":" disabled"}>${String(mem.speed).replace(".",",")}×</button>
   <button class="${B.bt} ${B.sm}" data-szc="full">${full?"Свернуть":"На весь экран"}</button>`;
 }
 function drawAll(){drawChaps();drawOver();drawCap();place();if(opts.onChange)opts.onChange(api);}

 /* переход на шаг: экран — состояние до действия этого шага */
 function setStep(i){
  run++;busy=false;miss=0;
  mem.idx=i;
  paint(szStateAt(ch(),Math.max(0,i)));
  if(i>=n()){playing=false;szMarkDone(track+":"+ch().id+":"+mem.mode);}
  drawAll();
  if(mem.mode==="watch"&&playing&&step())watch();
 }
 async function watch(){
  const my=++run,st=step(),a=szAct(st),base=szStateAt(ch(),mem.idx);
  const ok=()=>my===run&&alive();
  await wait(150);if(!ok())return;
  const b=locate(st.at);
  if(b)cur.style.transform=`translate(${b.x+b.w/2}px,${b.y+b.h/2}px)`;
  await wait(szRead(st));if(!ok())return;
  if(a!=="look"){pressFx();await wait(320);if(!ok())return;}
  if(a==="type"&&st.text&&st.set){
   for(let k=1;k<=st.text.length;k++){paint(st.set(base,st.text.slice(0,k)));await wait(70);if(!ok())return;}
  }
  paint(szStateAt(ch(),mem.idx+1));
  await wait(a==="look"?250:1400);if(!ok())return;
  setStep(mem.idx+1);
 }
 function pressFx(){const r=cur.querySelector(".sz-ripple");r.classList.remove("on");void r.offsetWidth;r.classList.add("on");}
 /* «Пройти самому»: правильное нажатие */
 async function advance(){
  const st=step();if(!st||busy)return;
  busy=true;const my=run,base=szStateAt(ch(),mem.idx);
  if(szAct(st)==="type"&&st.text&&st.set){
   spot.classList.add("typing");
   for(let k=1;k<=st.text.length;k++){paint(st.set(base,st.text.slice(0,k)));await new Promise(r=>setTimeout(r,45));if(my!==run||!alive())return;}
   spot.classList.remove("typing");
  }
  paint(szStateAt(ch(),mem.idx+1));spot.style.display="none";tip.style.display="none";
  await new Promise(r=>setTimeout(r,szAct(st)==="look"?0:800));
  if(my===run&&alive())setStep(mem.idx+1);
 }
 /* «На весь экран» — плеер разворачивается поверх страницы (работает в любом браузере) */
 function setFull(v){isFull=v;document.documentElement.style.overflow=v?"hidden":"";fit();drawCap();root.focus({preventScroll:true});}
 function start(m){mem.mode=m;playing=m==="watch";setStep(0);}
 function togglePlay(){if(mem.mode!=="watch")return;if(mem.idx<0||mem.idx>=n()){start("watch");return;}playing=!playing;if(playing)watch();else run++;drawCap();}

 /* перемотка мышкой: клик, перетаскивание и колесо по полосе шагов */
 const tlIndex=x=>{const r=tl.getBoundingClientRect();return Math.max(0,Math.min(n()-1,Math.floor((x-r.left)/r.width*n())));};
 function hint(x){
  const i=tlIndex(x),h=$(".sz-tlhint"),r=tl.getBoundingClientRect();
  h.textContent=`Шаг ${i+1}: ${ch().steps[i].t}`;
  h.style.display="block";
  h.style.left=Math.max(0,Math.min(r.width-h.offsetWidth,x-r.left-h.offsetWidth/2))+"px";
 }
 function seek(x){const i=tlIndex(x);if(i!==mem.idx)setStep(i);}
 tl.addEventListener("pointerdown",e=>{
  e.preventDefault();
  drag={was:playing};playing=false;run++;
  tl.setPointerCapture(e.pointerId);tl.classList.add("drag");
  seek(e.clientX);hint(e.clientX);
 });
 tl.addEventListener("pointermove",e=>{hint(e.clientX);if(drag)seek(e.clientX);});
 const endDrag=()=>{if(!drag)return;const was=drag.was;drag=null;tl.classList.remove("drag");
  if(was&&mem.mode==="watch"&&step()){playing=true;watch();}drawCap();};
 tl.addEventListener("pointerup",endDrag);
 tl.addEventListener("pointercancel",endDrag);
 tl.addEventListener("pointerleave",()=>{if(!drag)$(".sz-tlhint").style.display="none";});
 tl.addEventListener("wheel",e=>{e.preventDefault();playing=false;setStep(Math.max(0,Math.min(n()-1,mem.idx+(e.deltaY>0?1:-1))));},{passive:false});

 root.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&isFull){e.preventDefault();e.stopPropagation();setFull(false);return;}
  if(e.target!==root)return;
  if(e.key==="ArrowRight"){e.preventDefault();e.stopPropagation();playing=false;setStep(Math.min(n(),mem.idx+1));}
  else if(e.key==="ArrowLeft"){e.preventDefault();e.stopPropagation();playing=false;setStep(Math.max(0,mem.idx-1));}
  else if(e.key===" "){e.preventDefault();e.stopPropagation();togglePlay();}
 });
 root.addEventListener("click",e=>{
  e.stopPropagation();
  const b=e.target.closest("[data-szc]");
  if(b){
   const k=b.getAttribute("data-szc");
   if(k==="chap")api.open(+b.getAttribute("data-i"));
   else if(k==="start")start(b.getAttribute("data-m"));
   else if(k==="prev"){playing=false;setStep(Math.max(0,mem.idx-1));}
   else if(k==="next"){playing=false;setStep(Math.min(n(),mem.idx+1));}
   else if(k==="play")togglePlay();
   else if(k==="look")advance();
   else if(k==="speed"){mem.speed=mem.speed===1?1.5:mem.speed===1.5?.75:1;drawCap();}
   else if(k==="full")setFull(!isFull);
   root.focus({preventScroll:true});
   return;
  }
  if(!stage.contains(e.target))return;
  const st=step();
  if(mem.mode!=="try"||!st||busy||szAct(st)==="look")return;
  const t=locate(st.at);
  if(t&&t.el.contains(e.target))advance();
  else{miss++;spot.classList.remove("shake");void spot.offsetWidth;spot.classList.add("shake");drawCap();}
 });
 /* таймер разговора */
 const tick=setInterval(()=>{
  if(!alive()){clearInterval(tick);return;}
  if(shown&&shown.call==="talk"){sec++;const el=stage.querySelector(".szx-cst");if(el)el.textContent=szCallText(shown,sec);}
 },1000);
 if(window.ResizeObserver)new ResizeObserver(()=>{if(alive())fit();}).observe(host);
 /* масштаб зависит и от высоты окна — её ResizeObserver колонки не видит */
 const onWin=()=>{if(alive())fit();else window.removeEventListener("resize",onWin);};
 __on(window,"resize",onWin);
 if(document.fonts&&document.fonts.ready)document.fonts.ready.then(onWin);
 __on(document,"keydown",e=>{if(e.key==="Escape"&&isFull&&alive())setFull(false);});
 paint(szStateAt(ch(),Math.max(0,Math.min(mem.idx,n()))));
 drawAll();fit();
 cur.style.transform=`translate(${host.clientWidth*.4}px,${SZH*scale*.5}px)`;
 return api;
}


/* ════════════════ «Обучение оператора · Авто» ════════════════
   Структура — как в «Академии обзвона» (материал в центре, справа «Для этого
   звонка» и «Полезное рядом», режим «Только реплики» у скрипта, заметки, поиск),
   оформление — как в CRM. Прогресс — в CRM. */
const esc=szEsc,norm=szNorm;
const ic=(n,s,w)=>`<svg width="${s||16}" height="${s||16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w||1.75}" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="${IC[n]||n}"/></svg>`;
const rub=n=>Number(n).toLocaleString("ru-RU")+" ₽";
const plural=(n,a,b,c)=>{const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<10||h>=20)?b:c;};
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const scroller=()=>document.getElementById("app-scroll");

/* ── курс ── */
const COURSE=DATA.course;
const SIM={id:"sim",t:"Тренажёр Скорозвона: смена, звонок, результат, перевод",k:"Симулятор",m:"15 мин"};
{const m=COURSE.modules.find(x=>/Скорозвон/.test(x.t));if(m&&!m.items.some(i=>i.id==="sim"))m.items.unshift(SIM);}
COURSE.modules.forEach(m=>{m.t=m.t.replace(/^Модуль \d+\.\s*/,"");});
const byId={},modOf={},FLAT=[];
COURSE.modules.forEach((m,mi)=>m.items.forEach(it=>{byId[it.id]=it;modOf[it.id]=mi;FLAT.push(it);}));
DATA.pay.modules.forEach(m=>m.items.forEach(it=>{byId[it.id]=it;}));
const KIND_IC={"Урок":"doc","Скрипт":"chat","Регламент":"list","Чек-лист":"clip","Справочник":"book","Тест":"test","Тренажёр":"bolt","Калькулятор":"calc","Симулятор":"playc"};
const isScript=it=>!it.quiz&&!it.w&&(it.b||[]).filter(b=>b.s||b.d).length>=2;

/* ── прогресс ── */
const fresh=()=>({done:{},quiz:{},qs:{},checks:{},notes:{},seen:[],run:true});
const UIKEY="acad-ui:"+(opts.accountId||"local");
/* чек-лист хранится в записи своего материала, как в прежней академии: "id-списка:номер" */
const CKITEM={};Object.values(byId).forEach(it=>(it.b||[]).forEach(b=>{if(b.ck)CKITEM[b.ck.id]=it.id;}));
function loadP(){
 const p=fresh();
 try{const u=JSON.parse(localStorage.getItem(UIKEY)||"{}");if(u.qs)p.qs=u.qs;if(u.seen)p.seen=u.seen;if(u.run!=null)p.run=u.run;}catch(e){}
 (opts.records?opts.records():[]).forEach(r=>{
  const it=byId[r.itemId];
  if(it&&it.quiz){if(r.best!=null||r.pass)p.quiz[r.itemId]={best:r.best||0,tries:r.tries||0,pass:!!r.pass};}
  else if(r.done)p.done[r.itemId]=true;
  (r.checks||[]).forEach(k=>{const i=k.lastIndexOf(":");if(i<0)return;const ck=k.slice(0,i);(p.checks[ck]=p.checks[ck]||{})[k.slice(i+1)]=true;});
  if(r.note)p.notes[r.itemId]=r.note;
 });
 return p;
}
let P=loadP();
const save=()=>{try{localStorage.setItem(UIKEY,JSON.stringify({qs:P.qs,seen:P.seen,run:P.run}));}catch(e){}};
const persist=(id,patch)=>{if(opts.save)opts.save(id,patch);};
const persistChecks=ck=>{const m=P.checks[ck]||{};persist(CKITEM[ck]||ck,{checks:Object.keys(m).filter(i=>m[i]).map(i=>ck+":"+i)});};
let noteT=0;
const simDone=()=>{const d=szDoneList();return szChapters("auto").filter(c=>d.indexOf("auto:"+c.id+":try")>=0).length;};
const isDone=id=>id==="sim"?(!!P.done.sim||simDone()===5):byId[id]&&byId[id].quiz?!!(P.quiz[id]&&P.quiz[id].pass):!!P.done[id];
const blocker=id=>{const i=FLAT.findIndex(x=>x.id===id);for(let k=0;k<i;k++)if(!isDone(FLAT[k].id))return FLAT[k];return null;};
const nextUp=()=>FLAT.find(x=>!isDone(x.id))||null;
const doneCount=()=>FLAT.filter(x=>isDone(x.id)).length;
const tests=()=>FLAT.filter(x=>x.quiz);
const markSeen=id=>{P.seen=[id].concat((P.seen||[]).filter(x=>x!==id)).slice(0,6);save();};

/* ── разделы: «во время звонка» и справочники ── */
const TABNAME={a31:"Скрипт без подбора",a32:"Перевод и если не получилось",r51:"Как считается смена",r52:"Калькулятор смены",r53:"Стажировка",a41:"Самозанятость"};
const SEC={
 script:{t:"Скрипт звонка",s:"Скрипт «Авто.ру — без подбора» и перевод клиента. Держите открытым во время смены.",items:["a31","a32"]},
 checklist:{t:"Чек-лист звонка",s:"Пройдитесь по пунктам после разговора — так видно, что пропустили.",items:["auto-check"]},
 objections:{t:"Возражения",s:"Готовые ответы на частые возражения клиента на автотеме.",w:"obj-auto"},
 statuses:{t:"Статусы",s:"Какой результат ставить после разговора. От статуса зависят перезаливы базы и ваша конверсия.",w:"st-auto"},
 prices:{t:"Цены по маркам",s:"Стартовые цены по марке — ориентир для разговора, а не цена конкретной модели.",items:["a12"],w:"auto-prices"},
 cities:{t:"Города и расстояния",s:"Сколько ехать клиенту до ближайшего дилерского центра.",w:"auto-cities"},
 terms:{t:"Кузов и привод",s:"Кузов, комплектация и привод — простыми словами.",items:["auto-terms"]},
 gloss:{t:"Глоссарий",s:"Слова по автотеме и внутренние термины группы.",w:"gloss"},
 pay:{t:"Оплата и оформление",s:"Как считается смена, стажировка и документы.",items:["r51","r52","r53","a41"]},
 "tr-obj":{t:"Тренажёр возражений",s:"Прочитайте возражение, ответьте вслух, затем сравните с эталоном.",w:"tr-auto",noAside:1},
 "tr-st":{t:"Тренажёр статусов",s:"Ситуация из звонка — выберите, какой статус поставить.",w:"tr-st",noAside:1}};

/* ── меню ── */
const NAV=[
 {g:"Обучение",items:[
  {r:"home",t:"Главная",i:"home"},
  {r:"course",t:"Курс «Авто»",i:"cap",count:()=>doneCount()+"/"+FLAT.length},
  {r:"sim",t:"Скорозвон",i:"phone",count:()=>simDone()+"/5"},
  {r:"tests",t:"Тесты",i:"test",count:()=>tests().filter(x=>isDone(x.id)).length+"/"+tests().length},
  {r:"progress",t:"Мой прогресс",i:"target"}]},
 {g:"Во время звонка",items:[
  {r:"script",t:"Скрипт звонка",i:"chat"},
  {r:"objections",t:"Возражения",i:"target"},
  {r:"statuses",t:"Статусы",i:"list"},
  {r:"checklist",t:"Чек-лист звонка",i:"clip"}]},
 {g:"Справочники",items:[
  {r:"prices",t:"Цены по маркам",i:"car"},
  {r:"cities",t:"Города и расстояния",i:"pin"},
  {r:"terms",t:"Кузов и привод",i:"book"},
  {r:"gloss",t:"Глоссарий",i:"book"},
  {r:"pay",t:"Оплата и оформление",i:"wallet"}]},
 {g:"Тренажёры",items:[
  {r:"tr-obj",t:"Возражения",i:"bolt"},
  {r:"tr-st",t:"Статусы",i:"bolt"}]},
 {g:"Личное",items:[{r:"notes",t:"Мои заметки",i:"note",count:()=>{const n=Object.values(P.notes||{}).filter(x=>x&&x.trim()).length;return n?String(n):"";}}]}];
const TITLE={};NAV.forEach(g=>g.items.forEach(n=>{TITLE[n.r]=n.t;}));TITLE.sim="Тренажёр Скорозвона";TITLE.help="Как пользоваться";

/* ── правая колонка (как в академии) ── */
const ASIDE={
 call:[{t:"Скрипт Авто.ру",s:"Девять вопросов без подбора",d:"item:a31",i:"chat"},
       {t:"Статусы",s:"Коды автотемы",d:"st-auto",i:"list"},
       {t:"Возражения",s:"Ответы по автотеме",d:"obj-auto",i:"target"}],
 near:[{t:"Цены по маркам",s:"41 марка, стартовые цены",d:"auto-prices",i:"car"},
       {t:"Города и расстояния",s:"До ДЦ Москвы и СПб",d:"auto-cities",i:"pin"},
       {t:"Кузов и привод",s:"Термины простыми словами",d:"item:auto-terms",i:"book"},
       {t:"Глоссарий",s:"Кроссовер, привод, трейд-ин",d:"gloss",i:"book"},
       {t:"Чек-лист звонка",s:"Проверка перед переводом",d:"item:auto-check",i:"clip"}]};
const DRAWERS={
 "st-auto":{t:"Статусы — Авто",s:"Что ставить после разговора",go:"statuses"},
 "obj-auto":{t:"Возражения — Авто",s:"Готовые ответы клиенту",go:"objections"},
 "auto-prices":{t:"Цены по маркам",s:"Стартовые цены — ориентир для разговора",go:"prices"},
 "auto-cities":{t:"Города и расстояния",s:"До дилерских центров Москвы и СПб",go:"cities"},
 "gloss":{t:"Глоссарий",s:"Авто и внутренние слова",go:"gloss"}};
function asideHTML(curId){
 const row=(r,plain)=>`<button class="arow${plain?" plain":""}" data-drawer="${r.d}"><span class="ai">${ic(r.i,plain?17:16)}</span><span class="at"><b>${esc(r.t)}</b><span>${esc(r.s)}</span></span>${plain?"":`<span class="ac">${ic("chevR",14)}</span>`}</button>`;
 let mod="";
 if(curId&&modOf[curId]!=null){const mi=modOf[curId],m=COURSE.modules[mi];
  mod=`<div class="card acard"><h3>Модуль ${mi+1}. ${esc(m.t)}</h3><p>${m.items.filter(x=>isDone(x.id)).length} из ${m.items.length} пройдено · <a href="#/course/${mi}" style="color:var(--text-sub)">весь курс</a></p>
  <div class="mtree">${m.items.map((x,k)=>{const dn=isDone(x.id),lk=!dn&&blocker(x.id)&&x.id!==curId;
   return `<a class="mt${x.id===curId?" on":""}${dn?" done":""}${lk?" lock":""}" href="#/item/${x.id}"><span class="s">${ic(dn?"checkc":x.id===curId?"playc":lk?"lock":"circle",15)}</span><span>${mi+1}.${k+1} ${esc(x.t)}</span></a>`;}).join("")}</div></div>`;}
 const n=doneCount(),N=FLAT.length,p=Math.round(n/N*100);
 return `${mod}
 <div class="card acard"><h3>Для этого звонка</h3><p>Открывается поверх страницы — вы не теряете место</p>${ASIDE.call.map(r=>row(r)).join("")}</div>
 <div class="card acard"><h3>Полезное рядом</h3><div style="height:6px"></div>${ASIDE.near.map(r=>row(r,true)).join("")}</div>
 <a class="card agreen" href="#/progress" style="text-decoration:none"><span class="gi">${ic("target",20)}</span><div><b>${p>=100?"Курс пройден":p?"Прогресс "+p+"%":"Начните с первого урока"}</b><span>${p>=100?"Возвращайтесь к справочникам во время смены.":`Пройдено ${n} из ${N} материалов курса «Авто».`}</span></div></a>`;
}
/* страница с правой колонкой */
const lay=(main,curId,noAside)=>noAside?`<div class="lay wide"><div class="mainc">${main}</div></div>`:`<div class="lay"><div class="mainc">${main}</div><aside class="aside">${asideHTML(curId)}</aside></div>`;
const qbtn=`<button class="btn btn-sm qbtn" data-drawer="__aside">${ic("list",13)} Быстрый доступ</button>`;

/* ── роутер ── */
function route(){const p=(location.hash||"#/home").slice(2).split("/");return {r:p[0]||"home",id:p[1]!=null?decodeURIComponent(p[1]):null};}
let W={},DW={},DRW={open:false,key:""},RUNOPEN={},PAGEW=null;
__on(window,"hashchange",()=>{W={};closeDrawer(true);render();scroller().scrollTo(0,0);});

/* меню обучения рисует CRM (components/app/LearnRail) — сообщаем, что прогресс изменился */
function renderNav(){window.dispatchEvent(new CustomEvent("academy:change"));}

/* ── общие куски ── */
const head=(title,sub,tools)=>`<div class="page-head"><div style="min-width:0"><h1 class="page-title">${title}</h1>${sub?`<p class="page-sub">${sub}</p>`:""}</div><div class="toolbar">${tools||""}${qbtn}</div></div>`;
const chip=(t,st)=>`<span class="chip"${st?` style="${st}"`:""}>${t}</span>`;
const bar=v=>`<div class="bar-track" style="height:6px"><div class="bar-fill" style="width:${Math.max(0,Math.min(1,v))*100}%"></div></div>`;
const mark=(t,q)=>{const s=esc(t);if(!q)return s;const p=norm(s).indexOf(norm(q));if(p<0)return s;return s.slice(0,p)+'<span class="hl">'+s.slice(p,p+q.length)+"</span>"+s.slice(p+q.length);};
function note(k,t,b){const cls={tip:"tip",warn:"amber",err:"err",ok:"ok"}[k]||"";const i=k==="ok"?"check":k==="warn"||k==="err"?"alert":"info";
 return `<div class="note-line ${cls}">${ic(i,15)}<div>${t?`<span class="nt">${esc(t)}</span>`:""}${esc(b)}</div></div>`;}
function block(b){
 if(b.p)return `<p${b.first?' class="lead"':""}>${esc(b.p)}</p>`;
 if(b.h)return `<h2>${esc(b.h)}</h2>`;
 if(b.ul)return `<ul>${b.ul.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`;
 if(b.ol)return `<ol>${b.ol.map(x=>`<li>${esc(x)}</li>`).join("")}</ol>`;
 if(b.tb)return `<div class="tblwrap"><table class="tbl"><thead><tr>${b.tb.h.map(x=>`<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${b.tb.r.map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
 if(b.n)return note(b.n.k,b.n.t,b.n.b);
 if(b.s)return `<div class="say"><div class="sh">${ic("chat",14)}${esc(b.s.l||"Говорим клиенту")}${b.s.t?`<span class="tm">${esc(b.s.t)}</span>`:""}</div><div class="sb">${esc(b.s.b)}</div></div>`;
 if(b.d)return `<div class="say"><div class="sh">${ic("chat",14)}Пример диалога</div><div class="dlg">${b.d.map(x=>`<span class="who ${x[0]==="op"?"op":""}">${x[0]==="op"?"Оператор":"Клиент"}</span><span>«${esc(x[1])}»</span>`).join("")}</div></div>`;
 if(b.ck){const st=P.checks[b.ck.id]||{},dn=b.ck.items.filter((_,i)=>st[i]).length;
  return `<div class="cklist">${b.ck.items.map((x,i)=>`<button class="ckrow${st[i]?" on":""}" data-ck="${b.ck.id}" data-i="${i}"><span class="bx">${ic("check",12,3)}</span><span class="tx">${esc(x)}</span></button>`).join("")}</div>
  <div class="ckfoot"><span>Отмечено <b>${dn}</b> из ${b.ck.items.length}</span>${bar(dn/b.ck.items.length)}<button class="btn btn-sm" data-ckreset="${b.ck.id}"${dn?"":" disabled"}>Снять отметки</button></div>`;}
 return "";
}
const dataNote=src=>`<div class="note-line" style="margin-top:12px">${ic("clock",15)}<div><span class="nt">Данные: сентябрь 2026 · ${esc(src)}</span>Цены и наличие меняются: если клиент спорит с цифрой или её нет в таблице, не спорьте — уточните у супервайзера.</div></div>`;

/* ── скрипт: «Только реплики» и шаги ── */
function splitSteps(it){const intro=[],steps=[];let cur=null;(it.b||[]).forEach(b=>{if(b.h){cur={h:b.h,c:[]};steps.push(cur);return;}(cur?cur.c:intro).push(b);});return {intro,steps};}
function runCard(title,num,blocks,key){
 const say=blocks.filter(b=>b.s||b.d),flags=blocks.filter(b=>b.n),rest=blocks.filter(b=>!b.s&&!b.d&&!b.n&&!(b.p&&b.first));
 if(!say.length&&!flags.length&&!rest.length)return "";
 const open=!!RUNOPEN[key];
 return `<div class="card rstep"${num?` id="rs${num}"`:""}>
  <div class="rsh">${num?`<span class="n">${num}</span>`:""}<h2>${esc(String(title).replace(/^\s*\d+[.)]\s*/,""))}</h2></div>
  ${say.map(b=>b.s?`<div class="rsline"><div class="rsl"><span>${esc(b.s.l||"Говорим клиенту")}</span>${b.s.t?`<span class="tm">${esc(b.s.t)}</span>`:""}</div><p class="rst">${esc(b.s.b)}</p></div>`
   :`<div class="rsline"><div class="rsl"><span>Пример диалога</span></div><div class="dlg" style="padding:0">${b.d.map(x=>`<span class="who ${x[0]==="op"?"op":""}">${x[0]==="op"?"Оператор":"Клиент"}</span><span>«${esc(x[1])}»</span>`).join("")}</div></div>`).join("")}
  ${flags.length?`<div class="rsflags">${flags.map(b=>`<div class="rsflag ${b.n.k==="err"?"err":""}"><span class="fd"></span><div>${b.n.t?`<b>${esc(b.n.t)}.</b> `:""}${esc(b.n.b)}</div></div>`).join("")}</div>`:""}
  ${rest.length?`<button class="rsmore${open?" open":""}" data-runmore="${esc(key)}">${ic("chevR",14,2)}${open?"Скрыть пояснения":"Пояснения и таблицы — "+rest.length}</button>${open?`<div class="rsdet"><div class="doc">${rest.map(block).join("")}</div></div>`:""}`:""}
 </div>`;
}
function lessonBody(it){
 if(!isScript(it))return it.b?`<div class="card doc">${it.b.map(block).join("")}</div>`:"";
 const run=P.run!==false;
 let h=`<div class="card modebar"><div class="seg"><button aria-pressed="${run}" data-run="1">${ic("chat",14)} Только реплики</button><button aria-pressed="${!run}" data-run="0">${ic("doc",14)} Весь урок</button></div>
  <span class="hint">${run?"Всё, что нужно говорить, идёт одной колонкой. Пояснения свёрнуты внутри шагов.":"Полный разбор: пояснения, таблицы и примеры на своих местах."}</span></div>`;
 if(!run)return h+`<div class="card doc">${it.b.map(block).join("")}</div>`;
 const sp=splitSteps(it),lead=sp.intro.find(b=>b.p&&b.first),rest=sp.intro.filter(b=>b!==lead);
 if(lead)h+=`<p class="lead2">${esc(lead.p)}</p>`;
 if(sp.steps.length>=3)h+=`<div class="card rsnav"><span class="t">ШАГИ</span>${sp.steps.map((s,i)=>`<button data-jump="${i+1}" title="${esc(s.h)}">${i+1}</button>`).join("")}</div>`;
 if(rest.some(b=>b.s||b.d||b.n))h+=runCard(it.t,0,rest,it.id+":0");else if(rest.length)h+=`<div class="card doc" style="margin-bottom:12px">${rest.map(block).join("")}</div>`;
 sp.steps.forEach((s,i)=>{h+=runCard(s.h,i+1,s.c,it.id+":"+(i+1));});
 return h;
}
const notesPanel=id=>`<div class="card notes"><div class="row" style="justify-content:space-between"><h3 class="card-title">${ic("note",14)} Моя заметка к материалу</h3><span class="card-sub" style="margin:0">сохраняется сама</span></div>
 <textarea class="inp" data-note="${id}" placeholder="Формулировка, которая сработала. Вопрос наставнику. Цифра, которую забываете.">${esc((P.notes||{})[id]||"")}</textarea></div>`;

/* ── страницы ── */
const PAGES={};
PAGES.home=()=>{
 const n=doneCount(),N=FLAT.length,nx=nextUp(),fin=FLAT.find(x=>x.final),fq=fin&&P.quiz[fin.id],tDone=tests().filter(x=>isDone(x.id)).length;
 const d=new Date(),days=["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
 const hi=d.getHours()<5?"Доброй ночи":d.getHours()<12?"Доброе утро":d.getHours()<18?"Добрый день":"Добрый вечер";
 const cont=nx?`<div class="card cont"><span class="ci">${ic(KIND_IC[nx.k]||"doc",20)}</span>
   <div class="ct"><div class="ey">${n?"Продолжить обучение":"С чего начать"} · модуль ${modOf[nx.id]+1}</div><h2>${esc(nx.t)}</h2><p>${esc(COURSE.modules[modOf[nx.id]].t)} · ${esc(nx.k)}, ${esc(nx.m)}${nx.id==="sim"?" · программа сама покажет, куда нажимать":""}</p></div>
   <a class="btn btn-primary" href="#/item/${nx.id}" style="height:38px">${n?"Продолжить":"Начать"} ${ic("arrowR",15)}</a></div>`
  :`<div class="card cont"><span class="ci" style="background:var(--c-green-fg)">${ic("check",20,2.4)}</span><div class="ct"><div class="ey">Курс пройден</div><h2>Обучение завершено</h2><p>Возвращайтесь к справочникам во время смены и пересдавайте тесты, когда нужно освежить знания.</p></div><a class="btn" href="#/progress">Мой прогресс</a></div>`;
 const kpi=(l,v,s,i)=>`<div class="card kpi"><div class="kpi-label">${ic(i,13)} ${l}</div><div class="kpi-value">${v}</div><div class="kpi-sub">${s}</div></div>`;
 const lc=(h,i,t,s)=>`<a class="card lcard" href="${h}"><span class="li">${ic(i)}</span><span><b>${t}</b><span>${s}</span></span></a>`;
 const seen=(P.seen||[]).map(id=>byId[id]).filter(Boolean).slice(0,5);
 const sd=simDone();
 return lay(`<div class="dateline"><b>${hi}</b><span>·</span><span>${days[d.getDay()]}, ${d.toLocaleDateString("ru-RU",{day:"numeric",month:"long"})}</span></div>
  ${head("Рабочий стол оператора","Всё для звонка на проекте «Авто.ру»: Скорозвон, продукт, скрипт, возражения и расчёт смены. Слева — обучение по шагам и справочники, справа — то, что нужно прямо в звонке.")}
  ${cont}
  <div class="kpi-grid" style="margin-top:12px">
   ${kpi("Пройдено материалов",`${n} / ${N}`,Math.round(n/N*100)+"% курса «Авто»","cap")}
   ${kpi("Тренажёр Скорозвона",`${sd} / 5`,"глав пройдено сами","phone")}
   ${kpi("Тестов сдано",`${tDone} / ${tests().length}`,"проходной балл 80%","test")}
   ${kpi("Аттестация",fq?fq.best+"%":"—",fq?(fq.pass?"сдана":"не сдана · попыток "+fq.tries):"в конце курса","star")}</div>
  <div class="sec-title">Программа обучения</div>
  <div class="grid2">
   <a class="card pcard" href="#/course"><span class="pt"><span class="li" style="display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--ink-05)">${ic("cap")}</span><b>Курс «Авто»</b></span>
    <p>Продукт и условия, Скорозвон, скрипт и возражения, итоговая аттестация. Проходите по порядку — каждый модуль заканчивается тестом.</p>
    <span class="pf">${N} материалов ${bar(n/N)} ${Math.round(n/N*100)}%</span></a>
   <a class="card pcard" href="#/sim"><span class="pt"><span class="li" style="display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--ink-05)">${ic("phone")}</span><b>Тренажёр Скорозвона</b></span>
    <p>Копия рабочего места: курсор показывает, куда нажимать, а потом вы повторяете сами. Начало смены, звонок, результат, перевод.</p>
    <span class="pf">5 глав ${bar(sd/5)} ${sd*20}%</span></a></div>
  <div class="sec-title">Что нужно в звонке</div>
  <div class="grid2">${lc("#/script","chat","Скрипт звонка","Девять вопросов без подбора и перевод клиента")}${lc("#/objections","target","Возражения",DATA.OBJ.length+" готовых ответов и тренажёр карточками")}${lc("#/statuses","list","Статусы Скорозвона","Что ставить после разговора, с тренажёром")}${lc("#/checklist","clip","Чек-лист звонка","Проверить себя перед переводом")}</div>
  <div class="sec-title">Справочники</div>
  <div class="grid2">${lc("#/prices","car","Цены по маркам",DATA.AUTO_PRICES.length+" марок со стартовыми ценами")}${lc("#/cities","pin","Города и расстояния","До дилерских центров Москвы и СПб")}${lc("#/terms","book","Кузов и привод","Термины простыми словами")}${lc("#/gloss","book","Глоссарий",DATA.GLOSS.length+" терминов")}</div>
  ${seen.length?`<div class="sec-title">Недавно открытое</div><div class="card ilist">${seen.map(it=>`<a class="irow" href="#/${FLAT.indexOf(it)>=0?"item":"read"}/${it.id}"><span class="ic">${ic(KIND_IC[it.k]||"doc",15)}</span><span class="it"><b>${esc(it.t)}</b><span>${esc(it.k)} · ${esc(it.m)}</span></span><span class="st">${ic("chevR",14)}</span></a>`).join("")}</div>`:""}`);
};

/* ── курс: понятная карта модулей ── */
const MDESC=["Что мы продаём, какие цены можно называть клиенту и где дилерские центры.",
 "Как работать в Скорозвоне: статусы, перезвон, перевод клиента и результат звонка.",
 "Что говорить клиенту на каждом шаге и как отвечать на возражения.",
 "Итоговая проверка знаний по всему курсу — от 80%."];
const KHUE={"Урок":"gray","Справочник":"blue","Тест":"amber","Симулятор":"purple","Скрипт":"pink","Чек-лист":"green","Регламент":"indigo","Тренажёр":"teal","Калькулятор":"teal"};
const kchip=k=>{const h=KHUE[k]||"gray";return `<span class="kchip" style="color:var(--c-${h}-fg);background:var(--c-${h}-bg);border-color:var(--c-${h}-bd)">${esc(k)}</span>`;};
const mins=list=>list.reduce((s,x)=>s+(parseInt(x.m)||0),0);
PAGES.course=id=>{
 const nx=nextUp(),n=doneCount(),N=FLAT.length;
 const openIdx=id!=null?+id:null;W.mopen=W.mopen||{};
 const segs=FLAT.map(x=>`<i class="${isDone(x.id)?"d":nx&&nx.id===x.id?"c":""}" title="${esc(x.t)}"></i>`).join("");
 const hero=`<div class="card chero">
  <div class="chl"><div class="cnum"><b>${n}</b><span>из ${N} материалов</span></div>
   <div class="csegs">${segs}</div>
   <div class="cleg"><span><i class="d"></i>пройдено</span><span><i class="c"></i>сейчас</span><span><i></i>впереди</span></div></div>
  ${nx?`<div class="cnext"><div class="ey">СЛЕДУЮЩИЙ ШАГ · МОДУЛЬ ${modOf[nx.id]+1}</div><b>${esc(nx.t)}</b><div class="row" style="gap:8px;margin-top:8px">${kchip(nx.k)}<span class="card-sub" style="margin:0">${esc(nx.m)}</span></div>
   <a class="btn btn-primary" href="#/item/${nx.id}" style="margin-top:12px;height:34px">${n?"Продолжить":"Начать курс"} ${ic("arrowR",14)}</a></div>`
   :`<div class="cnext"><div class="ey">ГОТОВО</div><b>Курс пройден полностью</b><p class="card-sub">Держите под рукой раздел «Во время звонка».</p></div>`}
 </div>`;
 const mods=COURSE.modules.map((m,mi)=>{
  const d=m.items.filter(x=>isDone(x.id)).length,all=d===m.items.length,cur=nx&&modOf[nx.id]===mi,locked=!all&&!cur&&m.items.every(x=>!isDone(x.id)&&blocker(x.id));
  const open=W.mopen[mi]!=null?W.mopen[mi]:(openIdx!=null?openIdx===mi:cur);
  const state=all?`<span class="chip" style="color:var(--c-green-fg)">✓ Пройден</span>`:cur?`<span class="chip" style="background:var(--brand);color:var(--on-brand);border-color:var(--brand)">Вы здесь</span>`:locked?`<span class="chip">${ic("lock",11)} Закрыт</span>`:"";
  const hasTest=m.items.some(x=>x.quiz);
  return `<div class="card mcard${all?" done":""}${cur?" cur":""}${locked?" locked":""}" id="mod${mi}">
   <button class="mhd" data-mod="${mi}" aria-expanded="${open}">
    <span class="pnum">${all?ic("check",14,2.4):mi+1}</span>
    <span class="mtx"><span class="mn">МОДУЛЬ ${mi+1}</span><b>${esc(m.t)}</b><span class="md">${esc(MDESC[mi]||"")}</span>
     <span class="mm">${m.items.length} ${plural(m.items.length,"материал","материала","материалов")} · ~${mins(m.items)} мин${hasTest?" · тест в конце":""}</span></span>
    <span class="mst">${state}<span class="mbar">${bar(d/m.items.length)}<span>${d} из ${m.items.length}</span></span></span>
    <span class="mcv">${ic("chevD",15,2)}</span>
   </button>
   ${open?`<div class="mbody">${m.items.map((it,k)=>{const dn=isDone(it.id),bl=!dn&&blocker(it.id),isCur=nx&&nx.id===it.id;
    return `<a class="irow2${dn?" done":""}${bl?" lock":""}${isCur?" cur":""}" href="#/item/${it.id}">
     <span class="ix">${dn?ic("check",13,2.6):bl?ic("lock",12):`${mi+1}.${k+1}`}</span>
     <span class="it"><b>${esc(it.t)}</b><span class="row" style="gap:8px">${kchip(it.k)}<span>${esc(it.m)}</span>${bl&&!isCur?`<span class="why2">откроется после «${esc(bl.t)}»</span>`:""}</span></span>
     <span class="st">${dn?`<span style="color:var(--c-green-fg)">Пройдено</span>`:isCur?`<span class="btn btn-primary btn-sm">${n?"Продолжить":"Начать"} ${ic("arrowR",13)}</span>`:""}</span></a>`;}).join("")}</div>`:""}
  </div>`;}).join("");
 return lay(head("Курс «Авто»","4 модуля по порядку: следующий материал открывается, когда отметите текущий пройденным. Каждый модуль заканчивается тестом на 80%.")+hero+`<div class="mlist">${mods}</div>`);
};

/* материал курса (#/item) и материал раздела без блокировки (#/read) */
function itemPage(id,courseMode){
 const it=byId[id];if(!it)return PAGES.course();
 const inCourse=courseMode&&FLAT.indexOf(it)>=0,mi=modOf[id];
 const bl=inCourse&&!isDone(id)?blocker(id):null;
 if(bl)return lay(`<div class="crumbrow"><div class="crumbs"><a href="#/course">Курс «Авто»</a> ${ic("chevR",12)} <a href="#/course/${mi}">Модуль ${mi+1}. ${esc(COURSE.modules[mi].t)}</a></div></div><h1 class="mat">${esc(it.t)}</h1>
  <div class="card"><div class="empty"><span style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--ink-05);color:var(--text-sub)">${ic("lock",20)}</span>
  <div class="empty-title">Материал пока закрыт</div><div class="empty-text">Сначала пройдите «${esc(bl.t)}» — курс идёт по порядку, чтобы знания ложились одно на другое.</div>
  <a class="btn btn-primary" href="#/item/${bl.id}">Перейти к «${esc(bl.t)}»</a></div></div>`,id);
 markSeen(id);
 const i=FLAT.indexOf(it),prev=inCourse?FLAT[i-1]:null,next=inCourse?FLAT[i+1]:null,dn=isDone(id);
 const secK=Object.keys(SEC).find(k=>(SEC[k].items||[]).indexOf(id)>=0);
 const crumbs=inCourse?`<a href="#/course">Курс «Авто»</a> ${ic("chevR",12)} <a href="#/course/${mi}">Модуль ${mi+1}. ${esc(COURSE.modules[mi].t)}</a>`:`<a href="#/${secK||"home"}">${esc(secK?SEC[secK].t:"Главная")}</a>`;
 const mItems=inCourse?COURSE.modules[mi].items:null;
 const lprog=inCourse?`<div class="lprog"><span>Материал ${i+1} из ${FLAT.length} · пройдено</span>${bar(doneCount()/FLAT.length)}<b>${Math.round(doneCount()/FLAT.length*100)}%</b></div>`:"";
 const pills=chip(esc(it.k))+chip(esc(it.m))+(inCourse?chip("Модуль "+(mi+1)):"")+(dn?chip("✓ Пройдено","color:var(--c-green-fg)"):"");
 let body="";
 if(it.id==="sim")body=`<p class="lead2">Сначала «Смотреть» — программа покажет каждое нажатие. Потом «Пройти самому». Пройдёте все 5 глав сами — урок засчитается.</p><div id="player"></div>`;
 else if(it.quiz)body=quizHTML(it);
 else{body+=lessonBody(it);if(it.w){PAGEW=it.w;body+=`<div style="margin-top:12px" id="w">${widget(it.w,W)}</div>`;}}
 const nav=it.quiz||!inCourse?"":`<div class="docnav">
  ${prev?`<a class="btn" href="#/item/${prev.id}">${ic("arrowL",14)} Назад</a>`:`<a class="btn" href="#/course">${ic("arrowL",14)} К курсу</a>`}
  <span class="sp"></span>
  <button class="btn ${dn?"":"btn-primary"}" data-done="${it.id}" style="height:34px">${ic("check",14,2.4)} ${dn?"Пройдено":"Урок пройден"}</button>
  ${next?(dn?`<a class="btn" href="#/item/${next.id}">Далее ${ic("arrowR",14)}</a>`:`<span class="btn" style="opacity:.5;cursor:default" title="Сначала отметьте урок пройденным">${ic("lock",13)} Далее</span>`):""}
 </div>${!dn?`<div class="gate">${ic("info",13)} Отметьте материал пройденным — следующий откроется сразу.</div>`:""}`;
 const wide=it.id==="sim"||!!it.quiz;
 return lay(`<div class="crumbrow"><div class="crumbs">${crumbs}</div>${lprog}${qbtn}</div>
  <div class="kindrow">${pills}</div><h1 class="mat">${esc(it.t)}</h1>${body}${nav}${it.quiz||it.id==="sim"?"":notesPanel(id)}`,inCourse?id:null,wide);
}

/* тест */
function quizHTML(it){
 const st=P.qs[it.id]||(P.qs[it.id]={ans:{},shown:false});
 const q=it.quiz,total=q.length,answered=Object.keys(st.ans).length;
 const correct=q.filter((x,i)=>st.ans[i]===x.a).length,pct=Math.round(correct/total*100),pass=pct>=80,rec=P.quiz[it.id];
 const i=FLAT.indexOf(it),next=FLAT[i+1];
 let out=`<div class="note-line" style="margin-bottom:12px">${ic("info",15)}<div>${it.final?"Итоговая аттестация":"Проверка знаний"} · ${total} ${plural(total,"вопрос","вопроса","вопросов")} · проходной результат <b>80%</b>. Ответьте на все вопросы и нажмите «Проверить» — увидите разбор каждой ошибки.</div></div>`;
 if(st.shown){
  out+=`<div class="card res ${pass?"pass":"fail"}"><div class="qn">РЕЗУЛЬТАТ</div>
   <div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-top:6px"><span class="big">${pct}%</span><b style="font-size:15px">${correct} из ${total} верно</b>${rec&&rec.tries>1?`<span style="font-size:13px;color:var(--text-sub)">лучший ${rec.best}% · попытка ${rec.tries}</span>`:""}</div>
   <p style="margin:10px 0 0;font-size:14px;line-height:1.6">${pass?(it.final?"Аттестация пройдена — курс «Авто» освоен. Покажите результат супервайзеру.":"Тест пройден. Разберите ошибки ниже и двигайтесь дальше."):"Нужно 80% — повторите материалы по темам с ошибками и пересдайте."}</p>
   <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn" data-retry="${it.id}">Пройти заново</button>${(pass||rec&&rec.pass)&&next?`<a class="btn btn-primary" href="#/item/${next.id}">Дальше ${ic("arrowR",14)}</a>`:""}${!pass?`<a class="btn btn-primary" href="#/course/${modOf[it.id]}">Повторить модуль</a>`:""}</div></div>`;
 }
 q.forEach((x,k)=>{const picked=st.ans[k];
  out+=`<div class="card qc" style="margin-top:10px"><div class="qn">ВОПРОС ${k+1} ИЗ ${total}</div><div class="qt">${esc(x.q)}</div><div class="opts">${x.o.map((o,j)=>{
   let cls="opt";if(st.shown){if(j===x.a)cls+=" right";else if(picked===j)cls+=" wrong";}else if(picked===j)cls+=" pick";
   return `<button class="${cls}" ${st.shown?"disabled":""} data-q="${it.id}" data-qi="${k}" data-o="${j}"><span class="k">${"АБВГД"[j]}</span><span>${esc(o)}</span></button>`;}).join("")}</div>
   ${st.shown?`<div class="why"><b>${picked===x.a?"Верно.":"Правильный ответ — "+"АБВГД"[x.a]+"."}</b> ${esc(x.w||"")}</div>`:""}</div>`;});
 if(!st.shown)out+=`<div class="qbar"><div style="flex:1;min-width:150px"><div style="font-size:12px;color:var(--text-sub);margin-bottom:6px">Отвечено ${answered} из ${total}</div>${bar(answered/total)}</div>
  <button class="btn btn-primary" data-check="${it.id}" style="height:36px" ${answered<total?"disabled":""}>Проверить ответы</button></div>`;
 return out;
}

PAGES.tests=()=>lay(head("Тесты","Каждый тест засчитывается от 80%. Итоговая аттестация открывается, когда пройден весь курс.",chip(`${tests().filter(x=>isDone(x.id)).length} / ${tests().length} сдано`))+
 `<div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Тест</th><th>Модуль</th><th class="r">Вопросов</th><th class="r">Лучший</th><th class="r">Попыток</th><th></th></tr></thead><tbody>
 ${tests().map(t=>{const r=P.quiz[t.id],bl=!isDone(t.id)&&blocker(t.id);
  return `<tr class="clickable" onclick="location.hash='#/item/${t.id}'"><td><b>${esc(t.t)}</b>${t.final?' <span class="chip">итоговая</span>':""}</td><td class="muted">${esc(COURSE.modules[modOf[t.id]].t)}</td><td class="r">${t.quiz.length}</td>
   <td class="r" style="color:${r?(r.pass?"var(--c-green-fg)":"var(--c-red-fg)"):"var(--dim)"}">${r?r.best+"%":"—"}</td><td class="r">${r?r.tries:0}</td><td class="r muted">${bl?ic("lock",13)+" закрыт":r&&r.pass?"✓ сдан":"открыть"}</td></tr>`;}).join("")}
 </tbody></table></div>`);

PAGES.progress=()=>{const sd=simDone(),d=szDoneList(),chs=szChapters("auto");
 return lay(head("Мой прогресс","Что уже пройдено и что осталось. Прогресс сохраняется в CRM — его видит руководитель.",`<button class="btn btn-sm" data-reset>Сбросить прогресс</button>`)+
 `<div class="kpi-grid">${[["Курс «Авто»",doneCount()+" / "+FLAT.length,"материалов","cap"],["Тренажёр Скорозвона",sd+" / 5","глав сами","phone"],["Тесты",tests().filter(x=>isDone(x.id)).length+" / "+tests().length,"сдано","test"],["Заметки",Object.values(P.notes||{}).filter(x=>x&&x.trim()).length,"к материалам","note"]].map(x=>`<div class="card kpi"><div class="kpi-label">${ic(x[3],13)} ${x[0]}</div><div class="kpi-value">${x[1]}</div><div class="kpi-sub">${x[2]}</div></div>`).join("")}</div>
 <div class="sec-title">По модулям</div><div class="card path">${COURSE.modules.map((m,mi)=>{const dd=m.items.filter(x=>isDone(x.id)).length;return `<a class="pstep${dd===m.items.length?" done":""}" href="#/course/${mi}"><span class="pnum">${dd===m.items.length?"✓":mi+1}</span><span class="pbody"><b>${esc(m.t)}</b><span>${dd} из ${m.items.length} материалов</span></span><span class="pbar"><div class="t">${Math.round(dd/m.items.length*100)}%</div>${bar(dd/m.items.length)}</span></a>`;}).join("")}</div>
 <div class="sec-title">Тренажёр Скорозвона</div><div class="card ilist">${chs.map((c,i)=>{const w=d.indexOf("auto:"+c.id+":watch")>=0,t=d.indexOf("auto:"+c.id+":try")>=0;return `<a class="irow${t?" done":""}" href="#/sim"><span class="ic">${ic(t?"check":"phone",15)}</span><span class="it"><b>Глава ${i+1}. ${esc(c.t)}</b><span>${w?"✓ смотрел":"не смотрел"} · ${t?"✓ прошёл сам":"сам не проходил"}</span></span><span class="st">${ic("chevR",14)}</span></a>`;}).join("")}</div>`);};

PAGES.sim=()=>lay(head("Тренажёр Скорозвона","Пять коротких глав — от начала смены до перевода клиента. Сначала «Смотреть», затем «Пройти самому». Полосу шагов под экраном можно тянуть мышкой.",chip(`${simDone()} / 5 глав пройдено сами`))+`<div id="player"></div>`,null,true);

/* разделы */
function secPage(k){
 const s=SEC[k];let tabs="",body="";
 if(s.items&&s.items.length>1){
  const cur=W.tab&&s.items.indexOf(W.tab)>=0?W.tab:s.items[0];
  tabs=`<div class="seg stabs">${s.items.map(id=>`<button aria-pressed="${id===cur}" data-tab="${id}" title="${esc(byId[id].t)}">${esc(TABNAME[id]||byId[id].t)}</button>`).join("")}</div>`;
  const it=byId[cur];
  body=`<div class="kindrow">${chip(esc(it.k))}${chip(esc(it.m))}</div>`+lessonBody(it)+(it.w?`<div style="margin-top:12px" id="w">${(PAGEW=it.w,widget(it.w,W))}</div>`:"")+notesPanel(it.id);
 }else{
  if(s.items){const it=byId[s.items[0]];body+=lessonBody(it);}
  if(s.w){PAGEW=s.w;body+=`<div style="margin-top:${s.items?12:0}px" id="w">${widget(s.w,W)}</div>`;}
  if(s.items)body+=notesPanel(s.items[0]);
 }
 return lay(head(esc(s.t),esc(s.s))+tabs+body,null,!!s.noAside);
}
PAGES.notes=()=>{const ids=Object.keys(P.notes||{}).filter(id=>P.notes[id]&&P.notes[id].trim()&&byId[id]);
 return lay(head("Мои заметки","Заметки, которые вы оставили к материалам. Сохраняются в CRM.")+
 (ids.length?ids.map(id=>`<div class="card" style="margin-bottom:10px"><div class="card-pad"><div class="row" style="justify-content:space-between"><a class="card-title" href="#/${FLAT.indexOf(byId[id])>=0?"item":"read"}/${id}" style="color:var(--text);text-decoration:none">${esc(byId[id].t)}</a><span class="card-sub" style="margin:0">${esc(byId[id].k)}</span></div><p style="margin:8px 0 0;font-size:13.5px;line-height:1.6;white-space:pre-wrap;color:var(--text-soft)">${esc(P.notes[id])}</p></div></div>`).join("")
 :`<div class="card"><div class="empty"><span style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--ink-05);color:var(--text-sub)">${ic("note",20)}</span><div class="empty-title">Заметок пока нет</div><div class="empty-text">Внизу каждого урока есть поле «Моя заметка к материалу» — запишите туда формулировку, которая сработала, или вопрос наставнику.</div></div></div>`));};

PAGES.help=()=>lay(head("Как пользоваться","Короткая инструкция: с чего начать и как устроено обучение.")+
 `<div class="howto">
  ${[["Начните с тренажёра Скорозвона","Это программа, в которой проходит вся смена. Тренажёр — копия её экрана: курсор сам покажет, куда нажимать, а потом вы повторите сами.",`<a class="btn btn-primary btn-sm" href="#/sim">Открыть тренажёр</a>`],
     ["Проходите курс «Авто» по порядку","Четыре модуля: продукт, Скорозвон, скрипт и возражения, аттестация. Прочитали урок — нажмите «Урок пройден», и откроется следующий. Кнопка «Продолжить обучение» слева всегда ведёт к следующему шагу.",`<a class="btn btn-sm" href="#/course">Открыть курс</a>`],
     ["Сдавайте тесты на 80%","После каждого модуля — короткий тест. Ошиблись — посмотрите разбор, повторите модуль и пересдайте. В конце — итоговая аттестация.",`<a class="btn btn-sm" href="#/tests">Все тесты</a>`],
     ["В звонке — правая колонка и раздел «Во время звонка»","Справа на любой странице: скрипт, статусы и возражения открываются поверх страницы — место в уроке не теряется. Скрипт удобнее читать в режиме «Только реплики».",`<a class="btn btn-sm" href="#/script">Открыть скрипт</a>`],
     ["Ищите через поиск","Ctrl+K или кнопка «Поиск» слева: уроки, статусы, возражения, марки, города и термины — в одном месте.",`<button class="btn btn-sm" data-pal>Открыть поиск</button>`]]
   .map((x,k)=>`<div class="card hstep"><span class="hn">${k+1}</span><div><b>${x[0]}</b><p>${x[1]}</p>${x[2]}</div></div>`).join("")}
  <div class="card card-pad"><h3 class="card-title">Управление тренажёром Скорозвона</h3>
   <div class="keys" style="margin-top:10px"><span><span class="kbd">←</span> <span class="kbd">→</span> предыдущий / следующий шаг</span><span><span class="kbd">Пробел</span> пауза</span><span>Полосу шагов можно тянуть мышкой или крутить колесом</span><span>«На весь экран» — крупнее, выход <span class="kbd">Esc</span></span></div></div>
 </div>`);

/* ── справочники и тренажёры: состояние S — страница (W) или выдвижная панель (DW) ── */
const SEG={budget:"Доступные",middle:"Средний сегмент",premium:"Премиум",unavailable:"Нет в наличии"};
function widget(id,S){
 const q=norm(S.q||""),f=S.f||"all";
 const fld=ph=>`<input class="inp" data-wq placeholder="${ph}" value="${esc(S.q||"")}" style="height:34px">`;
 const filt=list=>`<div class="seg">${list.map(x=>`<button data-wf="${x.v}" aria-pressed="${f===x.v}">${esc(x.t)}</button>`).join("")}</div>`;
 const mk=t=>mark(t,S.q);
 if(id==="st-auto"){
  const col={"Успешные":"var(--c-green-fg)","Промежуточные":"var(--c-blue-fg)","Недозвон":"var(--text-sub)","Неуспешные":"var(--c-red-fg)"};
  const rows=DATA.ST_AUTO.filter(r=>(f==="all"||r.g===f)&&(!q||norm(r.n).includes(q)||norm(r.d).includes(q)));
  return `<div class="tools">${fld("Статус или ситуация: дубль, тишина, регион…")}${filt([{v:"all",t:"Все"},{v:"Успешные",t:"Успешные"},{v:"Промежуточные",t:"Промежуточные"},{v:"Недозвон",t:"Недозвон"},{v:"Неуспешные",t:"Неуспешные"}])}</div>
  <div class="wres"><div class="card"><table class="tbl"><thead><tr><th style="width:220px">Статус</th><th>Когда ставим</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td style="white-space:normal"><b>${mk(r.n)}</b><div style="margin-top:4px"><span class="chip" style="color:${col[r.g]}"><span class="dot"></span>${r.g}</span></div></td><td style="white-space:normal;line-height:1.55">${mk(r.d)}</td></tr>`).join("")||`<tr><td colspan="2"><div class="empty"><div class="empty-title">Ничего не нашлось</div><div class="empty-text">Попробуйте «дубль», «перезвон», «бот».</div></div></td></tr>`}
  </tbody></table></div><div class="foot">${rows.length} из ${DATA.ST_AUTO.length} статусов. Потренироваться: <a href="#/tr-st" style="color:var(--text-sub)">тренажёр статусов</a>.</div>${dataNote("настройки статусов в Скорозвоне")}</div>`;}
 if(id==="obj-auto"){
  const rows=DATA.OBJ.filter(o=>!q||norm(o.q).includes(q)||norm(o.a).includes(q));
  return `<div class="tools">${fld("Возражение: дорого, откуда номер, подумаю…")}</div><div class="wres"><div class="qa">${rows.map(o=>`<div class="card"><div class="q">«${mk(o.q)}»</div><div class="a">${mk(o.a)}</div></div>`).join("")||`<div class="card"><div class="empty"><div class="empty-title">Ничего не нашлось</div></div></div>`}</div>
  <div class="foot">Каждый ответ заканчиваем вопросом по скрипту — иначе после паузы клиент кладёт трубку. Потренироваться: <a href="#/tr-obj" style="color:var(--text-sub)">тренажёр возражений</a>.</div></div>`;}
 if(id==="auto-prices"){
  const rows=DATA.AUTO_PRICES.filter(r=>(f==="all"||r.segment===f)&&(!q||norm(r.name).includes(q)||norm(r.aliases||"").includes(q))).sort((a,b)=>(a.price||1e12)-(b.price||1e12));
  return `<div class="tools">${fld("Марка: Хавейл, Чери, Лада…")}${filt([{v:"all",t:"Все"},{v:"budget",t:"Доступные"},{v:"middle",t:"Средний"},{v:"premium",t:"Премиум"},{v:"unavailable",t:"Нет в наличии"}])}</div>
  <div class="wres"><div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>Марка</th><th>Латиницей</th><th class="r">Стартовая цена</th><th>Сегмент</th><th>Страна</th><th>Особенности</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td><b>${mk(r.name)}</b></td><td class="muted">${esc(r.aliases||"—")}</td><td class="r">${r.segment==="unavailable"?'<span class="chip" style="color:var(--c-red-fg)">нет в наличии</span>':rub(r.price)}</td><td class="muted">${SEG[r.segment]||"—"}</td><td>${esc(r.country||"—")}</td><td class="muted">${esc(r.power||"—")}</td></tr>`).join("")||`<tr><td colspan="6"><div class="empty"><div class="empty-title">Марка не найдена</div><div class="empty-text">Уточните у клиента, готов ли он рассмотреть другие марки.</div></div></td></tr>`}
  </tbody></table></div><div class="foot">${rows.length} из ${DATA.AUTO_PRICES.length} марок. Это стартовые цены по марке: комплектацию, наличие и итоговое предложение подтверждает менеджер.</div>${dataNote("скрипт «Авто.ру без подбора» (PDF проекта)")}</div>`;}
 if(id==="auto-cities"){
  const rows=DATA.AUTO_CITIES.filter(r=>(f==="all"||r.hub===f)&&(!q||norm(r.city).includes(q))).sort((a,b)=>a.km-b.km);
  return `<div class="tools">${fld("Город клиента: Тверь, Казань…")}${filt([{v:"all",t:"Все"},{v:"Москва",t:"До Москвы"},{v:"Санкт-Петербург",t:"До Санкт-Петербурга"}])}</div>
  <div class="wres"><div class="card"><table class="tbl"><thead><tr><th>Город</th><th>Ближайший ДЦ</th><th class="r">Расстояние</th><th class="r">Примерно в пути</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td><b>${mk(r.city)}</b></td><td>${esc(r.hub)}</td><td class="r">${r.km} км</td><td class="r muted">≈ ${String(Math.round(r.km/80*10)/10).replace(".",",")} ч</td></tr>`).join("")||`<tr><td colspan="4"><div class="empty"><div class="empty-title">Города нет в таблице</div><div class="empty-text">Уточните, готов ли клиент приехать в дилерский центр.</div></div></td></tr>`}
  </tbody></table></div><div class="foot">${rows.length} из ${DATA.AUTO_CITIES.length} городов. Время — грубая оценка по 80 км/ч.</div>${dataNote("таблица расстояний до ДЦ из материалов проекта")}</div>`;}
 if(id==="gloss"){
  const G=[{v:"auto",t:"Авто",s:"Кузов, привод и условия покупки — чтобы понимать клиента и не обещать лишнего."},{v:"int",t:"Внутренние слова",s:"Метрики, системы и сокращения, которые звучат внутри группы, но не в разговоре с клиентом."}];
  const rows=DATA.GLOSS.filter(g=>(f==="all"||g.g===f)&&(!q||norm(g.t).includes(q)||norm(g.d).includes(q)));
  return `<div class="tools">${fld("Термин: кроссовер, апрув, FTE…")}${filt([{v:"all",t:"Все"}].concat(G.map(g=>({v:g.v,t:g.t}))))}</div><div class="wres">
  ${G.map(g=>{const l=rows.filter(x=>x.g===g.v);if(!l.length)return"";return `<div class="sec-title">${g.t} <span class="cnt">${l.length}</span></div><p class="page-sub" style="margin:-4px 0 10px">${g.s}</p><div class="grid3 gl">${l.map(x=>`<div class="card"><b>${mk(x.t)}</b><span>${mk(x.d)}</span></div>`).join("")}</div>`;}).join("")||`<div class="card"><div class="empty"><div class="empty-title">Ничего не нашлось</div></div></div>`}</div>`;}
 if(id==="tr-auto"){
  const pool=DATA.OBJ;
  if(!S.queue){S.queue=shuffle(pool.map((_,i)=>i));S.i=0;S.ok=0;S.no=0;S.flip=false;}
  const cur=pool[S.queue[S.i%S.queue.length]];
  return `<div class="card flip"><div class="who2">Клиент говорит</div><div class="said">«${esc(cur.q)}»</div>
   ${S.flip?`<div class="ans"><b>Отвечаем:</b> ${esc(cur.a)}</div>`:`<div class="ans dim">Проговорите ответ вслух, затем откройте эталон и сравните.</div>`}</div>
   <div class="row" style="margin-top:12px;flex-wrap:wrap">${S.flip?`<button class="btn" data-tr="bad">Ответил неточно</button><button class="btn btn-primary" data-tr="good">Ответил верно ${ic("arrowR",14)}</button>`:`<button class="btn btn-primary" data-tr="flip">Показать эталон</button><button class="btn" data-tr="skip">Пропустить</button>`}</div>
   <div class="tstat"><span>Карточка ${S.i%pool.length+1} из ${pool.length}</span><span style="color:var(--c-green-fg)">верно: ${S.ok}</span><span style="color:var(--c-amber-fg)">неточно: ${S.no}</span></div>`;}
 if(id==="tr-st"){
  const pool=DATA.ST_AUTO;
  if(!S.queue){S.queue=shuffle(pool.map((_,i)=>i));S.i=0;S.ok=0;S.no=0;S.pick=null;}
  const cur=pool[S.queue[S.i%S.queue.length]];
  if(S.optsFor!==S.i){const same=pool.filter(x=>x.n!==cur.n);S.opts=shuffle([cur].concat(shuffle(same.filter(x=>x.g===cur.g)).concat(shuffle(same)).filter((x,k,a)=>a.indexOf(x)===k).slice(0,3)));S.optsFor=S.i;}
  const done=S.pick!=null;
  return `<div class="card flip"><div class="who2">Ситуация в звонке</div><div class="said" style="font-size:16px">${esc(cur.d)}</div></div>
   <div class="opts" style="margin-top:12px">${S.opts.map((o,j)=>{let c="opt";if(done){if(o.n===cur.n)c+=" right";else if(S.pick===j)c+=" wrong";}
    return `<button class="${c}" ${done?"disabled":""} data-stp="${j}"><span class="k">${"АБВГ"[j]}</span><span>${esc(o.n)}</span></button>`;}).join("")}</div>
   ${done?`<div class="why"><b>${S.opts[S.pick].n===cur.n?"Верно.":"Правильный ответ — «"+esc(cur.n)+"»."}</b> ${esc(cur.d)}</div><div style="margin-top:12px"><button class="btn btn-primary" data-stnext>Следующая ситуация ${ic("arrowR",14)}</button></div>`:""}
   <div class="tstat"><span>Ситуация ${S.i+1}</span><span style="color:var(--c-green-fg)">верно: ${S.ok}</span><span style="color:var(--c-red-fg)">ошибок: ${S.no}</span></div>`;}
 if(id==="calc-op"){
  const h=S.h==null?8:S.h,l=S.l==null?6:S.l;
  const rate=l>=11?260:l>=8?240:l>=6?230:200,per=l>=11?90:l>=8?80:l>=6?75:70,sum=rate*h+per*l,eff=h?Math.round(l/h*100):0;
  const nx=l<6?6:l<8?8:l<11?11:null;
  const hint=nx?`Ещё ${nx-l} ${plural(nx-l,"лид","лида","лидов")} — и смена стоит ${rub((nx>=11?260:nx>=8?240:230)*h+(nx>=11?90:nx>=8?80:75)*nx)} вместо ${rub(sum)}.`:"Вы в верхней ступени сетки: 260 ₽ за час и 90 ₽ за лид.";
  const sel=(k,v,from,to,fm)=>selHTML(k,v,Array.from({length:to-from+1},(_,i)=>({v:from+i,t:fm(from+i)})),S===DW?"d":"w");
  return `<div class="card card-pad"><div class="calc"><div><label>Часов в смене</label>${sel("h",h,2,12,x=>x+" "+plural(x,"час","часа","часов"))}</div><div><label>Лидов за смену</label>${sel("l",l,0,20,x=>x+" "+plural(x,"лид","лида","лидов"))}</div></div></div>
   <div class="kpi-grid" style="margin-top:12px"><div class="card kpi"><div class="kpi-label">Заработок за смену</div><div class="kpi-value">${rub(sum)}</div></div><div class="card kpi"><div class="kpi-label">Ставка в час</div><div class="kpi-value">${rate} ₽</div></div><div class="card kpi"><div class="kpi-label">За каждый лид</div><div class="kpi-value">${per} ₽</div></div><div class="card kpi"><div class="kpi-label">Эффективность</div><div class="kpi-value" style="color:${eff>=60?"var(--c-green-fg)":eff>=40?"var(--c-amber-fg)":"var(--c-red-fg)"}">${eff}%</div></div></div>
   <div class="note-line ${eff>=60?"ok":""}" style="margin-top:12px">${ic(eff>=60?"check":"info",15)}<div><span class="nt">${eff>=60?"Норма выполнена":"Как заработать больше"}</span>${hint} Стажировка закрывается по 10 переданным лидам за 15 отработанных часов.</div></div>`;}
 return `<div class="empty">Материал готовится.</div>`;
}

/* ── выдвижная панель «поверх страницы» ── */
function openDrawer(k){DRW={open:true,key:k};DW={};renderDrawer();}
function closeDrawer(silent){if(!DRW.open)return;DRW={open:false,key:""};if(!silent)renderDrawer();else DRW_EL.innerHTML="";}
function drawerWidgetId(){const k=DRW.key;if(k.indexOf("item:")===0){const it=byId[k.slice(5)];return it&&it.w;}return DRAWERS[k]?k:null;}
function renderDrawer(){
 const el=DRW_EL;
 if(!DRW.open){el.innerHTML="";return;}
 const k=DRW.key;let t="",s="",go="",body="";
 if(k==="__aside"){t="Быстрый доступ";s="Справочники и подсказки для звонка";body=asideHTML(route().r==="item"?route().id:null);}
 else if(k.indexOf("item:")===0){const it=byId[k.slice(5)];t=it.t;s=esc(it.k)+" · "+esc(it.m);go=(FLAT.indexOf(it)>=0?"#/item/":"#/read/")+it.id;
  const sec=Object.keys(SEC).find(x=>(SEC[x].items||[]).indexOf(it.id)>=0);if(sec)go="#/"+sec;
  body=lessonBody(it)+(it.w?`<div style="margin-top:12px" class="dw">${widget(it.w,DW)}</div>`:"");}
 else{const d=DRAWERS[k];t=d.t;s=d.s;go="#/"+d.go;body=`<div class="dw">${widget(k,DW)}</div>`;}
 el.innerHTML=`<div class="drawer-back" data-dclose></div><div class="drawer" role="dialog" aria-label="${esc(t)}">
  <div class="dh"><div class="dt"><b>${esc(t)}</b><span>${s}</span></div>${go?`<a class="btn btn-sm" href="${go}">Открыть целиком</a>`:""}<button class="btn btn-sm btn-ghost" data-dclose title="Закрыть (Esc)">${ic("M18 6 6 18M6 6l12 12",15)}</button></div>
  <div class="db">${body}</div></div>`;
}

/* ── поиск (Ctrl+K), как палитра команд в CRM ── */
let PAL={open:false,q:"",sel:0,res:[]};
function palResults(q){
 const n=norm(q.trim()),out=[];
 const add=(g,i,l,h,act)=>out.push({g,i,l,h,act});
 NAV.forEach(gg=>gg.items.forEach(x=>{if(!n||norm(x.t).includes(n))add("Разделы",x.i,x.t,gg.g,"#/"+x.r);}));
 if(!n)return out.slice(0,12);
 FLAT.concat(DATA.pay.modules.flatMap(m=>m.items)).forEach(it=>{const txt=norm(it.t+" "+JSON.stringify(it.b||"")+" "+JSON.stringify(it.quiz||""));
  if(txt.includes(n))add("Материалы",KIND_IC[it.k]||"doc",it.t,it.k+(modOf[it.id]!=null?" · модуль "+(modOf[it.id]+1):""),(FLAT.indexOf(it)>=0?"#/item/":"#/read/")+it.id);});
 DATA.ST_AUTO.forEach(s=>{if(norm(s.n+" "+s.d).includes(n))add("Статусы","list",s.n,s.g,{d:"st-auto",q:s.n});});
 DATA.OBJ.forEach(o=>{if(norm(o.q+" "+o.a).includes(n))add("Возражения","target","«"+o.q+"»","ответ клиенту",{d:"obj-auto",q:o.q});});
 DATA.AUTO_PRICES.forEach(p=>{if(norm(p.name+" "+(p.aliases||"")).includes(n))add("Марки","car",p.name,p.segment==="unavailable"?"нет в наличии":rub(p.price),{d:"auto-prices",q:p.name});});
 DATA.AUTO_CITIES.forEach(c=>{if(norm(c.city).includes(n))add("Города","pin",c.city,c.km+" км до "+c.hub,{d:"auto-cities",q:c.city});});
 DATA.GLOSS.forEach(g=>{if(norm(g.t+" "+g.d).includes(n))add("Глоссарий","book",g.t,g.d,{d:"gloss",q:g.t});});
 return out.slice(0,40);
}
function openPal(){PAL={open:true,q:"",sel:0,res:palResults("")};renderPal(true);}
function closePal(){PAL.open=false;PAL_EL.innerHTML="";}
function renderPal(focus){
 const el=PAL_EL;if(!PAL.open){el.innerHTML="";return;}
 let g="",rows="";PAL.res.forEach((r,i)=>{if(r.g!==g){g=r.g;rows+=`<div class="pal-g">${esc(g.toUpperCase())}</div>`;}
  rows+=`<button class="pal-row${i===PAL.sel?" sel":""}" data-pi="${i}">${ic(r.i,15)}<span class="pl">${esc(r.l)}</span><span class="ph">${esc(r.h||"")}</span></button>`;});
 if(!el.firstChild){el.innerHTML=`<div class="modal-back" style="padding-top:12vh;align-items:flex-start" data-pclose><div class="modal" role="dialog" aria-label="Поиск" style="max-width:600px">
  <div class="row" style="padding:12px 14px;border-bottom:1px solid var(--ink-06);gap:10px">${ic("search",16)}<input id="palq" placeholder="Урок, статус, возражение, марка, город, термин…" style="flex:1;border:none;outline:none;background:transparent;color:var(--text);font:inherit;font-size:14px"><span class="kbd">Esc</span></div>
  <div id="pallist" style="max-height:420px;overflow-y:auto;padding:6px"></div></div></div>`;}
 document.getElementById("pallist").innerHTML=rows||`<div style="padding:18px;font-size:13px;color:var(--dim);text-align:center">Ничего не найдено</div>`;
 const s=document.querySelector(".pal-row.sel");if(s)s.scrollIntoView({block:"nearest"});
 if(focus)document.getElementById("palq").focus();
}
function runPal(r){if(!r)return;closePal();if(typeof r.act==="string"){location.hash=r.act;return;}openDrawer(r.act.d);DW.q=r.act.q;renderDrawer();}

/* ── выпадающий список как в CRM (components/ui/select.tsx): не системный <select> ──
   Всплывашка в body с position:fixed, открывается вниз или вверх — куда хватает места,
   клавиатура ↑↓ Enter Esc, от 8 пунктов — строка поиска. */
const SELOPTS={};
let SEL=null;
function selHTML(key,val,opts,ctx){
 SELOPTS[ctx+":"+key]=opts;
 const cur=opts.find(o=>o.v===val);
 return `<button type="button" class="inp sel-trigger" data-sel="${key}" data-ctx="${ctx}" data-val="${esc(String(val))}" aria-haspopup="listbox" style="width:100%"><span class="sel-value">${esc(cur?cur.t:"— выберите —")}</span>${ic("chevD",13,2).replace('style="flex:none"','class="sel-chev" style="flex:none"')}</button>`;
}
function selOpen(btn){
 selClose();
 const key=btn.dataset.sel,ctx=btn.dataset.ctx,opts=SELOPTS[ctx+":"+key]||[],S=ctx==="d"?DW:W;
 SEL={btn,key,ctx,opts,q:"",val:btn.dataset.val,hi:Math.max(0,opts.findIndex(o=>String(o.v)===btn.dataset.val))};
 btn.setAttribute("data-open","");
 const pop=document.createElement("div");pop.className="sel-pop";pop.setAttribute("role","listbox");pop.tabIndex=-1;
 document.body.appendChild(pop);SEL.pop=pop;selDraw(true);
}
function selShown(){const q=szNorm(SEL.q||"");return SEL.opts.filter(o=>!q||szNorm(o.t).includes(q));}
function selDraw(first){
 if(!SEL)return;
 const S=SEL.ctx==="d"?DW:W,shown=selShown();
 SEL.hi=Math.max(0,Math.min(SEL.hi,shown.length-1));
 const search=SEL.opts.length>=8?`<div class="sel-search">${ic("search",13)}<input id="selq" placeholder="Поиск" value="${esc(SEL.q)}"></div>`:"";
 const list=`<div class="sel-list">${shown.map((o,i)=>`<div class="sel-opt${i===SEL.hi?" is-hi":""}${String(o.v)===SEL.val?" is-on":""}" data-si="${i}"><span class="sel-check">${String(o.v)===SEL.val?ic("check",13,2.4):""}</span><span class="sel-label">${esc(o.t)}</span></div>`).join("")||`<div class="sel-empty">Ничего не найдено</div>`}</div>`;
 if(first){SEL.pop.innerHTML=search+list;}
 else{const l=SEL.pop.querySelector(".sel-list");const tmp=document.createElement("div");tmp.innerHTML=list;l.replaceWith(tmp.firstChild);}
 selPlace();if(!SEL)return;
 const hi=SEL.pop.querySelector(".sel-opt.is-hi");if(hi)hi.scrollIntoView({block:"nearest"});
 if(first){const q=document.getElementById("selq");(q||SEL.pop).focus({preventScroll:true});}
}
function selPlace(){
 if(!SEL)return;const r=SEL.btn.getBoundingClientRect(),p=SEL.pop;
 if(r.bottom<0||r.top>innerHeight){selClose();return;}
 p.style.position="fixed";p.style.minWidth=r.width+"px";p.style.left=Math.max(8,Math.min(r.left,innerWidth-p.offsetWidth-8))+"px";
 const h=p.offsetHeight||280,below=innerHeight-r.bottom-8,up=below<h&&r.top-8>below;
 p.style.top=up?"":(r.bottom+4)+"px";p.style.bottom=up?(innerHeight-r.top+4)+"px":"";
 p.style.maxHeight=Math.max(160,(up?r.top:innerHeight-r.bottom)-16)+"px";
}
function selPick(o){const S=SEL.ctx==="d"?DW:W,inD=SEL.ctx==="d",btn=SEL.btn;S[SEL.key]=o.v;selClose();refreshW(inD);
 const nb=document.querySelector(`${inD?"#acad-drawer ":"#w "}[data-sel="${btn.dataset.sel}"]`);if(nb)nb.focus({preventScroll:true});}
function selClose(){if(!SEL)return;SEL.btn.removeAttribute("data-open");SEL.pop.remove();SEL=null;}
__on(document,"mousedown",e=>{if(!SEL)return;if(SEL.pop.contains(e.target)||SEL.btn.contains(e.target))return;selClose();},true);
__on(document,"click",e=>{
 const t=e.target.closest("[data-sel]");if(t){e.stopPropagation();if(SEL&&SEL.btn===t)selClose();else selOpen(t);return;}
 const o=e.target.closest(".sel-opt");if(o&&SEL){e.stopPropagation();selPick(selShown()[+o.dataset.si]);}
},true);
__on(document,"mousemove",e=>{const o=e.target.closest&&e.target.closest(".sel-opt");if(o&&SEL&&+o.dataset.si!==SEL.hi){SEL.hi=+o.dataset.si;SEL.pop.querySelectorAll(".sel-opt").forEach((x,i)=>x.classList.toggle("is-hi",i===SEL.hi));}});
__on(document,"input",e=>{if(e.target.id==="selq"&&SEL){SEL.q=e.target.value;SEL.hi=0;selDraw();}},true);
__on(document,"keydown",e=>{
 if(!SEL){const t=e.target.closest&&e.target.closest("[data-sel]");if(t&&(e.key==="ArrowDown"||e.key==="Enter"||e.key===" ")){e.preventDefault();selOpen(t);}return;}
 const shown=selShown();
 if(e.key==="Escape"){e.preventDefault();e.stopPropagation();const b=SEL.btn;selClose();b.focus();}
 else if(e.key==="ArrowDown"){e.preventDefault();SEL.hi=Math.min(shown.length-1,SEL.hi+1);selDraw();}
 else if(e.key==="ArrowUp"){e.preventDefault();SEL.hi=Math.max(0,SEL.hi-1);selDraw();}
 else if(e.key==="Enter"){e.preventDefault();if(shown[SEL.hi])selPick(shown[SEL.hi]);}
 else if(e.key==="Tab")selClose();
},true);
__on(window,"scroll",e=>{if(SEL&&!SEL.pop.contains(e.target))selPlace();},true);
__on(window,"resize",()=>selPlace());

/* ── отрисовка ── */
function render(keepScroll){
 const y=scroller().scrollTop,r=route();PAGEW=null;
 let html;
 if(r.r==="item")html=itemPage(r.id,true);
 else if(r.r==="read")html=itemPage(r.id,false);
 else if(r.r==="course")html=PAGES.course(r.id);
 else if(SEC[r.r])html=secPage(r.r);
 else html=(PAGES[r.r]||PAGES.home)();
 VIEW.innerHTML=html;
 document.title=(r.r==="item"||r.r==="read")&&byId[r.id]?byId[r.id].t+" · Обучение · Авто":(TITLE[r.r]||"Главная")+" · Обучение · Авто";
 renderNav();
 const pl=document.getElementById("player");
 if(pl)szCreate(pl,{track:"auto",statuses:DATA.ST_AUTO,chapBar:true,reserve:400,onChange:onSim,btn:{bt:"btn",pri:"btn-primary",sm:"btn-sm",out:"",seg:"seg"}});
 if(keepScroll)scroller().scrollTop=y;
 else if(r.r==="course"&&r.id!=null){const m=document.getElementById("mod"+r.id);if(m)m.scrollIntoView({block:"start"});}
}
let simLast=-1;
function onSim(){const n=simDone();if(n===simLast)return;simLast=n;if(n===5&&!P.done.sim){P.done.sim=true;persist("sim",{done:true});}renderNav();}
/* обновить только список (поиск, фильтр, тренажёр) — поле ввода не теряет фокус */
function refreshW(inDrawer){
 const S=inDrawer?DW:W,id=inDrawer?drawerWidgetId():PAGEW;
 const host=inDrawer?document.querySelector("#acad-drawer .dw"):document.getElementById("w");if(!host||!id)return;
 const tmp=document.createElement("div");tmp.innerHTML=widget(id,S);
 const res=host.querySelector(".wres"),nres=tmp.querySelector(".wres");
 if(res&&nres){res.innerHTML=nres.innerHTML;const sg=host.querySelector(".tools .seg"),nsg=tmp.querySelector(".tools .seg");if(sg&&nsg)sg.innerHTML=nsg.innerHTML;}
 else host.innerHTML=tmp.innerHTML;
}
const rerender=inDrawer=>inDrawer?renderDrawer():render(true);

__on(document,"click",e=>{
 if(e.target.closest("[data-pclose]")&&e.target===e.target.closest("[data-pclose]")){closePal();return;}
 const pr=e.target.closest("[data-pi]");if(pr){runPal(PAL.res[+pr.dataset.pi]);return;}
 if(e.target.closest("[data-pal]")){openPal();return;}
 if(e.target.closest("[data-dclose]")){closeDrawer();return;}
 const dr=e.target.closest("[data-drawer]");if(dr){openDrawer(dr.dataset.drawer);return;}
 if(e.target.closest("#acad-drawer a[href^='#/']")){closeDrawer(true);}
 const mh=e.target.closest("[data-mod]");if(mh){const mi=+mh.dataset.mod;W.mopen=W.mopen||{};W.mopen[mi]=mh.getAttribute("aria-expanded")!=="true";render(true);return;}
 const t=e.target.closest("[data-done],[data-q],[data-check],[data-retry],[data-ck],[data-ckreset],[data-wf],[data-tr],[data-stp],[data-stnext],[data-reset],[data-run],[data-runmore],[data-jump],[data-tab]");
 if(!t)return;
 const inD=!!t.closest("#acad-drawer"),S=inD?DW:W;
 if(t.dataset.done!=null){const id=t.dataset.done;if(!isDone(id)&&blocker(id))return;P.done[id]=!P.done[id];if(id==="sim"&&!P.done[id]&&simDone()===5)P.done[id]=true;persist(id,{done:!!P.done[id]});render(true);
  if(P.done[id]){const i=FLAT.findIndex(x=>x.id===id),nx=FLAT[i+1];toast(nx?`Готово! Открыт следующий: «${nx.t}»`:"Курс пройден!");}}
 else if(t.dataset.q!=null){const st=P.qs[t.dataset.q];if(st.shown)return;st.ans[+t.dataset.qi]=+t.dataset.o;save();render(true);}
 else if(t.dataset.check!=null){const it=byId[t.dataset.check],st=P.qs[it.id];
  const c=it.quiz.filter((x,i)=>st.ans[i]===x.a).length,pct=Math.round(c/it.quiz.length*100),prev=P.quiz[it.id]||{};
  st.shown=true;P.quiz[it.id]={best:Math.max(prev.best||0,pct),tries:(prev.tries||0)+1,pass:Math.max(prev.best||0,pct)>=80};save();
  persist(it.id,{done:P.quiz[it.id].pass,right:c,total:it.quiz.length,last:pct,best:P.quiz[it.id].best,tries:P.quiz[it.id].tries,pass:P.quiz[it.id].pass,at:new Date().toISOString()});render();scroller().scrollTo({top:0,behavior:"smooth"});}
 else if(t.dataset.retry!=null){P.qs[t.dataset.retry]={ans:{},shown:false};save();render();scroller().scrollTo({top:0,behavior:"smooth"});}
 else if(t.dataset.ck!=null){const k=t.dataset.ck;P.checks[k]=P.checks[k]||{};P.checks[k][t.dataset.i]=!P.checks[k][t.dataset.i];persistChecks(k);rerender(inD);}
 else if(t.dataset.ckreset!=null){P.checks[t.dataset.ckreset]={};persistChecks(t.dataset.ckreset);rerender(inD);}
 else if(t.dataset.wf!=null){S.f=t.dataset.wf;refreshW(inD);}
 else if(t.dataset.tr!=null){const a=t.dataset.tr;if(a==="flip")S.flip=true;else{if(a==="good")S.ok++;if(a==="bad")S.no++;S.flip=false;S.i++;}refreshW(inD);}
 else if(t.dataset.stp!=null){if(S.pick!=null)return;S.pick=+t.dataset.stp;const cur=DATA.ST_AUTO[S.queue[S.i%S.queue.length]];if(S.opts[S.pick].n===cur.n)S.ok++;else S.no++;refreshW(inD);}
 else if(t.dataset.stnext!=null){S.pick=null;S.i++;refreshW(inD);}
 else if(t.dataset.run!=null){P.run=t.dataset.run==="1";save();rerender(inD);}
 else if(t.dataset.runmore!=null){RUNOPEN[t.dataset.runmore]=!RUNOPEN[t.dataset.runmore];rerender(inD);}
 else if(t.dataset.jump!=null){const box=inD?document.querySelector("#acad-drawer .db"):scroller();const el=box.querySelector("#rs"+t.dataset.jump);
  if(el){box.scrollTo({top:el.getBoundingClientRect().top-box.getBoundingClientRect().top+box.scrollTop-56,behavior:"smooth"});el.classList.add("flash");setTimeout(()=>el.classList.remove("flash"),900);}}
 else if(t.dataset.tab!=null){W.tab=t.dataset.tab;PAGEW=null;render(true);}
 else if(t.dataset.reset!=null){if(confirm("Сбросить весь прогресс курса «Авто»? Отметки, тесты и заметки удалятся.")){if(opts.reset)opts.reset();P=fresh();save();try{localStorage.removeItem(SZ_DONE);}catch(err){}for(const k in SZMEM)delete SZMEM[k];render();toast("Прогресс сброшен");}}
});
__on(document,"input",e=>{
 if(e.target.matches("[data-wq]")){const inD=!!e.target.closest("#acad-drawer");(inD?DW:W).q=e.target.value;refreshW(inD);}
 else if(e.target.matches("[data-note]")){P.notes=P.notes||{};const nid=e.target.dataset.note,nv=e.target.value;P.notes[nid]=nv;clearTimeout(noteT);noteT=setTimeout(()=>{persist(nid,{note:nv});renderNav();},600);}
 else if(e.target.id==="palq"){PAL.q=e.target.value;PAL.sel=0;PAL.res=palResults(PAL.q);renderPal();}
});
__on(document,"change",e=>{if(e.target.matches("[data-calc]")){const inD=!!e.target.closest("#acad-drawer");(inD?DW:W)[e.target.dataset.calc]=+e.target.value;refreshW(inD);}});
__on(document,"keydown",e=>{
 if((e.ctrlKey||e.metaKey)&&(e.code==="KeyK"||e.key==="k"||e.key==="л")){e.preventDefault();e.stopPropagation();PAL.open?closePal():openPal();return;}
 if(PAL.open){if(e.key==="Escape"){e.preventDefault();closePal();}
  else if(e.key==="ArrowDown"){e.preventDefault();PAL.sel=Math.min(PAL.res.length-1,PAL.sel+1);renderPal();}
  else if(e.key==="ArrowUp"){e.preventDefault();PAL.sel=Math.max(0,PAL.sel-1);renderPal();}
  else if(e.key==="Enter"){e.preventDefault();runPal(PAL.res[PAL.sel]);}
  return;}
 if(e.key==="Escape"&&DRW.open){e.preventDefault();closeDrawer();}
});

function toast(msg){if(opts.toast)opts.toast(msg);}
render();

 __on(window, "academy:search", () => openPal());
 return {
  destroy() {
   if (typeof SEL !== "undefined" && SEL) selClose();
   __L.forEach(([t, ty, fn, o]) => t.removeEventListener(ty, fn, o));
   DRW_EL.remove(); PAL_EL.remove();
   document.documentElement.style.overflow = "";
  },
 };
}
