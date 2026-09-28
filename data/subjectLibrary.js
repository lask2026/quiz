const SUBJECT_LIBRARY = Object.freeze({
  MCAT: [
    {
      id: 'organic-chemistry',
      title: 'Organic Chemistry',
      sourceTitle: 'MCAT Organic Chemistry Review',
      pageCount: 629,
      chapters: [
        { number: 1, title: 'Nomenclature', pages: '57-110' },
        { number: 2, title: 'Isomers', pages: '111-162' },
        { number: 3, title: 'Bonding', pages: '163-195' },
        { number: 4, title: 'Analyzing Organic Reactions', pages: '196-256' },
        { number: 5, title: 'Alcohols', pages: '257-296' },
        {
          number: 6,
          title: 'Aldehydes and Ketones I: Electrophilicity and Oxidation-Reduction',
          pages: '297-335',
        },
        { number: 7, title: 'Aldehydes and Ketones II: Enolates', pages: '336-370' },
        { number: 8, title: 'Carboxylic Acids', pages: '371-409' },
        { number: 9, title: 'Carboxylic Acid Derivatives', pages: '410-451' },
        {
          number: 10,
          title: 'Nitrogen- and Phosphorus-Containing Compounds',
          pages: '452-487',
        },
        { number: 11, title: 'Spectroscopy', pages: '488-528' },
        { number: 12, title: 'Separations and Purifications', pages: '529-573' },
      ],
    },
  ],
});

module.exports = SUBJECT_LIBRARY;
