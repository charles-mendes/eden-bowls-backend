const DEFAULT_FEEDBACKS = [
  {
    name: 'Sarah M.',
    category: 'tutora',
    country: 'BR',
    place: 'Nova York',
    comment: 'Desde que mudamos para o Eden Bowls, o pelo do meu golden nunca esteve tão bonito. Ele fica animado na hora da refeição agora.'
  },
  {
    name: 'James T.',
    category: 'tutor',
    country: 'BR',
    place: 'São Paulo',
    comment: 'Finalmente uma marca de pet food que leva a nutrição tão a sério quanto eu. Os ingredientes são exatamente o que eu estava procurando.'
  },
  {
    name: 'Sarah M.',
    category: 'tutora',
    country: 'US',
    place: 'New York',
    comment: "Since switching to Eden Bowls, my golden's coat has never looked better. He actually gets excited at mealtime now."
  },
  {
    name: 'James T.',
    category: 'tutor',
    country: 'US',
    place: 'São Paulo',
    comment: 'Finally a pet food brand that takes nutrition as seriously as I do. The ingredients are exactly what I was looking for.'
  }
];

function firstRow(result) {
  if (Array.isArray(result)) {
    return result[0] || null;
  }
  return result || null;
}

async function seedDefaultFeedbacks(queryRunner) {
  for (const item of DEFAULT_FEEDBACKS) {
    const existing = firstRow(await queryRunner.query(
      'SELECT `id`, `place` FROM `feedbacks` WHERE `name` = ? AND `country` = ? LIMIT 1',
      [item.name, item.country]
    ));

    if (existing && existing.id) {
      if (!String(existing.place || '').trim()) {
        await queryRunner.query(
          'UPDATE `feedbacks` SET `place` = ? WHERE `id` = ? LIMIT 1',
          [item.place, existing.id]
        );
      }
      continue;
    }

    await queryRunner.query(
      [
        'INSERT INTO `feedbacks`',
        '(`name`, `category`, `country`, `place`, `photo`, `comment`, `active`)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ].join(' '),
      [item.name, item.category, item.country, item.place, '', item.comment, 1]
    );
  }
}

module.exports = {
  DEFAULT_FEEDBACKS,
  seedDefaultFeedbacks
};
