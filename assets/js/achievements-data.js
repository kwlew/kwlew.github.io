// Source of truth for the competition record. achievements.html renders the
// full record from it, and the landing page reads its medal tally and
// timeline from it, so the two can never disagree.
window.KW_RECORD = (function () {
  "use strict";

  const ACHIEVEMENTS = {
    omc: {
      acronym: 'OMC',
      fullname: 'Olimpíada de Matemática Canguru',
      subtitle: '4 medals',
      results: [
        { year: '2022', badge: 'gold',   text: 'Gold' },
        { year: '2023', badge: 'silver', text: 'Silver' },
        { year: '2024', badge: 'gold',   text: 'Gold' },
        { year: '2025', badge: 'gold',   text: 'Gold' }
      ]
    },
    obg: {
      acronym: 'OBG',
      fullname: 'Olimpíada Brasileira de Geografia',
      subtitle: '2 medals',
      results: [
        { year: '2023', badge: 'gold',   text: 'Gold' },
        { year: '2024', badge: 'silver', text: 'Silver' }
      ]
    },
    obrl: {
      acronym: 'OBRL',
      fullname: 'Olimpíada Brasileira de Raciocínio Lógico',
      subtitle: '2 medals',
      results: [
        { year: '2022', badge: 'silver', text: 'Silver' },
        { year: '2023', badge: 'silver', text: 'Silver' }
      ]
    },
    oba: {
      acronym: 'OBA',
      fullname: 'Olimpíada Brasileira de Astronomia',
      subtitle: '2 medals',
      results: [
        { year: '2021', badge: 'silver', text: 'Silver' },
        { year: '2025', badge: 'bronze', text: 'Bronze' }
      ]
    },
    obrPractical: {
      acronym: 'OBR PRACTICAL',
      fullname: 'Olimpíada Brasileira de Robótica (Practical)',
      subtitle: '2 participations',
      results: [
        { year: '2025', badge: 'lost',        text: 'Forfeited' },
        { year: '2026', badge: 'participant', text: 'Ongoing' }
      ]
    },
    obrTheoretical: {
      acronym: 'OBR THEORETICAL',
      fullname: 'Olimpíada Brasileira de Robótica (Theoretical)',
      subtitle: '1 medal',
      results: [
        { year: '2025', badge: 'silver', text: 'Silver' }
      ]
    },
    obcit: {
      acronym: 'OBCIT',
      fullname: 'Olimpíada Brasileira de Ciência, Inovação e Tecnologia',
      subtitle: '2 results',
      results: [
        { year: '2025', badge: 'phase',       text: '4th Phase' },
        { year: '2026', badge: 'participant', text: 'Ongoing (3rd Phase)' }
      ]
    },
    oci: {
      acronym: 'OCI',
      fullname: 'Olimpíada Cearense de Informática',
      subtitle: '1 result',
      results: [
        { year: '2024', badge: 'participant', text: 'Participant' }
      ]
    },
    robocup: {
      acronym: 'ROBOCUP',
      fullname: 'RoboCup Rescue Maze (International)',
      subtitle: '6 results · 2026',
      wide: true,
      results: [
        { group: '2026', place: 'Incheon, Korea 🇰🇷' },
        { label: 'Outstanding Innovation Award', badge: 'world', text: 'Winner' },
        { label: 'Community Award',              badge: 'world', text: '1st Place' },
        { label: 'Overall',                      badge: 'phase', text: '6th Place' },
        { label: 'Documents',                    badge: 'phase', text: '4th Place' },
        { label: 'Super Teams',                  badge: 'phase', text: '5th Place' },
        { label: 'Technical Challenge',          badge: 'phase', text: '6th Place' }
      ]
    },
    cbr: {
      acronym: 'CBR',
      fullname: 'Competição Brasileira de Robótica',
      subtitle: '5 results · 2025 to 2026',
      wide: true,
      results: [
        { group: '2025', place: 'Vitória, ES' },
        { label: 'Overall',               badge: 'national', text: '1st Place' },
        { label: 'Super Teams',           badge: 'gold',     text: '1st Place' },
        { label: 'Technical Challenge',   badge: 'gold',     text: '1st Place' },
        { label: 'Team Description Paper', badge: 'gold',    text: '1st Place' },
        { label: 'Video',                 badge: 'gold',     text: '1st Place' },
        { group: '2026', place: 'João Pessoa, PB' },
        { label: 'Defending the title this November', badge: 'participant', text: 'Upcoming' }
      ]
    },
    cbr2024: {
      acronym: 'CBR 2024',
      fullname: 'Competição Brasileira de Robótica',
      subtitle: '1 result · 2024',
      wide: true,
      note: '* Not a member during this competition',
      results: [
        { label: 'Overall', badge: 'gold', text: '1st Place' }
      ]
    },
    fdc: {
      acronym: 'FDC',
      fullname: 'Feira do Conhecimento',
      subtitle: '1 result',
      results: [
        { year: '2025', badge: 'bronze', text: '3rd Place' }
      ]
    },
    ocq: {
      acronym: 'OCQ',
      fullname: 'Olimpíada Cearense de Química',
      subtitle: '1 result',
      results: [
        { year: '2025', badge: 'phase', text: '2nd Phase' }
      ]
    },
    obi: {
      acronym: 'OBI',
      fullname: 'Olimpíada Brasileira de Informática',
      subtitle: '4 results',
      results: [
        { year: '23, 24, 25', badge: 'phase',       text: '3× 2nd Phase' },
        { year: '2026',       badge: 'participant', text: 'Ongoing (2nd Phase)' }
      ]
    },
    obiTheoretical: {
      acronym: 'OBI-T',
      fullname: 'Olimpíada Brasileira de Informática Teórica',
      subtitle: '1 result',
      results: [
        { year: '2022', badge: 'phase', text: '3rd Phase' }
      ]
    },
    onad: {
      acronym: 'ONAD',
      fullname: 'Olimpíada Nacional de Astronomia Digital',
      subtitle: '1 result',
      results: [
        { year: '2026', badge: 'participant', text: 'Participant' }
      ]
    },
    obf: {
      acronym: 'OBF',
      fullname: 'Olimpíada Brasileira de Física',
      subtitle: '2 results',
      results: [
        { badge: 'phase', text: '2× 2nd Phase' }
      ]
    },
    ocm: {
      acronym: 'OCM',
      fullname: 'Olimpíada Cearense de Matemática',
      subtitle: '1 result',
      results: [
        { badge: 'participant', text: 'Participant' }
      ]
    }
  };

  const PANELS = {
    personal: {
      summaries: [
        [{ kind: 'national', count: '1', label: 'National Win' }],
        [
          { kind: 'gold',   count: '4', label: 'Gold' },
          { kind: 'silver', count: '6', label: 'Silver' },
          { kind: 'bronze', count: '1', label: 'Bronze' }
        ]
      ],
      cards: [
        'omc', 'obg', 'obrl', 'oba', 'obrPractical', 'obrTheoretical',
        'obcit', 'oci', 'robocup', 'cbr', 'fdc', 'ocq', 'obi', 'obiTheoretical',
        'onad', 'obf', 'ocm'
      ]
    },
    team: {
      summaries: [
        [
          { kind: 'national', count: '2', label: 'National Wins' },
          { kind: 'world',    count: '2', label: 'International Awards' }
        ]
      ],
      cards: ['robocup', 'cbr', 'cbr2024']
    }
  };

  return { ACHIEVEMENTS, PANELS };
})();
