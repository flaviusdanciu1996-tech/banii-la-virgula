// Daily motivation: classic sayings plus lines written for the app. The same list ships in the
// `daily-reminder` edge function so the notification and the in-app card show the same quote.

export interface Quote { t: string; a: string }

export const QUOTES: Quote[] = [
  { t: 'Nu este sărac cel care are puțin, ci cel care își dorește mai mult.', a: 'Seneca' },
  { t: 'Ai grijă de cheltuielile mici: o spărtură mică scufundă o corabie mare.', a: 'Benjamin Franklin' },
  { t: 'Bani albi pentru zile negre.', a: 'Proverb românesc' },
  { t: 'Fiecare ban are un loc. Când nu i-l dai tu, i-l dă altcineva.', a: 'Banii la virgulă' },
  { t: 'O călătorie de o mie de mile începe cu un singur pas.', a: 'Lao Tzu' },
  { t: 'Disciplina de azi e libertatea de mâine.', a: 'Banii la virgulă' },
  { t: 'O investiție în cunoaștere aduce cea mai bună dobândă.', a: 'Benjamin Franklin' },
  { t: 'Nu economisi ce rămâne după cheltuieli; cheltuie ce rămâne după economisire.', a: 'Warren Buffett' },
  { t: 'Picătură cu picătură se face un lac.', a: 'Proverb românesc' },
  { t: 'Nu contează cât de încet mergi, atâta timp cât nu te oprești.', a: 'Confucius' },
  { t: 'Banii pe care nu-i numeri dispar fără să-i observi.', a: 'Banii la virgulă' },
  { t: 'Ai putere asupra minții tale, nu asupra evenimentelor. Înțelege asta și vei găsi tăria.', a: 'Marcus Aurelius' },
  { t: 'Regula nr. 1: nu pierde bani. Regula nr. 2: nu uita regula nr. 1.', a: 'Warren Buffett' },
  { t: 'Cine se scoală de dimineață departe ajunge.', a: 'Proverb românesc' },
  { t: 'Un buget nu-ți spune ce nu ai voie. Îți spune unde vrei să ajungi.', a: 'Banii la virgulă' },
  { t: 'Bogăția nu înseamnă să ai multe, ci să ai puține nevoi.', a: 'Epictet' },
  { t: 'Suferim mai des în închipuire decât în realitate.', a: 'Seneca' },
  { t: 'Zece lei puși deoparte azi sunt o alegere. Zece lei puși deoparte în fiecare zi sunt un viitor.', a: 'Banii la virgulă' },
  { t: 'Timpul înseamnă bani.', a: 'Benjamin Franklin' },
  { t: 'Socoteala de acasă nu se potrivește cu cea din târg. De aceea o faci înainte.', a: 'Proverb românesc, completat' },
  { t: 'Nu trebuie să fii bogat ca să începi. Trebuie să începi ca să devii.', a: 'Banii la virgulă' },
  { t: 'Fericirea vieții tale depinde de calitatea gândurilor tale.', a: 'Marcus Aurelius' },
  { t: 'Fondul de urgență nu e pentru „dacă”. E pentru „când”.', a: 'Banii la virgulă' },
  { t: 'Graba strică treaba, mai ales la cumpărături.', a: 'Proverb românesc' },
  { t: 'Cel mai bun moment să plantezi un copac a fost acum 20 de ani. Al doilea cel mai bun e azi.', a: 'Proverb chinezesc' },
  { t: 'Cheltuielile mici, trecute zilnic, sunt cele care îți arată adevărul.', a: 'Banii la virgulă' },
  { t: 'Omul sfințește locul. Și banul, la fel: îl sfințește cum îl folosești.', a: 'Proverb românesc, completat' },
  { t: 'Nu cumpăra lucruri de care n-ai nevoie, cu bani pe care nu-i ai, ca să impresionezi oameni care nu contează.', a: 'Banii la virgulă' },
  { t: 'Nu da vrabia din mână pe cioara de pe gard.', a: 'Proverb românesc' },
  { t: 'Viteza nu contează dacă direcția e greșită.', a: 'Banii la virgulă' },
  { t: 'Un obicei bun repetat zilnic bate o decizie mare luată o dată pe an.', a: 'Banii la virgulă' },
  { t: 'Cine nu știe să păstreze puțin nu va ști să păstreze nici mult.', a: 'Banii la virgulă' },
  { t: 'Prima plată din salariu ar trebui să fie către tine: economiile.', a: 'Banii la virgulă' },
  { t: 'Nu te compara cu alții. Compară-te cu tine de luna trecută.', a: 'Banii la virgulă' },
  { t: 'Libertatea începe acolo unde datoriile se termină.', a: 'Banii la virgulă' },
  { t: 'Răbdarea e amară, dar rodul ei e dulce.', a: 'Proverb' },
  { t: 'Nu e nevoie să tai tot ce-ți place. E nevoie să tai ce nu-ți pasă.', a: 'Banii la virgulă' },
  { t: 'Kilometrii se adună unul câte unul. Leii la fel.', a: 'Banii la virgulă' },
  { t: 'Ce măsori, poți îmbunătăți.', a: 'Banii la virgulă' },
  { t: 'O zi grea nu e o viață grea. Mâine o iei de la capăt, mai înțelept.', a: 'Banii la virgulă' },
  { t: 'Încrederea în tine crește de fiecare dată când îți ții o promisiune făcută ție.', a: 'Banii la virgulă' },
  { t: 'Sănătatea e prima avere. Restul vine după.', a: 'Banii la virgulă' },
  { t: 'Banii cumpără timp. Folosește-l pentru oamenii tăi.', a: 'Banii la virgulă' },
  { t: 'Nu așteptăm să fie ușor ca să începem. Începem, și devine mai ușor.', a: 'Banii la virgulă' },
  { t: 'Cu cât ești mai liniștit cu banii, cu atât iei decizii mai bune.', a: 'Banii la virgulă' },
  { t: 'Pofta vine mâncând, iar economiile vin punând deoparte.', a: 'Proverb românesc, completat' },
  { t: 'O decizie amânată e tot o decizie: decizia de a nu face nimic.', a: 'Banii la virgulă' },
  { t: 'Bogăția adevărată e să ai destul și să știi că e destul.', a: 'Banii la virgulă' },
  { t: 'Nu munca grea te face bogat, ci ce faci cu ce câștigi din ea.', a: 'Banii la virgulă' },
  { t: 'Investește în tine primul: în sănătate, în minte, în relații.', a: 'Banii la virgulă' },
  { t: 'Fii recunoscător pentru ce ai, în timp ce lucrezi pentru ce vrei.', a: 'Banii la virgulă' },
  { t: 'Un plan scris valorează cât zece în cap.', a: 'Banii la virgulă' },
  { t: 'Cine are carte are parte.', a: 'Proverb românesc' },
  { t: 'Nu banii sunt scopul. Liniștea pe care ți-o dau este.', a: 'Banii la virgulă' },
  { t: 'Fiecare „nu” spus unei cheltuieli inutile e un „da” spus unui vis.', a: 'Banii la virgulă' },
  { t: 'Drumul lung se face cu pași mici și cu pauze bune.', a: 'Banii la virgulă' },
  { t: 'Azi e o zi bună să fii cu un leu mai aproape de obiectivul tău.', a: 'Banii la virgulă' },
  { t: 'Curajul nu e lipsa fricii, ci mersul înainte cu ea de mână.', a: 'Banii la virgulă' },
  { t: 'Ce semeni, aceea culegi.', a: 'Proverb' },
  { t: 'Ordinea în bani aduce ordine în minte.', a: 'Banii la virgulă' },
]

/** Same quote for everyone on a given local date; cycles through the list without repeats. */
export function quoteFor(dateIso: string, extra: Quote[] = []): Quote {
  const all = [...QUOTES, ...extra]
  const [y, m, d] = dateIso.split('-').map(Number)
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86400000)
  return all[((day % all.length) + all.length) % all.length]
}
