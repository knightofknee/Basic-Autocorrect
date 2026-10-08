/*
 * Built-in corrections.
 *
 * Format: one line per correct word —  `correction: typo typo typo`
 *   - Typos are matched case-insensitively; capitalization of what the user
 *     typed is carried over to the correction (see engine.js).
 *   - Only add HIGH-CONFIDENCE entries: the typo must not be a real word and
 *     must have exactly one likely intended word. When in doubt, leave it out.
 *     (e.g. no "its", "ill", "id", "were", "well", "shell", "wether", "form")
 *   - `npm test` checks every typo against the system word list and fails if
 *     a typo looks like a real English word (see test/data.test.js).
 */
(function (root) {
  const NS = (root.BasicAutocorrect = root.BasicAutocorrect || {});

  // Missing apostrophes in contractions, plus misplaced apostrophes.
  const contractions = `
    ain't: aint
    aren't: arent are'nt
    can't: cant ca'nt
    couldn't: couldnt could'nt coudlnt
    could've: couldve
    didn't: didnt did'nt
    doesn't: doesnt does'nt dosent dosnt doesnt' dosen't
    don't: dont do'nt
    hadn't: hadnt had'nt
    hasn't: hasnt has'nt
    haven't: havent have'nt
    he'd: hed
    he's: hes
    here's: heres
    how'd: howd
    how'll: howll
    how're: howre
    how's: hows
    isn't: isnt is'nt
    it'll: itll
    it'd: itd
    mightn't: mightnt
    might've: mightve
    mustn't: mustnt
    must've: mustve
    needn't: neednt
    o'clock: oclock
    oughtn't: oughtnt
    ma'am: maam
    shan't: shant
    she's: shes
    shouldn't: shouldnt should'nt
    should've: shouldve
    that'd: thatd
    that'll: thatll
    that's: thats
    there'd: thered
    there'll: therell
    there's: theres
    they'd: theyd
    they'll: theyll
    they're: theyre
    they've: theyve
    wasn't: wasnt was'nt
    we've: weve
    weren't: werent were'nt
    what'd: whatd
    what'll: whatll
    what're: whatre
    what's: whats
    what've: whatve
    where'd: whered
    where's: wheres
    who'd: whod
    who'll: wholl
    who's: whos
    who've: whove
    why'd: whyd
    won't: wont wo'nt
    wouldn't: wouldnt would'nt
    would've: wouldve
    couldn't've: couldntve
    shouldn't've: shouldntve
    wouldn't've: wouldntve
    y'all: yall ya'll
    you'd: youd
    you'll: youll
    you're: youre
    you've: youve
    c'mon: cmon
  `;

  // Words that are always capitalized.
  const capitalization = `
    I: i
    I'm: im i'm
    I've: ive i've
    I'll: i'll
    I'd: i'd
    Monday: monday
    Tuesday: tuesday tuseday tuesdya
    Wednesday: wednesday wensday wednsday wedensday wendesday
    Thursday: thursday thrusday thurday
    Friday: friday firday
    Saturday: saturday saterday
    Sunday: sunday
    January: january janurary januray
    February: february febuary feburary
    April: april
    June: june
    July: july
    August: august
    September: september septmber
    October: october
    November: november
    December: december decmber
    English: english
    Christmas: christmas
  `;

  // Typing slips (transpositions, dropped/doubled letters) and common
  // misspellings.
  const misspellings = `
    a lot: alot
    about: abotu aobut baout
    absence: absense
    acceptable: acceptible
    accidentally: accidently
    accommodate: accomodate acommodate
    accommodation: accomodation
    achieve: acheive achive
    achieved: acheived
    acquire: aquire
    across: accross
    actually: actaully actualy acutally
    address: adress addres
    addresses: adresses
    again: agian
    aggressive: agressive
    already: alraedy alreayd allready
    also: alos aslo
    always: alwasy alwyas allways
    and: adn
    another: anohter antoher
    answer: anwser awnser
    anything: anythign
    apparently: apparantly apparentely
    argument: arguement
    around: aroudn
    as well: aswell
    at least: atleast
    atheist: athiest
    awful: awfull
    basically: basicly basicaly
    beautiful: beautifull beatiful beautful
    because: becuase becasue beacuse becuse becaue becaues
    before: befroe beofre
    beginning: begining beggining
    being: beign
    believe: beleive belive
    belief: beleif
    between: beteen betwen bewteen
    business: buisness bussiness busness
    calendar: calander
    category: catagory
    cemetery: cemetary
    change: cahnge chnage
    changeable: changable
    colleague: collegue
    coming: comming
    committed: commited
    committee: comittee commitee
    company: comapny compnay
    completely: completly
    computer: copmuter
    conscious: concious
    consensus: concensus
    could: coudl cuold
    criticism: critisism
    deceive: decieve
    definitely: definately definatly defintely definetly definitly
    desperate: desparate
    develop: develope
    development: developement
    different: diffrent differnt differnet diferent
    disappear: dissappear
    disappoint: dissapoint
    disappointed: dissapointed
    discuss: dicuss disucss
    doing: doign
    earlier: eariler
    easier: eaiser
    easily: easliy
    each other: eachother
    email: emial emali
    embarrass: embarass
    embarrassed: embarassed
    embarrassing: embarassing
    enough: enoguh enogh
    environment: enviroment enviorment
    especially: especialy
    even: evne
    every: evrey
    everything: everyhting everthing evrything everythign
    example: exmaple examlpe
    excellent: exellent
    exercise: excercise
    existence: existance
    experience: expereince experiance
    fascinating: facinating
    field: feild
    finally: finaly
    first: frist fisrt
    foreign: foriegn
    forty: fourty
    forward: foward
    friend: freind
    friends: freinds
    from: fomr frmo
    function: fucntion funtion
    going: goign gonig giong
    government: goverment govenment
    grammar: grammer
    grateful: gratefull
    great: gerat graet
    guarantee: gaurantee garantee
    had: ahd
    happened: happend hapened
    harass: harrass
    harassment: harrassment
    have: ahve hvae
    help: hlep
    hierarchy: heirarchy
    hopefully: hopefuly
    how: hwo
    immediately: immediatly imediately
    important: importnat improtant importatn
    in case: incase
    in fact: infact
    independent: independant
    information: inforamtion infomation informaiton
    instead: insted isntead
    intelligent: inteligent
    interested: intrested intersted
    interesting: intresting interseting intersting
    interrupt: interupt
    jewelry: jewelery
    just: jsut
    know: konw knwo nkow
    knowledge: knowlege knowlegde
    length: lenght
    library: libary
    like: liek
    maintenance: maintainance maintenence
    make: mkae maek
    maybe: mabye maybee
    meeting: meeitng meetign
    message: mesage messgae mesasge
    millennium: millenium
    misspell: mispell
    misspelled: mispelled
    misspelling: mispelling
    more: mroe moer
    morning: monring mornign
    myself: mysefl myslef
    name: nmae
    necessarily: neccessarily
    necessary: neccessary necesary neccesary
    neighbor: nieghbor
    niece: neice
    no one: noone
    noticeable: noticable
    nothing: nothign
    number: nubmer numebr
    occasion: occassion ocasion
    occasionally: occassionally
    occurred: occured ocurred
    occurrence: occurence occurance
    occurring: occuring
    of course: ofcourse
    only: onyl olny
    opportunity: oppurtunity oportunity opertunity
    original: orignal orginal origional
    other: otehr ohter
    package: pacakge packge
    parallel: paralell parralel
    parliament: parliment
    particularly: particulary
    people: peopel poeple pepole peolpe
    perceive: percieve
    permanent: perminent
    personal: persoanl personla
    piece: peice
    please: pelase plaese plesae
    possession: posession
    possible: posible
    possibility: possiblity
    preferred: prefered
    presence: presense
    privilege: privelege priviledge
    probably: probaly proabbly porbably
    problem: probelm problme porblem
    problems: probelms
    project: proejct porject projcet
    pronunciation: pronounciation
    publicly: publically
    question: qeustion quesiton questoin
    questionnaire: questionaire
    really: realy relaly realyl
    receipt: reciept
    receive: recieve
    received: recieved
    receiving: recieving
    recommend: reccomend recomend reccommend
    recommendation: reccomendation
    referred: refered
    relevant: relevent
    religious: religous
    remember: remeber rember remmeber rememebr
    report: reprot
    response: reponse repsonse
    restaurant: restaraunt resturant
    rhythm: rythm
    ridiculous: rediculous ridiculus
    right: rigth rihgt
    said: siad
    same: smae
    schedule: scedule schedual
    school: shcool scohol
    seize: sieze
    sentence: sentance
    separate: seperate
    separated: seperated
    separately: seperately
    should: shoudl shuold
    similar: similiar
    since: sicne
    sincerely: sincerly
    some: soem smoe
    someone: soemone somone
    something: somthing somehting soemthing somethign
    statement: statment
    stopped: stoped
    student: studnet stuednt
    success: sucess
    successful: succesful sucessful successfull
    successfully: succesfully
    surprise: suprise
    surprised: suprised
    tattoo: tatoo
    technology: tecnology tehcnology
    temperature: temperture temprature
    than: thna htan tahn
    thank: thnak thakn
    thanks: thansk thnaks thakns tahnks
    that: taht thta tath
    the: teh hte tteh
    their: thier theri
    them: tehm thme
    then: tehn thne
    there: tehre
    these: tehse
    they: tehy thye
    thing: thign
    things: thigns
    think: thikn thnik htink tihnk
    this: tihs thsi htis
    those: thsoe
    thought: thoguht thougth
    through: thorugh
    time: tiem
    today: todya
    together: togehter toghether togather
    tomorrow: tommorow tommorrow tomorow
    tongue: tounge
    truly: truely trully
    until: untill unitl
    unfortunately: unfortunatly unfortunetly unfortunantly
    unnecessary: unneccessary
    update: udpate updaet
    using: useing usign
    usually: usualy usally
    vacuum: vaccuum vaccum vacume
    vegetable: vegtable
    vehicle: vehical
    very: veyr vrey
    visible: visable
    want: wnat
    wanted: wnated
    was: wsa
    weekend: wekeend weekedn
    weird: wierd
    what: waht whta
    when: whne wehn hwen
    where: wehre whre
    which: whihc wihch whcih wich
    will: iwll wiil
    with: wiht wtih iwth
    without: wihtout withotu witout
    world: wrold
    would: woudl owuld wuold
    writing: writting
    written: writen
    year: yaer
    yesterday: yeasterday yesteday
    yield: yeild
    you: yuo oyu
    your: yoru yuor
    yourself: youself
  `;

  function parse(text) {
    const map = Object.create(null);
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const colon = line.indexOf(': ');
      if (colon < 0) throw new Error('Bad correction line: ' + line);
      const correction = line.slice(0, colon).trim();
      for (const typo of line.slice(colon + 2).trim().split(/\s+/)) {
        const key = typo.toLowerCase();
        if (key === correction) continue; // ("monday" -> "Monday" is kept: case differs)
        if (key in map && map[key] !== correction) {
          throw new Error(`Conflicting built-in correction for "${key}"`);
        }
        map[key] = correction;
      }
    }
    return map;
  }

  NS.builtinGroups = { contractions, capitalization, misspellings };
  NS.parseCorrections = parse;
  NS.builtinCorrections = Object.assign(
    Object.create(null),
    parse(contractions),
    parse(capitalization),
    parse(misspellings)
  );

  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
