// Parody ad campaigns starring Shak (the main character). All brands are invented for the game: no real logos,
// names or trademarks. Shared by the ad studio (client/dev/adstudio.html), the poster / billboard textures
// (client/img/ads) and the in-game screens (mapfill.js).
export const ADS = [
  { id: 'balti', brand: "SHAK'S BALTI TURBO", tag: 'Ladypool Road · Balti Triangle', dur: 18, c1: '#ff7a00', c2: '#7a0f0f', ink: '#fff6d8',
    caps: [[0.4, 4.2, 'Birmingham. Home of the balti.'], [4.4, 8.4, 'Cooked from cold to scorching in 2.9 seconds.'], [8.6, 12.6, '0-60 on the spice scale. No launch control.'],
      [12.8, 15, 'Side effects may include fluent Brummie.']], end: ['BALTI TURBO', 'Get it down ya, cuz.'] },
  { id: 'cabs', brand: 'CUZZY CABS', tag: '0121 000 0000 · fake number, real vibes', dur: 18, c1: '#ffd400', c2: '#111111', ink: '#111111',
    caps: [[0.4, 4.2, 'Late for the Bullpen Centre?'], [4.4, 8.6, 'Our drivers know every shortcut.'], [8.8, 12.6, 'Even the ones that are not technically roads.'],
      [12.8, 15, 'Fares: "whatever, cuz".']], end: ['CUZZY CABS', 'We got you. Eventually.'] },
  { id: 'grime', brand: 'GRIME FM 0121', tag: 'Live from a Digbeth arch', dur: 18, c1: '#00e5ff', c2: '#16002e', ink: '#ffffff',
    caps: [[0.4, 4.2, 'Broadcasting from a Digbeth arch...'], [4.4, 8.6, 'Bars so cold Selfwidges keep them in the freezer aisle.'], [8.8, 12.6, 'Bass so heavy it set off a car alarm in Small Heath.'],
      [12.8, 15, 'Tune in. Turn up. Tell your nan.']], end: ['GRIME FM 0121', '101.21 FM · probably'] },
  { id: 'bullpen', brand: 'BULLPEN CENTRE', tag: 'Mega Sale · everything must go', dur: 18, c1: '#e8e8ec', c2: '#c4002b', ink: '#111111',
    caps: [[0.4, 4.2, 'The Bullpen Centre Mega Sale.'], [4.4, 8.6, 'Everything must go.'], [8.8, 12.6, "Mostly Shak's money."],
      [12.8, 15, 'Selfwidges. Bulldog Ring. The lot.']], end: ['BULLPEN CENTRE', 'Shop till you drop, cuz.'] },
];
// stills (rendered in-engine by the studio, poster mode): billboards (2:1), bus shelters / shop posters (1:2)
export const POSTERS = [
  { id: 'balti', ad: 0, head: 'SHAK\'S BALTI TURBO', sub: 'Hotter than a clutch at Spaghetti Junction', pose: 'idle' },
  { id: 'cabs', ad: 1, head: 'CUZZY CABS', sub: 'We know a shortcut. Trust.', pose: 'walk' },
  { id: 'grime', ad: 2, head: 'GRIME FM 0121', sub: 'The only station Junior lets play in the shop', pose: 'idle' },
  { id: 'bullpen', ad: 3, head: 'BULLPEN CENTRE SALE', sub: 'Up to 90% off. Shak already bought the other 10%.', pose: 'run' },
  { id: 'selfwidges', ad: 3, head: 'SELFWIDGES', sub: 'Shiny discs. Shiny prices.', pose: 'idle', c1: '#ffe100', c2: '#111111', ink: '#111111' },
  { id: 'postbox', ad: 1, head: 'THE POSTBOX', sub: 'Canal-side cocktails. Dress code: Shak casual.', pose: 'idle', c1: '#b3262c', c2: '#2a2a2a', ink: '#ffffff' },
  { id: 'gym', ad: 2, head: 'BRUMMIE BULK GYM', sub: '"I only lift Bullpen bags" - Shak', pose: 'run', c1: '#39ff14', c2: '#0b0b0b', ink: '#0b0b0b' },
  { id: 'cost', ad: 0, head: 'COSTKUTTERZ RYLAND ST', sub: 'Saggy & Junior: odd jobs, cold drinks, hot gossip', pose: 'idle', c1: '#1d5fbf', c2: '#0b2a5c', ink: '#ffffff' },
];
// parody names for real Birmingham hotspots (look-alike buildings / signs in mapfill.js)
export const HOTSPOTS = {
  bullring: 'BULLDOG RING', selfridges: 'SELFWIDGES', library: 'LIBRARY OF BRUM', mailbox: 'THE POSTBOX', rotunda: 'THE ROUNDABOUTA',
  grandcentral: 'GRAND CENTRAL-ISH', broadst: 'BROAD ST STRIP', digbeth: 'CUSTARD FACT\'RY', balti: 'BALTI TRIANGLE', covrd: 'COVENTRY RD MARKET', chinese: 'ARCADIANT', smallheath: 'SMALL HEATH PARADE',
};
