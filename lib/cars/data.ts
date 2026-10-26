/**
 * Каталог марок и моделей для «Марок авто» (lib/cars/catalog.ts разбирает его при загрузке).
 *
 * Марка: [id, название, как её называют по-русски (через запятую), страна, метки, статья Википедии].
 *   метки: cn — китайская марка; cnl — местная марка на базе китайских моделей (Tenet, Belgee…);
 *          prem — премиум, которого нет в списках проектов (вердикт «уточнить»).
 *
 * Модель — строка «Название|как называют|годы|кузов|двигатель|особенности|статья Википедии»:
 *   годы — «2015» (с 2015 и по сей день) или «2007-2018»;
 *   кузов — sed седан, hat хэтчбек, lb лифтбек, wag универсал, suv кроссовер, off рамный внедорожник,
 *           cpe купе, cab кабриолет, mpv минивэн, pu пикап, van фургон/«каблук», com коммерческий;
 *           sp — спорткар (как Ford Mustang);
 *   двигатель — g бензин/дизель, h гибрид, p подзаряжаемый гибрид, r электро с запасом хода (EREV), e электро.
 * Статья Википедии — если не «Марка Модель» (по ней берётся фото: scripts/build-car-photos.mjs).
 */

export type BrandSrc = [id: string, name: string, ru: string, country: string, flags: string, wiki?: string];

export const BRANDS: BrandSrc[] = [
  // ── Россия и рядом
  ["lada", "Lada", "лада,ваз,жигули,автоваз", "Россия", "", "Lada"],
  ["uaz", "УАЗ", "uaz,уазик,уаз", "Россия", "", "UAZ"],
  ["gaz", "ГАЗ", "gaz,газ,горьковский", "Россия", "", "GAZ"],
  ["moskvich", "Москвич", "moskvich,москвич", "Россия", "cnl", "Moskvich"],
  ["solaris", "Solaris", "солярис бренд", "Россия", "", "Solaris (Russian car brand)"],
  ["tenet", "Tenet", "тенет", "Россия", "cnl", "Tenet (automobile)"],
  ["xcite", "XCite", "икссайт,экссайт,xcite", "Россия", "cnl", "XCite"],
  ["evolute", "Evolute", "эволют", "Россия", "cnl", "Evolute (automobile)"],
  ["sollers", "Sollers", "соллерс", "Россия", "", "Sollers JSC"],
  ["belgee", "Belgee", "белджи,белжи", "Беларусь", "cnl", "Belgee"],
  ["ravon", "Ravon", "равон", "Узбекистан", "", "Ravon"],
  ["daewoo", "Daewoo", "дэу,деу,девоо,дэо", "Корея / Узбекистан", "", "Daewoo Motors"],

  // ── Китай
  ["haval", "Haval", "хавал,хавейл,хавэйл,хаваль", "Китай", "cn"],
  ["gwm", "Great Wall", "грейт волл,грейтвол,грит вол,gwm", "Китай", "cn", "Great Wall Motors"],
  ["tank", "Tank", "танк", "Китай", "cn", "Tank (automobile)"],
  ["wey", "Wey", "вей,вэй", "Китай", "cn", "Wey (marque)"],
  ["chery", "Chery", "чери,черри,чэри", "Китай", "cn"],
  ["exeed", "Exeed", "эксид,иксид,эксиид", "Китай", "cn"],
  ["omoda", "Omoda", "омода", "Китай", "cn"],
  ["jaecoo", "Jaecoo", "джейку,джеку,жаеку,джаеку", "Китай", "cn"],
  ["jetour", "Jetour", "джетур,джитур,жетур", "Китай", "cn"],
  ["geely", "Geely", "джили,джилли,жили", "Китай", "cn", "Geely Auto"],
  ["zeekr", "Zeekr", "зикр,зикер,зекр", "Китай", "cn"],
  ["lynk", "Lynk & Co", "линк энд ко,линк,линк и ко", "Китай", "cn"],
  ["changan", "Changan", "чанган,чанган,шанган", "Китай", "cn", "Changan Automobile"],
  ["deepal", "Deepal", "дипал", "Китай", "cn"],
  ["avatr", "Avatr", "аватр,аватар", "Китай", "cn", "Avatr Technology"],
  ["kaiyi", "Kaiyi", "кайи,каи,кайй", "Китай", "cn", "Kaiyi Auto"],
  ["livan", "Livan", "ливан", "Китай", "cn", "Livan Automotive"],
  ["gac", "GAC", "гак,гац,джиэйси,trumpchi,трампчи", "Китай", "cn", "GAC Trumpchi"],
  ["hongqi", "Hongqi", "хунци,хончи,хонгчи", "Китай", "cn"],
  ["faw", "FAW", "фав,bestune,бестюн,бестурн", "Китай", "cn", "FAW Group"],
  ["dongfeng", "Dongfeng", "донгфенг,дунфэн,донфенг", "Китай", "cn", "Dongfeng Motor Corporation"],
  ["forthing", "Forthing", "фортинг,форсинг", "Китай", "cn", "Dongfeng Fengxing"],
  ["voyah", "Voyah", "воя,вояж,воях", "Китай", "cn"],
  ["mhero", "M-Hero", "м хиро,мхиро,мэнши", "Китай", "cn", "M-Hero"],
  ["jac", "JAC", "джак,жак", "Китай", "cn", "JAC Motors"],
  ["baic", "BAIC", "баик,байк,баич", "Китай", "cn", "BAIC Motor"],
  ["byd", "BYD", "бид,бэд,бюд,би вай ди", "Китай", "cn", "BYD Auto"],
  ["denza", "Denza", "денза", "Китай", "cn"],
  ["liauto", "Li Auto", "ли авто,лисян,лисиан,ликсианг,lixiang,лейсян", "Китай", "cn", "Li Auto"],
  ["nio", "Nio", "нио", "Китай", "cn", "Nio Inc."],
  ["xpeng", "Xpeng", "икспенг,сяопэн,экспенг", "Китай", "cn"],
  ["aito", "AITO", "аито,seres,серес", "Китай", "cn", "AITO"],
  ["neta", "Neta", "нета,hozon,хозон", "Китай", "cn", "Neta (automobile)"],
  ["leapmotor", "Leapmotor", "липмотор,лип мотор", "Китай", "cn"],
  ["xiaomi", "Xiaomi", "сяоми,ксиаоми", "Китай", "cn", "Xiaomi Auto"],
  ["skywell", "Skywell", "скайвел", "Китай", "cn"],
  ["swm", "SWM", "свм,эсвээм", "Китай", "cn", "SWM (automobile)"],
  ["jetta", "Jetta", "джетта бренд", "Китай", "cn", "Jetta (brand)"],
  ["brilliance", "Brilliance", "бриллианс,брилианс", "Китай", "cn", "Brilliance Auto"],
  ["lifan", "Lifan", "лифан", "Китай", "cn", "Lifan Group"],
  ["zotye", "Zotye", "зоти,зотье,зотай", "Китай", "cn", "Zotye Auto"],
  ["haima", "Haima", "хайма", "Китай", "cn", "Haima Automobile"],
  ["foton", "Foton", "фотон", "Китай", "cn", "Foton Motor"],

  // ── Япония
  ["toyota", "Toyota", "тойота,тайота,тоета,таета,тоёта", "Япония", ""],
  ["lexus", "Lexus", "лексус", "Япония", ""],
  ["nissan", "Nissan", "ниссан,нисан", "Япония", ""],
  ["infiniti", "Infiniti", "инфинити,инфинити", "Япония", ""],
  ["mazda", "Mazda", "мазда", "Япония", ""],
  ["honda", "Honda", "хонда", "Япония", ""],
  ["mitsubishi", "Mitsubishi", "мицубиси,митсубиси,мицубиши,митсубиши,митсубися", "Япония", "", "Mitsubishi Motors"],
  ["subaru", "Subaru", "субару", "Япония", ""],
  ["suzuki", "Suzuki", "сузуки,судзуки", "Япония", ""],
  ["datsun", "Datsun", "датсун,дацун", "Япония", ""],
  ["isuzu", "Isuzu", "исузу,исудзу", "Япония", "", "Isuzu Motors"],
  ["daihatsu", "Daihatsu", "дайхатсу,дайхацу", "Япония", ""],

  // ── Корея
  ["hyundai", "Hyundai", "хендай,хундай,хюндай,хёндэ,хендэ,хенде,хюндэ", "Корея", "", "Hyundai Motor Company"],
  ["kia", "Kia", "киа,кия", "Корея", ""],
  ["genesis", "Genesis", "генезис,дженезис", "Корея", "prem", "Genesis Motor"],
  ["ssangyong", "SsangYong", "санг йонг,сангйонг,ссангйонг,кгм,kgm", "Корея", "", "KG Mobility"],

  // ── Европа
  ["vw", "Volkswagen", "фольксваген,фольц,фольк,вольксваген,vw,фв", "Германия", ""],
  ["skoda", "Skoda", "шкода", "Чехия", "", "Škoda Auto"],
  ["audi", "Audi", "ауди", "Германия", ""],
  ["porsche", "Porsche", "порше,порш", "Германия", ""],
  ["bmw", "BMW", "бмв,бэха,бумер", "Германия", ""],
  ["mini", "Mini", "мини", "Великобритания", "", "Mini (marque)"],
  ["mercedes", "Mercedes-Benz", "мерседес,мерс,мерин,бенц,mercedes", "Германия", ""],
  ["smart", "Smart", "смарт", "Германия", "", "Smart (marque)"],
  ["opel", "Opel", "опель", "Германия", ""],
  ["peugeot", "Peugeot", "пежо", "Франция", ""],
  ["citroen", "Citroen", "ситроен,ситроэн", "Франция", "", "Citroën"],
  ["renault", "Renault", "рено", "Франция", ""],
  ["fiat", "Fiat", "фиат", "Италия", "", "Fiat Automobiles"],
  ["volvo", "Volvo", "вольво", "Швеция", "", "Volvo Cars"],
  ["landrover", "Land Rover", "ленд ровер,лэнд ровер,рендж ровер,ровер", "Великобритания", "prem"],
  ["jaguar", "Jaguar", "ягуар", "Великобритания", "prem", "Jaguar Cars"],
  ["seat", "Seat", "сеат", "Испания", "", "SEAT"],

  // ── США
  ["ford", "Ford", "форд", "США", "", "Ford Motor Company"],
  ["chevrolet", "Chevrolet", "шевроле,шевролет,шеви", "США", ""],
  ["cadillac", "Cadillac", "кадиллак,кадилак", "США", ""],
  ["jeep", "Jeep", "джип", "США", ""],
  ["dodge", "Dodge", "додж", "США", ""],
  ["chrysler", "Chrysler", "крайслер", "США", ""],
  ["lincoln", "Lincoln", "линкольн", "США", "prem", "Lincoln Motor Company"],
  ["tesla", "Tesla", "тесла", "США", "", "Tesla, Inc."],

  // ── дорогие и спортивные
  ["bentley", "Bentley", "бентли", "Великобритания", "prem"],
  ["rollsroyce", "Rolls-Royce", "роллс ройс,ролс ройс", "Великобритания", "prem", "Rolls-Royce Motor Cars"],
  ["maserati", "Maserati", "мазерати", "Италия", "prem"],
  ["ferrari", "Ferrari", "феррари", "Италия", "prem"],
  ["lamborghini", "Lamborghini", "ламборгини,ламба", "Италия", "prem"],
  ["astonmartin", "Aston Martin", "астон мартин", "Великобритания", "prem"],
];

/** Модели по маркам: строка на модель (формат — в шапке файла). */
export const MODELS: Record<string, string> = {
  lada: `
Granta|гранта,гранта лифтбек,гранта кросс|2011|sed lb hat wag|g|самая массовая Lada
Vesta|веста,веста кросс,веста sw,веста св|2015|sed wag|g|
XRAY|иксрей,хрей,х рей|2015-2022|hat|g|
Largus|ларгус|2012|wag|g|универсал, есть 7-местная версия|Lada Largus
Largus Фургон|ларгус фургон|2012|van|g|грузовой «каблук»|Lada Largus
Niva Legend|нива,нива легенд,4x4,4х4,21214,2121,урбан,нива урбан|1977|off|g|полный привод, 3 и 5 дверей|Lada Niva Legend
Niva Travel|нива тревел,шевроле нива,шнива,шевик,шевинива|2002|suv|g|бывшая Chevrolet Niva|Lada Niva Travel
Priora|приора|2007-2018|sed hat wag|g|
Kalina|калина|2004-2018|hat wag sed|g|
Samara|самара,2114,2115,2113,2109,2108,2199,четырка,пятнашка,девятка,зубило|1984-2013|hat sed|g|Lada Samara
2110|десятка,2110,2111,2112,двенашка,ваз 2110|1995-2014|sed wag hat|g||Lada 110
Классика|классика,2107,2105,2106,2104,семерка,пятерка,шестерка,жигули|1970-2012|sed wag|g|старые «Жигули»|Lada Riva
Iskra|искра|2025|sed lb wag|g|новая модель 2025 года|Lada Iskra
Aura|аура|2024|sed|g|бизнес-седан на базе Vesta|Lada Aura
Azimut|азимут|2025|suv|g|кроссовер|Lada Azimut`,
  uaz: `
Patriot|патриот|2005|off|g|рамный, полный привод|UAZ Patriot
Hunter|хантер,469,уаз 469,козел|1972|off|g|рамный, «469-й»|UAZ Hunter
Pickup|пикап уаз,уаз пикап|2008|pu|g|рамный пикап|UAZ Pickup
Profi|профи|2017|com|g|грузовик|ru:УАЗ Профи
Буханка|буханка,батон,452,3909,2206,3303,головастик,sgr|1965|van com|g|грузопассажирский|UAZ-452`,
  gaz: `
Газель|газель,газель next,газель некст,газель бизнес,некст,3302|1994|com|g|коммерческий|GAZelle
Соболь|соболь,соболь баргузин,баргузин|1998|com van|g|коммерческий|GAZ Sobol
Валдай|валдай|2004|com|g|грузовик|ru:ГАЗ-3310
Волга|волга,31105,3110,31029,24,волга сайбер,сайбер,siber|1970-2010|sed|g|«Волга»|GAZ Volga`,
  moskvich: `
3|москвич 3,москвич3|2022|suv|g|на базе JAC JS4|Moskvich 3
3e|москвич 3е,москвич 3e|2022|suv|e|электро, на базе JAC|Moskvich 3
6|москвич 6|2024|lb|g|лифтбек на базе JAC|Moskvich 6
8|москвич 8|2025|suv|g|кроссовер на базе JAC|Moskvich 8`,
  solaris: `
KRS|крс|2024|sed|g|бывший Hyundai Solaris|Hyundai Accent
KRX|крх,крикс|2024|hat|g|бывший Kia Rio X|Kia Rio
HS|хс,эйч эс|2024|suv|g|кроссовер|-`,
  tenet: `
T4|т4|2025|suv|g|на базе Chery Tiggo 4|Chery Tiggo 4
T7|т7|2025|suv|g|на базе Chery Tiggo 7 Pro|Chery Tiggo 7
T8|т8|2025|suv|g|на базе Chery Tiggo 8 Pro, 7 мест|Chery Tiggo 8`,
  xcite: `
X-Cross 7|х кросс 7,икс кросс 7,кросс 7|2023|suv|g|на базе Chery Tiggo 7 Pro|Chery Tiggo 7`,
  evolute: `
i-Pro|ай про,i pro|2022|sed|e|электро|Evolute i-Pro
i-Joy|ай джой,i joy|2022|suv|e|электро|Evolute i-Joy
i-Space|ай спейс|2023|suv|r e|электро и с запасом хода|Evolute i-Space
i-Sky|ай скай|2024|suv|e|электро|Evolute i-Sky`,
  sollers: `
Argo|арго|2022|com|g|коммерческий|Sollers Argo
SP7|сп7|2024|pu|g|пикап|Sollers SP7`,
  belgee: `
X50|х50|2023|suv|g|на базе Geely Coolray|Belgee X50
X70|х70|2024|suv|g|на базе Geely|Belgee X70
S50|с50|2024|sed|g|на базе Geely Emgrand|Belgee S50`,
  ravon: `
R2|р2|2016-2020|hat|g|бывший Chevrolet Spark|Ravon R2
R4|р4|2016-2020|sed|g|бывший Chevrolet Cobalt|Ravon R4
Nexia R3|нексия р3,р3|2016-2020|sed|g|бывший Chevrolet Aveo|Chevrolet Aveo (T250)
Gentra|джентра равон|2015-2020|sed|g|бывший Daewoo Gentra|Chevrolet Lacetti`,
  daewoo: `
Matiz|матиз|1998-2015|hat|g||Daewoo Matiz
Nexia|нексия,нексиа|1994-2016|sed hat|g||Daewoo Nexia
Gentra|джентра|2013-2016|sed|g|бывший Chevrolet Lacetti|Chevrolet Lacetti
Lanos|ланос,сенс,sens|1997-2009|sed hat|g||Daewoo Lanos
Nubira|нубира|1997-2002|sed wag|g|
Espero|эсперо|1990-1999|sed|g|
Damas|дамас|1991|com|g|микроавтобус|Daewoo Damas`,

  haval: `
Jolion|джолион,жолион,джолеон|2021|suv|g h|есть гибрид HEV|Haval Jolion
F7|ф7,ф 7|2019|suv|g|Haval F7
F7x|ф7х,ф7 х|2019|suv|g|купе-кроссовер|Haval F7
H6|н6,х6 хавал,аш6|2011|suv|g h p|есть гибрид и подзаряжаемый гибрид|Haval H6
H9|н9,х9 хавал|2014|off|g|рамный, 7 мест|Haval H9
Dargo|дарго|2022|suv|g|Haval Dargo
Dargo X|дарго х,дарго икс|2023|suv|g||Haval Dargo
H5|н5,х5 хавал|2023|off|g|рамный|Haval H5
M6|м6|2023|suv|g|Haval M6
H2|н2|2014-2021|suv|g|Haval H2
H8|н8|2014-2018|suv|g|Haval H8
H6 Coupe|н6 купе|2015-2021|suv|g|купе-кроссовер|Haval H6 Coupe`,
  gwm: `
Hover H3|ховер н3,ховер h3,ховер|2005-2016|off|g|рамный|Great Wall Hover H3
Hover H5|ховер н5,ховер h5|2010-2017|off|g|рамный|Great Wall Hover H5
Wingle|вингл,вингл 7|2006|pu|g|пикап|Great Wall Wingle
Poer|поер,пао,пауэр|2019|pu|g|пикап|Great Wall Poer
Safe|сейф|2001-2010|off|g|рамный|Great Wall Safe`,
  tank: `
300|танк 300,т300|2021|off|g h p|рамный, есть гибрид Hi4-T|Tank 300
400|танк 400,т400|2023|off|g p|рамный, есть подзаряжаемый гибрид|Tank 400
500|танк 500,т500|2022|off|g h p|рамный, 7 мест|Tank 500
700|танк 700,т700|2024|off|p|подзаряжаемый гибрид|Tank 700`,
  wey: `
Coffee 01|кофе 01|2021|suv|p|подзаряжаемый гибрид|Wey Coffee 01
Coffee 02|кофе 02|2022|suv|p|подзаряжаемый гибрид|Wey Coffee 02
07|вей 07,wey 07|2024|suv|p|подзаряжаемый гибрид|Wey 07
80|вей 80,wey 80|2024|mpv|p|минивэн, подзаряжаемый гибрид|Wey 80`,
  chery: `
Tiggo 4|тигго 4,тиго 4,тигго4|2019|suv|g|Chery Tiggo 4
Tiggo 4 Pro|тигго 4 про,тиго 4 про|2022|suv|g|Chery Tiggo 4
Tiggo 7|тигго 7,тиго 7|2016|suv|g|Chery Tiggo 7
Tiggo 7 Pro|тигго 7 про,тиго 7 про|2020|suv|g|Chery Tiggo 7
Tiggo 7 Pro Max|тигго 7 про макс,тиго 7 макс|2022|suv|g p|есть подзаряжаемый гибрид|Chery Tiggo 7
Tiggo 8|тигго 8,тиго 8|2019|suv|g|7 мест|Chery Tiggo 8
Tiggo 8 Pro|тигго 8 про,тиго 8 про|2021|suv|g p|7 мест, есть подзаряжаемый гибрид|Chery Tiggo 8
Tiggo 8 Pro Max|тигго 8 про макс,тиго 8 макс|2022|suv|g|7 мест|Chery Tiggo 8
Tiggo 9|тигго 9,тиго 9|2024|suv|g p|7 мест, есть подзаряжаемый гибрид|Chery Tiggo 9
Tiggo 2 Pro|тигго 2,тигго 2 про|2021|suv|g|Chery Tiggo 2
Tiggo 3|тигго 3,тиго 3|2014-2020|suv|g|Chery Tiggo 3
Tiggo 5|тигго 5,тиго 5|2014-2020|suv|g|Chery Tiggo 5
Tiggo|тигго,тиго|2005-2016|suv|g|первый Tiggo (T11)|Chery Tiggo
Arrizo 8|арризо 8,аризо 8|2023|sed|g|Chery Arrizo 8
Arrizo 5|арризо 5,аризо 5|2016|sed|g|Chery Arrizo 5
Arrizo 7|арризо 7,аризо 7|2013-2020|sed|g|Chery Arrizo 7
Bonus|бонус,а13|2011-2016|lb|g|Chery A13
Very|вери,вэри|2011-2016|hat|g|Chery A13
Amulet|амулет,а15|2003-2012|sed|g|Chery Amulet
Fora|фора,а21|2006-2010|sed|g|Chery A5
M11|м11|2008-2015|sed hat|g|Chery M11
Kimo|кимо|2007-2013|hat|g|Chery A1
Indis|индис|2011-2015|hat|g|Chery Indis
QQ|кукушка,qq|2003-2013|hat|g|Chery QQ`,
  exeed: `
TXL|тхл,тиэксэл,txl|2019|suv|g|Exeed TXL
LX|лх,лэкс|2021|suv|g|Exeed LX
VX|вх,ви икс|2021|suv|g|7 мест|Exeed VX
RX|рх,эр икс|2023|suv|g p|есть подзаряжаемый гибрид|Exeed RX
Exlantix ES|экслантикс эс,экслантикс,эксланикс|2024|sed|e r|электро и с запасом хода|Exeed Exlantix ES
Exlantix ET|экслантикс ет,экслантикс|2024|suv|e r|электро и с запасом хода|Exeed Exlantix ET`,
  omoda: `
C5|с5,ц5,омода с5|2022|suv|g e|есть электро-версия E5|Omoda 5
S5|с5 седан,s5|2023|sed|g|Omoda S5
C7|с7,ц7|2025|suv|g p|есть подзаряжаемый гибрид|Omoda 7
E5|е5|2024|suv|e|электро|Omoda 5`,
  jaecoo: `
J7|джей7,ж7,джейку 7|2023|suv|g p|есть подзаряжаемый гибрид|Jaecoo J7
J8|джей8,ж8,джейку 8|2024|suv|g p|7 мест, есть подзаряжаемый гибрид|Jaecoo J8
J5|джей5,ж5|2025|suv|g e|есть электро|Jaecoo J5`,
  jetour: `
Dashing|дашинг,дешинг,дэшинг|2022|suv|g|Jetour Dashing
X70|х70,икс 70|2020|suv|g|7 мест|Jetour X70
X70 Plus|х70 плюс|2021|suv|g|7 мест|Jetour X70
X90 Plus|х90 плюс,х90|2021|suv|g|7 мест|Jetour X90
X50|х50|2023|suv|g|Jetour X50
T2|т2,traveller,трэвеллер,травеллер|2023|off|g p|внедорожник, есть подзаряжаемый гибрид|Jetour Traveller
T1|т1|2025|off|g p|есть подзаряжаемый гибрид|Jetour T1`,
  geely: `
Coolray|кулрей,кулрэй,кул рей,куллрей|2019|suv|g|Geely Binyue
Atlas|атлас,атлас новый|2017|suv|g|новое поколение с 2023|Geely Atlas
Atlas Pro|атлас про|2021|suv|g|Geely Atlas
Tugella|тугелла,тугела|2020|suv|g|купе-кроссовер|Geely Xingyue
Monjaro|монджаро,монжаро,манджаро|2022|suv|g|Geely Xingyue L
Emgrand|эмгранд,эмгрант|2009|sed|g|новое поколение с 2023|Geely Emgrand
Emgrand X7|эмгранд х7,х7 джили|2011-2020|suv|g|Geely Emgrand X7
Okavango|окаванго|2020|suv|g|7 мест|Geely Haoyue
Preface|префейс,префэйс|2020|sed|g|Geely Preface
Cityray|ситирей,сити рей|2024|suv|g|Geely Boyue Cool
Starray|старрей,стар рей|2024|suv|g|Geely Boyue L
Galaxy L7|галакси л7,галакси|2023|suv|p|подзаряжаемый гибрид|Geely Galaxy L7
Galaxy E5|галакси е5|2024|suv|e|электро|Geely Galaxy E5
EX5|ех5|2024|suv|e|электро|Geely Galaxy E5
MK|мк,мк кросс|2006-2015|sed hat|g|Geely MK
GC6|гц6,гс6|2014-2017|sed|g|ru:Geely GC6
Otaka|отака,ck|2005-2013|sed|g|Geely CK`,
  zeekr: `
001|зикр 001,001|2021|lb|e|электро|Zeekr 001
007|зикр 007,007|2023|sed|e|электро|Zeekr 007
7X|зикр 7х,7х|2024|suv|e|электро|Zeekr 7X
X|зикр х,зикр икс|2023|suv|e|электро|Zeekr X
009|зикр 009,009|2022|mpv|e|минивэн, электро|Zeekr 009`,
  lynk: `
01|линк 01|2017|suv|g h p|есть гибриды|Lynk & Co 01
03|линк 03|2018|sed|g|Lynk & Co 03
05|линк 05|2019|suv|g p|купе-кроссовер|Lynk & Co 05
06|линк 06|2020|suv|g p|Lynk & Co 06
08|линк 08|2023|suv|p|подзаряжаемый гибрид|Lynk & Co 08
09|линк 09|2021|suv|g p|7 мест|Lynk & Co 09`,
  changan: `
CS35 Plus|цс35,сс35,кс35,цс 35 плюс|2018|suv|g|Changan CS35
CS55 Plus|цс55,сс55,кс55,цс 55 плюс|2021|suv|g|Changan CS55
CS75 Plus|цс75,сс75,кс75,цс 75 плюс|2019|suv|g|Changan CS75
CS75|цс75 старый|2013-2019|suv|g|Changan CS75
CS85 Coupe|цс85,сс85|2019|suv|g|купе-кроссовер|Changan CS85
CS95|цс95,сс95|2017|suv|g|7 мест|Changan CS95
UNI-K|юни к,уни к,юник|2021|suv|g p|есть подзаряжаемый гибрид|Changan UNI-K
UNI-V|юни в,уни в,юнив|2022|lb|g|лифтбек|Changan UNI-V
UNI-T|юни т,уни т|2020|suv|g|Changan UNI-T
UNI-S|юни с,уни с|2023|suv|g p|есть подзаряжаемый гибрид|Changan UNI-S
Alsvin|алсвин,алсвин|2018|sed|g|Changan Alsvin
Eado|эадо,идо,eado plus|2012|sed|g|Changan Eado
Lamore|ламор,ламоре|2023|sed|g|Changan Lamore
X5 Plus|х5 плюс,икс 5 плюс,ошан х5|2022|suv|g|Changan Oshan X5
Hunter|хантер чанган,хантер плюс|2023|pu|g r|пикап, есть с запасом хода|Changan Hunter`,
  deepal: `
S07|с07,s07|2023|suv|e r|электро и с запасом хода|Deepal S7
SL03|сл03,l07|2022|sed|e r|электро и с запасом хода|Deepal SL03
G318|г318|2024|off|r|с запасом хода|Deepal G318
S05|с05|2025|suv|e r|электро и с запасом хода|Deepal S05`,
  avatr: `
11|аватр 11|2022|suv|e r|электро и с запасом хода|Avatr 11
12|аватр 12|2023|lb|e r|электро и с запасом хода|Avatr 12
07|аватр 07|2024|suv|e r|электро и с запасом хода|Avatr 07`,
  kaiyi: `
E5|е5 кайи|2022|sed|g|Kaiyi E5
X3 Pro|х3 про|2022|suv|g|Kaiyi X3
X7 Kunlun|х7 кунлун,кунлун|2023|suv|g|7 мест|Kaiyi X7`,
  livan: `
X3 Pro|х3 про ливан|2023|suv|g|Livan X3 Pro
X6 Pro|х6 про|2023|suv|g|Livan X6 Pro
S6 Pro|с6 про|2023|sed|g|-
7|ливан 7|2024|suv|e|электро|Livan 7`,
  gac: `
GS3|гс3,джиэс3|2017|suv|g|GAC Trumpchi GS3
GS4|гс4|2015|suv|g|GAC Trumpchi GS4
GS8|гс8|2016|suv|g h|7 мест, есть гибрид|GAC Trumpchi GS8
GN8|гн8|2019|mpv|g h|минивэн|-
M8|м8 гак|2017|mpv|g h p|минивэн|GAC Trumpchi M8
Emzoom|эмзум|2023|suv|g|GAC Trumpchi Emzoom
Empow|эмпау,эмпов|2021|sed|g|GAC Trumpchi Empow
Aion S|аион с|2019|sed|e|электро|Aion S
Aion Y|аион у,аион й|2021|suv|e|электро|Aion Y`,
  hongqi: `
H5|н5 хунци|2017|sed|g|Hongqi H5
H6|н6 хунци|2022|sed|g|Hongqi H6
H9|н9 хунци|2020|sed|g h|бизнес-седан|Hongqi H9
HS5|хс5,нс5|2019|suv|g|Hongqi HS5
HS7|хс7,нс7|2019|suv|g|Hongqi HS7
E-HS9|ехс9,е хс9|2020|suv|e|электро|Hongqi E-HS9
HQ9|хк9|2024|mpv|p|минивэн, подзаряжаемый гибрид|Hongqi HQ9`,
  faw: `
Bestune T77|бестюн т77,т77|2018|suv|g|Bestune T77
Bestune T55|бестюн т55,т55|2021|suv|g|Bestune T55
Bestune T90|бестюн т90,т90|2019|suv|g|Bestune T90
Bestune B70|бестюн б70,б70|2006|sed|g|Bestune B70
Besturn B50|бестурн б50,б50|2009-2016|sed|g|Besturn B50
V5|в5 фав|2012-2016|sed|g|FAW V5`,
  dongfeng: `
AX7|ах7,ax 7|2014|suv|g|Dongfeng Fengshen AX7
580|глори 580,glory 580,дф580|2016|suv|g|7 мест|Dongfeng Fengguang 580
Shine Max|шайн макс,шайн|2023|sed|g|Dongfeng Aeolus Shine Max
Huge|хьюдж,хьюж|2023|suv|g h|есть гибрид|Dongfeng Aeolus Huge
Mage|мейдж,мэйдж|2024|suv|g|Dongfeng Mage
H30 Cross|н30 кросс|2011-2017|hat|g|Dongfeng H30
Rich|рич|2006|pu|g|пикап|Dongfeng Rich
Captain|капитан|2013|com|g|грузовик|Dongfeng Captain`,
  forthing: `
T5 Evo|т5 эво,т5|2020|suv|g|Forthing T5 Evo
Friday|фрайдей|2023|suv|e r|электро и с запасом хода|Forthing Friday
U-Tour|ю тур,у тур|2023|mpv|g|минивэн|Forthing U-Tour`,
  voyah: `
Free|фри,воя фри|2021|suv|e r|электро и с запасом хода|Voyah Free
Dream|дрим|2022|mpv|e p|минивэн|Voyah Dream
Passion|пэшн,пассион|2024|sed|e|электро|Voyah Passion
Courage|кураж|2024|suv|e r|электро и с запасом хода|Voyah Courage`,
  mhero: `
917|м хиро 917,917|2023|off|e r|внедорожник, электро и с запасом хода|M-Hero 917`,
  jac: `
S3|с3 джак|2013|suv|g|JAC Refine S3
S5|с5 джак|2013|suv|g|JAC Refine S5
S7|с7 джак|2017|suv|g|JAC Refine S7
JS4|джс4,жс4|2021|suv|g|JAC JS4
J7|дж7,ж7 джак|2020|lb|g|лифтбек|JAC J7
T6|т6 джак|2015|pu|g|пикап|JAC T6
T8|т8 джак|2018|pu|g|пикап|JAC T8
T9|т9 джак|2022|pu|g|пикап|JAC T9
N-серия|н серия,n56,n80,n90,n120|2017|com|g|грузовик|-
Sunray|санрэй,санрей|2011|com|g|микроавтобус|JAC Sunray`,
  baic: `
X35|х35 баик|2017|suv|g|BAIC Senova X35
X55|х55 баик|2022|suv|g|BAIC X55
X7|х7 баик|2020|suv|g|BAIC X7
BJ40|бж40,бдж40,bj 40|2014|off|g|рамный внедорожник|BAIC BJ40
BJ60|бж60,бдж60|2022|off|g h|рамный, есть гибрид|BAIC BJ60
U5 Plus|у5 плюс,ю5|2021|sed|g|BAIC U5 Plus`,
  byd: `
Song Plus|сонг плюс,сун плюс|2020|suv|p e|подзаряжаемый гибрид и электро|BYD Song Plus
Song L|сонг л|2024|suv|e p|BYD Song L
Han|хан,бид хан|2020|sed|e p|электро и подзаряжаемый гибрид|BYD Han
Seal|сил,сеал|2022|sed|e|электро|BYD Seal
Seal U|сил ю,сеал у|2023|suv|p e|BYD Seal U
Tang|тан,танг|2015|suv|p e|7 мест|BYD Tang
Qin Plus|цинь плюс,кин плюс|2021|sed|p e|BYD Qin Plus
Yuan Plus|юань плюс,atto 3,атто 3|2022|suv|e|электро|BYD Atto 3
Dolphin|долфин,дельфин|2021|hat|e|электро|BYD Dolphin
Seagull|сигал,чайка|2023|hat|e|электро|BYD Seagull
F3|ф3 бид|2005-2014|sed|g|бензин|BYD F3`,
  denza: `
D9|д9,денза д9|2022|mpv|p e|минивэн|Denza D9`,
  liauto: `
L6|л6,ли л6,лисян л6|2024|suv|r|с запасом хода (EREV)|Li L6
L7|л7,ли л7,лисян л7|2023|suv|r|с запасом хода (EREV)|Li L7
L8|л8,ли л8|2022|suv|r|с запасом хода (EREV), 6 мест|Li L8
L9|л9,ли л9,лисян л9|2022|suv|r|с запасом хода (EREV), 6 мест|Li L9
One|ли ван,ли one|2019-2022|suv|r|с запасом хода (EREV)|Li One
Mega|мега|2024|mpv|e|минивэн, электро|Li Mega`,
  nio: `
ES6|ес6|2018|suv|e|электро|Nio ES6
ES8|ес8|2018|suv|e|электро, 6–7 мест|Nio ES8
ET5|ет5|2022|sed|e|электро|Nio ET5
EC6|ец6|2020|suv|e|электро|Nio EC6`,
  xpeng: `
G6|г6|2023|suv|e|электро|Xpeng G6
G9|г9|2022|suv|e|электро|Xpeng G9
P7|п7|2020|sed|e|электро|Xpeng P7
X9|х9 икспенг|2024|mpv|e|минивэн, электро|Xpeng X9`,
  aito: `
M5|м5 аито,аито м5|2022|suv|r e|с запасом хода и электро|AITO M5
M7|м7 аито,аито м7|2022|suv|r e|с запасом хода и электро|AITO M7
M9|м9 аито,аито м9|2023|suv|r e|с запасом хода и электро|AITO M9`,
  neta: `
U|нета у,нета ю|2020|suv|e|электро|Neta U
V|нета в,нета ви|2020|suv|e|электро|Neta V
S|нета с,нета эс|2022|sed|e r|Neta S`,
  leapmotor: `
C10|ц10,с10|2023|suv|e r|электро и с запасом хода|Leapmotor C10
C11|ц11,с11|2021|suv|e r|электро и с запасом хода|Leapmotor C11
C16|ц16,с16|2024|suv|e r|6 мест|Leapmotor C16`,
  xiaomi: `
SU7|су7,сяоми су7|2024|sed|e|электро|Xiaomi SU7`,
  skywell: `
ET5|ет5 скайвел|2021|suv|e|электро|Skywell ET5`,
  swm: `
G01|г01|2019|suv|g|SWM G01
G05|г05|2019|suv|g|SWM G05`,
  jetta: `
VA3|ва3|2019|sed|g|Jetta VA3
VS5|вс5|2019|suv|g|Jetta VS5
VS7|вс7|2020|suv|g|Jetta VS7`,
  brilliance: `
V5|в5 бриллианс|2012-2019|suv|g|Brilliance V5
H230|н230|2012-2018|sed hat|g|Brilliance H230
M2|м2 бриллианс,bs4|2006-2013|sed|g|Brilliance BS4`,
  lifan: `
Solano|солано|2008-2019|sed|g|Lifan 620
X60|х60 лифан|2011-2019|suv|g|Lifan X60
Smily|смайли|2008-2018|hat|g|Lifan 320
Breez|бриз|2006-2012|sed hat|g|Lifan 520
Cebrium|цебриум,себриум|2014-2018|sed|g|Lifan 720
Murman|мурман|2015-2019|sed|g|Lifan 820
X50|х50 лифан|2015-2019|suv|g|Lifan X50
Myway|майвей|2016-2019|suv|g|Lifan Myway`,
  zotye: `
T600|т600|2013-2020|suv|g|Zotye T600
Coupa|купа|2017-2020|suv|g|Zotye T600`,
  haima: `
7|хайма 7|2013-2019|suv|g|Haima 7
3|хайма 3|2010-2016|sed hat|g|Haima 3`,
  foton: `
Sauvana|саувана,соувана|2015|off|g|рамный внедорожник|Foton Sauvana
Tunland|тунланд|2012|pu|g|пикап|Foton Tunland
Aumark|аумарк|2005|com|g|грузовик|Foton Aumark
View|вью,фотон вью|2006|com|g|микроавтобус|Foton View`,

  toyota: `
Camry|камри,камрюха,камри 40,камри 50,камри 55,камри 70,камри 80|1982|sed|g h|бизнес-седан; с 2024 только гибрид|Toyota Camry
Corolla|королла,корола|1966|sed hat wag|g h|есть гибрид|Toyota Corolla
Corolla Cross|королла кросс|2020|suv|g h|есть гибрид|Toyota Corolla Cross
RAV4|рав4,рав 4,рафик,раф,рав|1994|suv|g h p|есть гибрид и подзаряжаемый гибрид|Toyota RAV4
Land Cruiser Prado|прадо,прадик,лк прадо,ленд крузер прадо,120,150,250,прадо 250|1996|off|g h|рамный|Toyota Land Cruiser Prado
Land Cruiser 100|сотка,крузак 100,лк 100,ленд крузер 100,100-ка|1998-2007|off|g|рамный|Toyota Land Cruiser (J100)
Land Cruiser 200|крузак,двухсотый,лк 200,ленд крузер 200,крузак 200|2007-2021|off|g|рамный|Toyota Land Cruiser (J200)
Land Cruiser 300|лк 300,трехсотый,крузак 300,ленд крузер 300|2021|off|g h|рамный|Toyota Land Cruiser (J300)
Highlander|хайлендер,хайландер|2000|suv|g h|7 мест, есть гибрид|Toyota Highlander
Fortuner|фортунер|2005|off|g|рамный, 7 мест|Toyota Fortuner
Hilux|хайлюкс,хайлакс,хилюкс|1968|pu|g|пикап|Toyota Hilux
C-HR|чр,с хр,сихр,с-хр|2016|suv|g h|есть гибрид|Toyota C-HR
Venza|венза|2008|suv|g h|с 2020 только гибрид|Toyota Venza
Auris|аурис|2006-2018|hat wag|g h|Toyota Auris
Avensis|авенсис|1997-2018|sed wag|g|Toyota Avensis
Yaris|ярис|1999|hat sed|g h|Toyota Yaris
Prius|приус|1997|lb|h p|только гибрид|Toyota Prius
Aqua|аква|2011|hat|h|только гибрид|Toyota Aqua
Alphard|альфард,альфарт|2002|mpv|g h|минивэн|Toyota Alphard
Sienna|сиенна,сиена|1997|mpv|g h|минивэн|Toyota Sienna
Previa|превиа,эстима,estima|1990-2019|mpv|g h|минивэн|Toyota Previa
Noah|ноах,ноа,voxy,вокси|2001|mpv|g h|минивэн|Toyota Noah
Wish|виш|2003-2017|mpv|g|минивэн|Toyota Wish
Hiace|хайс,хайэйс|1967|com|g|микроавтобус|Toyota HiAce
4Runner|форраннер,4раннер,фо раннер|1984|off|g|рамный|Toyota 4Runner
Sequoia|секвойя|2000|off|g h|рамный, большой|Toyota Sequoia
Tundra|тундра|1999|pu|g h|пикап|Toyota Tundra
FJ Cruiser|фж крузер,фдж|2006-2022|off|g|рамный|Toyota FJ Cruiser
Mark X|марк икс,марк х,марк 2,марк ii|2004-2019|sed|g|Toyota Mark X
Crown|кроун,краун|1955|sed suv|g h|Toyota Crown
Harrier|харриер,харьер|1997|suv|g h|есть гибрид|Toyota Harrier
Premio|премио,аллион,allion|2001-2021|sed|g|правый руль|Toyota Premio
Corolla Fielder|филдер,королла филдер|2000-2024|wag|g h|правый руль|Toyota Corolla Fielder
Vitz|витц|1999-2020|hat|g h|правый руль|Toyota Vitz
Probox|пробокс,саксид,succeed|2002|wag van|g h|правый руль|Toyota Probox
Rush|раш|2006|suv|g|Toyota Rush
Frontlander|фронтлендер|2024|suv|g h|Toyota Frontlander
bZ4X|бз4х|2022|suv|e|электро|Toyota bZ4X
Supra|супра|1978|cpe sp|g|спорткар|Toyota Supra
GT86|гт86,гт 86,gr86|2012|cpe sp|g|спорткар|Toyota 86`,
  lexus: `
RX|рх,эрикс,лексус рх|1998|suv|g h|Lexus RX
NX|нх,лексус нх|2014|suv|g h p|Lexus NX
LX|лх,лексус лх|1995|off|g|рамный|Lexus LX
GX|гх,лексус гх|2002|off|g|рамный|Lexus GX
ES|ес,лексус ес|1989|sed|g h|Lexus ES
IS|ис,лексус ис|1998|sed|g h|Lexus IS
UX|ух,лексус ух|2018|suv|g h e|Lexus UX
LS|лс,лексус лс|1989|sed|g h|Lexus LS
RC|рц,лексус рц|2014|cpe|g h|Lexus RC
LM|лм,лексус лм|2019|mpv|h|минивэн|Lexus LM`,
  nissan: `
Almera|альмера,альмера классик|2000-2018|sed hat|g|Nissan Almera
Tiida|тиида,тида|2004|hat sed|g|Nissan Tiida
Note|ноут,нот|2004|hat|g h|Nissan Note
Juke|жук,джук|2010|suv|g h|Nissan Juke
Qashqai|кашкай,кашкай+2|2006|suv|g h|Nissan Qashqai
X-Trail|икстрейл,х трейл,хтрейл,экстрейл,кстрейл|2000|suv|g h|есть гибрид e-Power|Nissan X-Trail
Murano|мурано|2002|suv|g h|Nissan Murano
Pathfinder|патфайндер|1985|off suv|g h|Nissan Pathfinder
Patrol|патрол,патруль|1951|off|g|рамный|Nissan Patrol
Navara|навара,np300|1997|pu|g|пикап|Nissan Navara
Terrano|террано|2014-2022|suv|g|на базе Renault Duster|Dacia Duster
Teana|теана|2003-2020|sed|g|Nissan Teana
Sentra|сентра|1982|sed|g|Nissan Sentra
Primera|примера|1990-2008|sed hat wag|g|Nissan Primera
Micra|микра,марч|1982|hat|g|Nissan Micra
Leaf|лиф,лиаф|2010|hat|e|электро|Nissan Leaf
Serena|серена|1991|mpv|g h|минивэн|Nissan Serena
Elgrand|элгранд|1997|mpv|g|минивэн|Nissan Elgrand
Wingroad|вингроуд|1996-2018|wag|g|правый руль|Nissan Wingroad
Cube|куб|1998-2019|hat|g|Nissan Cube
Kicks|кикс|2016|suv|g h|Nissan Kicks
Skyline|скайлайн|1957|sed cpe|g h|Nissan Skyline
GT-R|гтр,гт-р|2007|cpe sp|g|спорткар|Nissan GT-R
370Z|370з,z|2009|cpe sp|g|спорткар|Nissan 370Z`,
  infiniti: `
QX50|кх50,ку икс 50|2013|suv|g|Infiniti QX50
QX60|кх60,jx|2012|suv|g h|7 мест|Infiniti QX60
QX70|кх70,fx,фх|2003-2017|suv|g|Infiniti FX
QX80|кх80,qx56,кх56|2010|off|g|рамный|Infiniti QX80
Q50|кю50,ку50|2013|sed|g h|Infiniti Q50
Q70|кю70,m|2010-2019|sed|g h|Infiniti M
EX|ех,qx50 старый|2007-2017|suv|g|Infiniti EX`,
  mazda: `
3|мазда 3,трешка,axela,аксела|2003|sed hat|g|Mazda3
6|мазда 6,шестерка,atenza,атенза|2002|sed wag|g|Mazda6
CX-5|сх5,сх 5,цх5|2012|suv|g|Mazda CX-5
CX-7|сх7,цх7|2006-2012|suv|g|Mazda CX-7
CX-9|сх9,цх9|2006-2023|suv|g|7 мест|Mazda CX-9
CX-30|сх30|2019|suv|g|Mazda CX-30
CX-60|сх60|2022|suv|g p|есть подзаряжаемый гибрид|Mazda CX-60
CX-90|сх90|2023|suv|g p|7 мест|Mazda CX-90
CX-3|сх3|2015|suv|g|Mazda CX-3
2|мазда 2,demio,демио|1996|hat sed|g|Mazda2
5|мазда 5,премаси,premacy|1999-2018|mpv|g|минивэн|Mazda Premacy
BT-50|бт50|2006|pu|g|пикап|Mazda BT-50
MX-5|мх5,миата,miata|1989|cab sp|g|кабриолет|Mazda MX-5
RX-8|рх8,рх 8|2003-2012|cpe sp|g|спорткар|Mazda RX-8
Tribute|трибьют|2000-2011|suv|g|Mazda Tribute`,
  honda: `
Civic|цивик,сивик|1972|sed hat|g h|Honda Civic
Accord|аккорд,акорд|1976|sed|g h|Honda Accord
CR-V|црв,срв,цр в,цирв|1995|suv|g h|есть гибрид|Honda CR-V
Pilot|пилот|2002|suv|g|7 мест|Honda Pilot
Fit|фит,jazz,джаз|2001|hat|g h|Honda Fit
HR-V|хрв,vezel,везел|1998|suv|g h|есть гибрид|Honda HR-V
Stepwgn|степвагон,степ вагон|1996|mpv|g h|минивэн|Honda Stepwgn
Odyssey|одиссей|1994|mpv|g h|минивэн|Honda Odyssey
Freed|фрид|2008|mpv|g h|минивэн|Honda Freed
Insight|инсайт|1999|lb sed|h|только гибрид|Honda Insight
Shuttle|шаттл|2015-2022|wag|g h|правый руль|Honda Shuttle
Crosstour|кросстур|2009-2015|suv|g|Honda Crosstour
Element|элемент|2003-2011|suv|g|Honda Element
Legend|легенд|1985-2022|sed|g h|Honda Legend
N-Box|н бокс|2011|hat|g|кей-кар|Honda N-Box`,
  mitsubishi: `
Lancer|лансер,лансер 9,лансер 10,лансер х|1973-2017|sed hat|g|Mitsubishi Lancer
Outlander|аутлендер,аутлэндер,оутлендер|2001|suv|g p|есть подзаряжаемый гибрид|Mitsubishi Outlander
ASX|асх,аикс|2010|suv|g|Mitsubishi ASX
Pajero|паджеро,пажеро|1982-2021|off|g|внедорожник|Mitsubishi Pajero
Pajero Sport|паджеро спорт,пажеро спорт|1996|off|g|рамный|Mitsubishi Pajero Sport
L200|л200,л 200,тритон,triton|1978|pu|g|пикап|Mitsubishi Triton
Eclipse Cross|эклипс кросс,эклипс|2017|suv|g p|Mitsubishi Eclipse Cross
Galant|галант|1969-2012|sed|g|Mitsubishi Galant
Colt|кольт|1962|hat|g|Mitsubishi Colt
Grandis|грандис|2003-2011|mpv|g|минивэн|Mitsubishi Grandis
Delica|делика|1968|mpv|g|минивэн|Mitsubishi Delica
Xpander|экспандер,икспандер|2017|mpv|g|минивэн 7 мест|Mitsubishi Xpander
i-MiEV|ай миев|2009-2021|hat|e|электро|Mitsubishi i-MiEV
Space Star|спейс стар,mirage|1998|hat|g|Mitsubishi Mirage`,
  subaru: `
Forester|форестер,форик|1997|suv|g h|Subaru Forester
Outback|аутбэк,аутбек|1994|wag|g|Subaru Outback
Impreza|импреза|1992|sed hat|g|Subaru Impreza
XV|хв,crosstrek,кросстрек|2011|suv|g h|Subaru XV
Legacy|легаси|1989|sed wag|g|Subaru Legacy
Tribeca|трибека|2005-2014|suv|g|7 мест|Subaru Tribeca
Levorg|леворг|2014|wag|g|Subaru Levorg
WRX|врх,wrx sti,сти|1992|sed sp|g|спортивный седан|Subaru WRX
BRZ|брз|2012|cpe sp|g|спорткар|Subaru BRZ`,
  suzuki: `
Grand Vitara|гранд витара,эскудо,escudo|1997|suv|g|Suzuki Grand Vitara
Vitara|витара|1988|suv|g h|Suzuki Vitara
SX4|сх4,с икс 4|2006|hat suv|g|Suzuki SX4
Swift|свифт|2004|hat|g h|Suzuki Swift
Jimny|джимни,жимни|1970|off|g|рамный, маленький|Suzuki Jimny
Splash|сплэш|2008-2014|hat|g|Suzuki Splash
Liana|лиана|2001-2008|sed hat|g|Suzuki Liana
Kizashi|кизаши|2009-2015|sed|g|Suzuki Kizashi`,
  datsun: `
on-DO|ондо,он до|2014-2020|sed|g|на базе Lada Granta|Datsun on-Do
mi-DO|мидо,ми до|2015-2020|hat|g|на базе Lada Kalina|Datsun mi-Do`,
  isuzu: `
D-Max|д макс,дмакс|2002|pu|g|пикап|Isuzu D-Max
MU-X|му х,мух|2013|off|g|рамный, 7 мест|Isuzu MU-X`,
  daihatsu: `
Terios|териос|1997|suv|g|Daihatsu Terios`,

  hyundai: `
Solaris|солярис,соляра|2010-2022|sed hat|g|Hyundai Accent
Accent|акцент,тагаз|1994|sed hat|g|Hyundai Accent
Elantra|элантра,ланка,аванте|1990|sed|g|Hyundai Elantra
Sonata|соната|1985|sed|g h|Hyundai Sonata
Creta|крета,крэта|2015|suv|g|Hyundai Creta
Tucson|туссан,тусан,тусон,туксон|2004|suv|g h p|есть гибрид|Hyundai Tucson
Santa Fe|санта фе,санта,сантафе|2000|suv|g h p|есть гибрид|Hyundai Santa Fe
Grand Santa Fe|гранд санта фе|2013-2018|suv|g|7 мест|Hyundai Santa Fe
ix35|их35,айикс35|2009-2015|suv|g|Hyundai Tucson
ix55|их55|2006-2015|suv|g|7 мест|Hyundai Veracruz
i30|ай30,и30|2007|hat wag|g|Hyundai i30
i40|ай40,и40|2011-2019|sed wag|g|Hyundai i40
i20|ай20,и20|2008|hat|g|Hyundai i20
Getz|гетц,гец|2002-2011|hat|g|Hyundai Getz
Matrix|матрикс|2001-2010|mpv|g|компактвэн|Hyundai Matrix
Starex|старекс,h-1,н1,grand starex|1997-2021|mpv com|g|минивэн|Hyundai Starex
Staria|стария,старья|2021|mpv|g|минивэн|Hyundai Staria
Palisade|палисад,палисейд|2018|suv|g|7–8 мест|Hyundai Palisade
Kona|кона|2017|suv|g h e|есть гибрид и электро|Hyundai Kona
Ioniq|ионик,айоник|2016-2022|lb|h p e|гибрид и электро|Hyundai Ioniq
Ioniq 5|ионик 5|2021|suv|e|электро|Hyundai Ioniq 5
Grandeur|грандер,грандеур,азера,azera|1986|sed|g h|Hyundai Grandeur
Equus|экус,экьюс|1999-2016|sed|g|Hyundai Equus
Terracan|терракан|2001-2007|off|g|рамный|Hyundai Terracan
Venue|веню|2019|suv|g|Hyundai Venue
Veloster|велостер|2011|hat|g|Hyundai Veloster
Mufasa|муфаса|2023|suv|g|Hyundai Mufasa
Porter|портер|1977|com|g|грузовик|Hyundai Porter
HD|хд,hd78,hd65|1990|com|g|грузовик|Hyundai Mighty`,
  kia: `
Rio|рио,рийо|2000|sed hat|g|Kia Rio
Rio X|рио х,рио икс,x-line,х лайн|2017|hat|g|Kia Rio
Ceed|сид,сиид,ceed sw|2006|hat wag|g|Kia Ceed
ProCeed|просид|2008|wag|g|универсал-купе|Kia ProCeed
Cerato|церато,серато,форте,forte|2003|sed hat|g|Kia Forte
K5|к5,ка5|2020|sed|g|Kia K5
Optima|оптима|2000-2020|sed|g h|Kia Optima
Sportage|спортейдж,спортаж,спортэйдж|1993|suv|g h p|есть гибрид|Kia Sportage
Sorento|соренто,соренто прайм|2002|suv|g h p|есть гибрид|Kia Sorento
Mohave|мохав,мохаве|2008|off|g|рамный|Kia Mohave
Seltos|селтос|2019|suv|g|Kia Seltos
Soul|соул,соль|2008|hat|g e|есть электро|Kia Soul
Picanto|пиканто|2004|hat|g|Kia Picanto
Carnival|карнивал,карнавал,седона,sedona|1998|mpv|g h|минивэн|Kia Carnival
Carens|каренс|1999|mpv|g|компактвэн|Kia Carens
Venga|венга|2009-2019|hat|g|Kia Venga
Stinger|стингер|2017-2023|lb sp|g|спортивный лифтбек|Kia Stinger
K8|к8|2021|sed|g h|Kia K8
Quoris|кворис,k9,к9|2012|sed|g|Kia K9
Spectra|спектра|2000-2011|sed|g|Kia Spectra
Magentis|маджентис,мажентис|2000-2010|sed|g|Kia Optima
Opirus|опирус|2003-2011|sed|g|Kia Opirus
Sonet|сонет|2020|suv|g|Kia Sonet
EV6|ев6|2021|suv|e|электро|Kia EV6
EV9|ев9|2023|suv|e|электро|Kia EV9
Niro|ниро|2016|suv|h p e|гибрид и электро|Kia Niro
Bongo|бонго|1980|com pu|g|грузовик|Kia Bongo`,
  genesis: `
G70|г70,джи70|2017|sed|g|Genesis G70
G80|г80,джи80|2016|sed|g e|Genesis G80
G90|г90,джи90|2015|sed|g|Genesis G90
GV70|гв70,дживи70|2020|suv|g e|Genesis GV70
GV80|гв80,дживи80|2020|suv|g|Genesis GV80`,
  ssangyong: `
Actyon|актион,актион нью|2005|suv|g|SsangYong Actyon
Actyon Sports|актион спорт,актион спортс|2006-2018|pu|g|пикап|SsangYong Actyon Sports
Kyron|кайрон|2005-2017|suv|g|SsangYong Kyron
Rexton|рекстон|2001|off|g|рамный|SsangYong Rexton
Musso|муссо|1993|pu off|g|пикап|SsangYong Musso
Tivoli|тиволи|2015|suv|g|SsangYong Tivoli
Korando|корандо|1983|suv|g e|SsangYong Korando
Stavic|ставик,rodius,родиус|2004|mpv|g|минивэн|SsangYong Rodius
Torres|торрес|2022|suv|g e|SsangYong Torres`,

  vw: `
Polo|поло,поло седан|1975|sed lb hat|g|Volkswagen Polo
Jetta|джетта,джета|1979|sed|g|Volkswagen Jetta
Passat|пассат,пасат,б5,б6,б7,б8|1973|sed wag|g h p|Volkswagen Passat
Passat CC|пассат сс,сс,vw cc|2008-2017|sed|g|Volkswagen CC
Golf|гольф|1974|hat wag|g h p e|Volkswagen Golf
Tiguan|тигуан,тигуанчик|2007|suv|g p|Volkswagen Tiguan
Touareg|туарег,туарэг|2002|suv|g h p|Volkswagen Touareg
Teramont|терамонт|2017|suv|g|7 мест|Volkswagen Atlas
Taos|таос|2021|suv|g|Volkswagen Taos
Tayron|тайрон|2018|suv|g|Volkswagen Tayron
Talagon|талагон|2021|suv|g|7 мест|Volkswagen Talagon
Touran|туран|2003|mpv|g|компактвэн|Volkswagen Touran
Sharan|шаран|1995-2022|mpv|g|минивэн|Volkswagen Sharan
Caddy|кадди,каддик|1979|van mpv|g|«каблук» и пассажирский|Volkswagen Caddy
Multivan|мультивен,мультиван,каравелла,caravelle,транспортер,transporter,т5,т6|1950|mpv com|g h|минивэн и фургон|Volkswagen Transporter
Crafter|крафтер|2006|com|g|фургон|Volkswagen Crafter
Amarok|амарок|2010|pu|g|пикап|Volkswagen Amarok
Arteon|артеон|2017|lb|g p|Volkswagen Arteon
Scirocco|сирокко,широкко|1974-2017|cpe|g|Volkswagen Scirocco
Beetle|битл,жук фольксваген|1997-2019|hat cab|g|Volkswagen Beetle (A5)
Bora|бора|1998|sed|g|Volkswagen Bora
Lavida|лавида|2008|sed|g|Volkswagen Lavida
ID.4|ид4,айди 4|2020|suv|e|электро|Volkswagen ID.4
ID.6|ид6,айди 6|2021|suv|e|электро, 7 мест|Volkswagen ID.6`,
  skoda: `
Octavia|октавия,актавия,октава|1996|lb wag|g|Škoda Octavia
Rapid|рапид|2012|lb|g|Škoda Rapid (2012)
Fabia|фабия|1999|hat wag|g|Škoda Fabia
Superb|суперб,супер б|2001|lb wag|g p|Škoda Superb
Kodiaq|кодиак,кадиак|2016|suv|g|7 мест|Škoda Kodiaq
Karoq|карок|2017|suv|g|Škoda Karoq
Yeti|йети,ети|2009-2017|suv|g|Škoda Yeti
Roomster|румстер|2006-2015|mpv|g|компактвэн|Škoda Roomster
Kamiq|камик|2019|suv|g|Škoda Kamiq`,
  audi: `
A3|а3|1996|hat sed|g p|Audi A3
A4|а4|1994|sed wag|g|Audi A4
A5|а5|2007|lb cpe cab|g|Audi A5
A6|а6|1994|sed wag|g h|Audi A6
A7|а7|2010|lb|g h|Audi A7
A8|а8|1994|sed|g h p|Audi A8
Q3|ку3,кью3|2011|suv|g|Audi Q3
Q5|ку5,кью5|2008|suv|g h p|Audi Q5
Q7|ку7,кью7|2005|suv|g h p|Audi Q7
Q8|ку8,кью8|2018|suv|g h|Audi Q8
e-tron|етрон,е трон|2018|suv|e|электро|Audi e-tron
TT|тт|1998-2023|cpe cab sp|g|спорткар|Audi TT
A1|а1|2010|hat|g|Audi A1`,
  porsche: `
Cayenne|кайен,каен|2002|suv|g p|Porsche Cayenne
Macan|макан|2014|suv|g e|Porsche Macan
Panamera|панамера|2009|lb|g p|Porsche Panamera
911|911,каррера|1964|cpe cab sp|g|спорткар|Porsche 911
Taycan|тайкан|2019|sed|e|электро|Porsche Taycan`,
  bmw: `
1|бмв 1,единичка,1 серия|2004|hat|g|BMW 1 Series
3|бмв 3,трешка бмв,3 серия,е90,ф30,г20|1975|sed wag|g p|BMW 3 Series
5|бмв 5,пятерка бмв,5 серия,е60,ф10,г30,е39|1972|sed wag|g h p|BMW 5 Series
7|бмв 7,семерка бмв,7 серия|1977|sed|g h p e|BMW 7 Series
X1|х1,икс1|2009|suv|g p|BMW X1
X3|х3,икс3|2003|suv|g p|BMW X3
X4|х4,икс4|2014|suv|g|BMW X4
X5|х5,икс5|1999|suv|g p|BMW X5
X6|х6,икс6|2008|suv|g|BMW X6
X7|х7,икс7|2019|suv|g|BMW X7
2|бмв 2,2 серия|2014|cpe mpv|g|BMW 2 Series
4|бмв 4,4 серия|2013|cpe cab lb|g|BMW 4 Series
6|бмв 6,6 серия|1976-2018|cpe cab|g|BMW 6 Series
8|бмв 8,8 серия|2018|cpe cab|g|BMW 8 Series
i3|ай3,и3|2013-2022|hat|e r|электро|BMW i3
iX|айикс,их|2021|suv|e|электро|BMW iX
Z4|з4,зет4|2002|cab sp|g|кабриолет|BMW Z4`,
  mini: `
Cooper|купер,мини купер,hatch|2001|hat cab|g e|Mini Hatch
Countryman|кантримен,кантримэн|2010|suv|g p e|Mini Countryman`,
  mercedes: `
A-класс|а класс,а-класс,а180,а200|1997|hat sed|g|Mercedes-Benz A-Class
B-класс|б класс,б-класс|2005|mpv|g|компактвэн|Mercedes-Benz B-Class
C-класс|ц класс,с класс,с-класс,ц-класс,с180,с200,w204,w205,w206|1993|sed wag cpe|g h p|Mercedes-Benz C-Class
E-класс|е класс,е-класс,ешка,w211,w212,w213,е200,е300|1993|sed wag|g h p|Mercedes-Benz E-Class
S-класс|с класс,эска,w221,w222,w223,кабан|1972|sed|g h p|Mercedes-Benz S-Class
CLA|цла,сла|2013|sed|g|Mercedes-Benz CLA
CLS|цлс,слс|2004|sed|g|Mercedes-Benz CLS
GLA|гла|2013|suv|g|Mercedes-Benz GLA
GLB|глб|2019|suv|g|Mercedes-Benz GLB
GLC|глц,глс,глк,glk|2015|suv|g p|Mercedes-Benz GLC
GLE|гле,мл,ml|1997|suv|g p|Mercedes-Benz GLE
GLS|глс большой,гл,gl|2006|suv|g|7 мест|Mercedes-Benz GLS
G-класс|гелик,гелендваген,гелендеваген,г класс,г-класс,g63|1979|off|g e|рамный|Mercedes-Benz G-Class
V-класс|в класс,виано,viano|1996|mpv|g|минивэн|Mercedes-Benz V-Class
Vito|вито|1996|com mpv|g|фургон|Mercedes-Benz Vito
Sprinter|спринтер|1995|com|g|фургон|Mercedes-Benz Sprinter
EQE|еке,eqe|2022|sed suv|e|электро|Mercedes-Benz EQE
EQS|екс,eqs|2021|sed suv|e|электро|Mercedes-Benz EQS
AMG GT|амг гт|2014|cpe sp|g|спорткар|Mercedes-AMG GT`,
  smart: `
Fortwo|форту,смарт форту|1998|hat|g e|Smart Fortwo
#1|смарт 1,смарт #1|2022|suv|e|электро|-`,
  opel: `
Astra|астра|1991|hat sed wag|g|Opel Astra
Corsa|корса|1982|hat|g e|Opel Corsa
Insignia|инсигния,инсигниа|2008|lb wag|g|Opel Insignia
Vectra|вектра|1988-2008|sed hat wag|g|Opel Vectra
Zafira|зафира|1999|mpv|g|минивэн|Opel Zafira
Antara|антара|2006-2015|suv|g|Opel Antara
Mokka|мокка,мока|2012|suv|g e|Opel Mokka
Meriva|мерива|2003-2017|mpv|g|компактвэн|Opel Meriva
Omega|омега|1986-2003|sed wag|g|Opel Omega
Frontera|фронтера|1991|suv|g h e|Opel Frontera
Crossland|кроссленд|2017|suv|g|Opel Crossland
Grandland|грандленд|2017|suv|g p|Opel Grandland
Combo|комбо|1993|van mpv|g|«каблук»|Opel Combo
Vivaro|виваро|2001|com mpv|g|фургон|Opel Vivaro`,
  peugeot: `
206|пежо 206|1998-2012|hat sed|g|Peugeot 206
207|пежо 207|2006-2014|hat|g|Peugeot 207
208|пежо 208|2012|hat|g e|Peugeot 208
301|пежо 301|2012|sed|g|Peugeot 301
307|пежо 307|2001-2008|hat wag|g|Peugeot 307
308|пежо 308|2007|hat wag|g p|Peugeot 308
406|пежо 406|1995-2004|sed wag|g|Peugeot 406
407|пежо 407|2004-2011|sed wag|g|Peugeot 407
408|пежо 408|2010|sed lb|g p|Peugeot 408
508|пежо 508|2010|sed wag|g p|Peugeot 508
2008|пежо 2008|2013|suv|g e|Peugeot 2008
3008|пежо 3008|2009|suv|g h p e|Peugeot 3008
4008|пежо 4008|2012|suv|g|Peugeot 4008
5008|пежо 5008|2009|suv|g h p|7 мест|Peugeot 5008
Partner|партнер,партнёр|1996|van mpv|g|«каблук»|Peugeot Partner
Traveller|тревеллер пежо,expert,эксперт|1994|mpv com|g|минивэн и фургон|Peugeot Expert
Boxer|боксер,боксёр|1994|com|g|фургон|Peugeot Boxer`,
  citroen: `
C4|ц4,с4|2004|hat sed|g e|Citroën C4
C3|ц3,с3|2002|hat|g|Citroën C3
C5|ц5,с5 ситроен|2001|sed wag|g|Citroën C5
C-Elysee|ц элизе,с элизе,элизе|2012|sed|g|Citroën C-Elysée
C4 Picasso|пикассо,ц4 пикассо,spacetourer|2006|mpv|g|компактвэн|Citroën C4 Picasso
C-Crosser|ц кроссер,кроссер|2007-2012|suv|g|Citroën C-Crosser
Berlingo|берлинго|1996|van mpv|g|«каблук»|Citroën Berlingo
SpaceTourer|спейстурер,jumpy,джампи|1994|mpv com|g|минивэн и фургон|Citroën Jumpy
Jumper|джампер|1994|com|g|фургон|Citroën Jumper
C5 Aircross|ц5 аиркросс,аиркросс|2017|suv|g p|Citroën C5 Aircross
C3 Aircross|ц3 аиркросс|2017|suv|g|Citroën C3 Aircross
C4 Aircross|ц4 аиркросс|2012-2017|suv|g|Citroën C4 Aircross`,
  renault: `
Logan|логан|2004|sed|g|Dacia Logan
Sandero|сандеро,степвей,stepway|2007|hat|g|Dacia Sandero
Duster|дастер,дустер|2010|suv|g|Dacia Duster
Kaptur|каптур,каптюр|2016|suv|g|ru:Renault Kaptur
Arkana|аркана|2019|suv|g h|купе-кроссовер|Renault Arkana
Megane|меган,мэган|1995|hat sed wag|g|Renault Mégane
Fluence|флюенс,флюэнс|2009-2017|sed|g|Renault Fluence
Symbol|симбол|1999-2013|sed|g|Renault Symbol
Clio|клио|1990|hat|g h|Renault Clio
Koleos|колеос|2008|suv|g h|Renault Koleos
Scenic|сценик,сэник|1996|mpv|g|компактвэн|Renault Scénic
Laguna|лагуна|1994-2015|lb wag|g|Renault Laguna
Kangoo|кангу,кенгу|1997|van mpv|g|«каблук»|Renault Kangoo
Dokker|доккер|2012|van mpv|g|«каблук»|Dacia Dokker
Master|мастер|1980|com|g|фургон|Renault Master
Trafic|трафик|1980|com mpv|g|фургон|Renault Trafic
Latitude|латитуд|2010-2015|sed|g|Renault Latitude`,
  fiat: `
Albea|альбеа|2002-2012|sed|g|Fiat Albea
Punto|пунто|1993-2018|hat|g|Fiat Punto
Doblo|добло|2000|van mpv|g|«каблук»|Fiat Doblò
Ducato|дукато|1981|com|g|фургон|Fiat Ducato
500|фиат 500,чинквеченто|2007|hat cab|g e|Fiat 500 (2007)
Linea|линеа|2007-2018|sed|g|Fiat Linea
Bravo|браво|2007-2014|hat|g|Fiat Bravo
Panda|панда|1980|hat|g h|Fiat Panda
Tipo|типо|2015|sed hat|g|Fiat Tipo
Freemont|фримонт|2011-2016|suv|g|7 мест|Fiat Freemont
Scudo|скудо|1995|com|g|фургон|Fiat Scudo`,
  volvo: `
XC90|хс90,ихс90|2002|suv|g h p|7 мест|Volvo XC90
XC60|хс60|2008|suv|g h p|Volvo XC60
XC40|хс40|2017|suv|g p e|Volvo XC40
XC70|хс70|2000-2016|wag|g|Volvo XC70
S60|с60|2000|sed|g p|Volvo S60
S80|с80|1998-2016|sed|g|Volvo S80
S90|с90|2016|sed|g p|Volvo S90
S40|с40|1995-2012|sed|g|Volvo S40
V40|в40|2012-2019|hat|g|Volvo V40
V60|в60|2010|wag|g p|Volvo V60
V90|в90|2016|wag|g p|Volvo V90
C30|ц30,с30|2006-2013|hat|g|Volvo C30`,
  landrover: `
Range Rover|рендж ровер,ренж ровер,рейндж ровер|1970|suv|g h p|Range Rover
Range Rover Sport|рендж ровер спорт,ренж спорт|2005|suv|g h p|Range Rover Sport
Range Rover Evoque|эвок,ивок,эвоук|2011|suv|g p|Range Rover Evoque
Range Rover Velar|велар|2017|suv|g p|Range Rover Velar
Discovery|дискавери,диско|1989|suv|g|7 мест|Land Rover Discovery
Discovery Sport|дискавери спорт|2014|suv|g p|Land Rover Discovery Sport
Defender|дефендер|1983|off|g h p|внедорожник|Land Rover Defender
Freelander|фрилендер,фрилендер 2|1997-2015|suv|g|Land Rover Freelander`,
  jaguar: `
XF|хф|2007|sed wag|g|Jaguar XF
XE|хе|2015|sed|g|Jaguar XE
XJ|хж,хдж|1968-2019|sed|g|Jaguar XJ
F-Pace|ф пейс|2016|suv|g p|Jaguar F-Pace
E-Pace|е пейс|2017|suv|g p|Jaguar E-Pace
I-Pace|ай пейс|2018|suv|e|электро|Jaguar I-Pace
F-Type|ф тайп|2013|cpe cab sp|g|спорткар|Jaguar F-Type`,
  seat: `
Leon|леон|1999|hat wag|g|SEAT León
Ibiza|ибица|1984|hat|g|SEAT Ibiza
Ateca|атека|2016|suv|g|SEAT Ateca`,

  ford: `
Focus|фокус,фокус 2,фокус 3|1998|hat sed wag|g|Ford Focus
Mondeo|мондео|1993|sed lb wag|g h|Ford Mondeo
Fiesta|фиеста|1976|hat sed|g|Ford Fiesta
Fusion|фьюжн,фьюжен|2002-2012|hat|g|Ford Fusion (Europe)
Kuga|куга|2008|suv|g h p|есть гибрид|Ford Kuga
EcoSport|экоспорт,эко спорт|2003|suv|g|Ford EcoSport
Explorer|эксплорер|1990|suv|g h p|7 мест|Ford Explorer
Edge|эдж|2006|suv|g|Ford Edge
Escape|эскейп|2000|suv|g h p|Ford Escape
Mustang|мустанг|1964|cpe cab sp|g e|спорткар|Ford Mustang
Ranger|рейнджер,ренджер|1983|pu|g|пикап|Ford Ranger
F-150|ф150,ф 150|1975|pu|g h|пикап|Ford F-150
Transit|транзит|1965|com|g|фургон, микроавтобус|Ford Transit
Tourneo|торнео,турнео|1995|mpv|g|минивэн|Ford Tourneo Custom
S-Max|с макс,эс макс|2006-2023|mpv|g h|минивэн|Ford S-Max
Galaxy|гэлакси,галакси форд|1995-2023|mpv|g h|минивэн|Ford Galaxy
C-Max|ц макс,с макс компакт|2003-2019|mpv|g p|компактвэн|Ford C-Max
Maverick|маверик|1993|suv pu|g h|Ford Maverick
Expedition|экспедишн|1996|off|g|рамный, большой|Ford Expedition
Territory|территори|2018|suv|g h|Ford Territory
Bronco|бронко|1966|off|g|внедорожник|Ford Bronco`,
  chevrolet: `
Aveo|авео|2002|sed hat|g|Chevrolet Aveo
Lacetti|лачетти,лачети|2004-2013|sed hat wag|g|Chevrolet Lacetti
Cruze|круз,круза|2008|sed hat wag|g|Chevrolet Cruze
Cobalt|кобальт|2011|sed|g|Chevrolet Cobalt
Spark|спарк|2005|hat|g|Chevrolet Spark
Captiva|каптива|2006|suv|g|7 мест|Chevrolet Captiva
Tahoe|тахо,тахое|1994|off|g|рамный, большой|Chevrolet Tahoe
Trailblazer|трейлблейзер,трэйлблэйзер|2001|off|g|рамный|Chevrolet TrailBlazer
Orlando|орландо|2010|mpv|g|компактвэн 7 мест|Chevrolet Orlando
Malibu|малибу|1964|sed|g h|Chevrolet Malibu
Camaro|камаро|1966|cpe cab sp|g|спорткар|Chevrolet Camaro
Epica|эпика|2006-2012|sed|g|Chevrolet Epica
Rezzo|реззо,резо|2000-2008|mpv|g|компактвэн|Chevrolet Rezzo
Tracker|трекер|1989|suv|g|Chevrolet Tracker
Equinox|эквинокс|2004|suv|g|Chevrolet Equinox
Traverse|траверс|2008|suv|g|7 мест|Chevrolet Traverse
Silverado|сильверадо|1998|pu|g|пикап|Chevrolet Silverado
Corvette|корвет|1953|cpe cab sp|g|спорткар|Chevrolet Corvette
Monza|монза|2018|sed|g|Chevrolet Monza
Nexia|нексия шевроле|2020|sed|g|Chevrolet Nexia
Onix|оникс|2012|sed hat|g|Chevrolet Onix
Damas|дамас шевроле,labo,лабо|1991|com|g|микроавтобус|Daewoo Damas`,
  cadillac: `
Escalade|эскалейд,эскалэйд|1999|off|g|рамный, большой|Cadillac Escalade
SRX|срх|2003-2016|suv|g|Cadillac SRX
XT4|хт4|2018|suv|g|Cadillac XT4
XT5|хт5|2016|suv|g|Cadillac XT5
XT6|хт6|2019|suv|g|7 мест|Cadillac XT6
CTS|цтс,стс|2002-2019|sed|g|Cadillac CTS
ATS|атс|2012-2019|sed cpe|g|Cadillac ATS
CT6|цт6|2016-2020|sed|g|Cadillac CT6`,
  jeep: `
Grand Cherokee|гранд чероки,гранд черокки,гранчероки|1993|suv|g p|Jeep Grand Cherokee
Cherokee|чероки,черокки|1974|suv|g|Jeep Cherokee
Compass|компас|2006|suv|g p|Jeep Compass
Renegade|ренегад|2014|suv|g p|Jeep Renegade
Wrangler|вранглер,рэнглер|1986|off|g p|рамный|Jeep Wrangler
Liberty|либерти|2001-2012|suv|g|Jeep Liberty`,
  dodge: `
Caliber|калибр,калибер|2006-2012|hat|g|Dodge Caliber
Journey|джорни,джурни|2008-2020|suv|g|7 мест|Dodge Journey
Challenger|челленджер,челенджер|1970|cpe sp|g|спорткар|Dodge Challenger
Charger|чарджер|1966|sed sp|g|спортивный седан|Dodge Charger
Durango|дуранго|1997|suv|g|7 мест|Dodge Durango
Ram|рэм,рам|1981|pu|g|пикап|Ram pickup
Caravan|караван,гранд караван|1983-2020|mpv|g|минивэн|Dodge Caravan
Nitro|нитро|2006-2012|suv|g|Dodge Nitro`,
  chrysler: `
300C|300ц,300с,крайслер 300|2004|sed wag|g|Chrysler 300
Pacifica|пасифика|2016|mpv|g p|минивэн|Chrysler Pacifica (minivan)
Voyager|вояджер,гранд вояджер|1988|mpv|g|минивэн|Chrysler Voyager
Sebring|себринг|1995-2010|sed cab|g|Chrysler Sebring
PT Cruiser|пт крузер,пи티крузер|2000-2010|hat|g|Chrysler PT Cruiser`,
  lincoln: `
Navigator|навигатор|1997|off|g|рамный, большой|Lincoln Navigator
Nautilus|наутилус,mkx|2006|suv|g h|Lincoln Nautilus
Aviator|авиатор|2002|suv|g p|Lincoln Aviator`,
  tesla: `
Model 3|модель 3,тесла 3|2017|sed|e|электро|Tesla Model 3
Model Y|модель у,модель игрек,тесла у|2020|suv|e|электро|Tesla Model Y
Model S|модель с,тесла с|2012|lb|e|электро|Tesla Model S
Model X|модель х,тесла х|2015|suv|e|электро|Tesla Model X`,
  bentley: `
Bentayga|бентейга|2016|suv|g p|Bentley Bentayga
Continental GT|континенталь,континентал|2003|cpe cab|g p|Bentley Continental GT`,
  rollsroyce: `
Cullinan|куллинан|2018|suv|g|Rolls-Royce Cullinan
Ghost|гост|2009|sed|g|Rolls-Royce Ghost`,
  maserati: `
Levante|леванте|2016|suv|g|Maserati Levante
Ghibli|гибли|2013|sed|g|Maserati Ghibli`,
  ferrari: `
Purosangue|пуросангве|2022|suv sp|g|Ferrari Purosangue
Roma|рома|2019|cpe sp|g|спорткар|Ferrari Roma`,
  lamborghini: `
Urus|урус|2018|suv sp|g p|Lamborghini Urus
Huracan|уракан,хуракан|2014|cpe sp|g|спорткар|Lamborghini Huracán`,
  astonmartin: `
DBX|дбх|2020|suv|g|Aston Martin DBX`,
};
